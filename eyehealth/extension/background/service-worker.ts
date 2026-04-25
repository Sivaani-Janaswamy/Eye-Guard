import { db } from "../db/db.js";
import type { ConsentRecord } from "../db/schema.js";
import { SessionTracker } from "../engine/session-tracker.js";
import { AlertEngine } from "../engine/alert-engine.js";
import { ScoreEngine } from "../engine/score-engine.js";
import { nanoid } from "nanoid";
import { SensorFrame } from "../db/schema.js";

const tracker = new SessionTracker();
const alertEngine = new AlertEngine();
const scoreEngine = new ScoreEngine();

console.log('[EyeGuard:SW] Service worker script loaded');

// -------------------- PRODUCTION-GRADE SAFE WRITE WRAPPER --------------------
interface WriteQueue {
  pending: boolean;
  queue: Array<{ table: string; data: any; resolve: (value: boolean) => void; reject: (reason: any) => void }>;
}

const writeQueues: Map<string, WriteQueue> = new Map();

// Get or create write queue for a table
function getWriteQueue(tableName: string): WriteQueue {
  if (!writeQueues.has(tableName)) {
    writeQueues.set(tableName, {
      pending: false,
      queue: []
    });
  }
  return writeQueues.get(tableName)!;
}

// Validate and sanitize data before writing
function sanitizeData(tableName: string, data: any): any {
  const sanitized = { ...data };
  
  switch (tableName) {
    case 'live_stats':
      // Ensure required fields exist and are valid
      sanitized.id = 1; // Fixed primary key
      sanitized.distanceCm = Math.max(0, Math.min(200, Number(sanitized.distanceCm) || 0));
      sanitized.blinkRate = Math.max(0, Math.min(100, Number(sanitized.blinkRate) || 0));
      sanitized.lux = Math.max(0, Math.min(10000, Number(sanitized.lux) || 0));
      sanitized.faceDetected = Boolean(sanitized.faceDetected);
      sanitized.confidence = Math.max(0, Math.min(1, Number(sanitized.confidence) || 0));
      sanitized.updatedAt = Number(sanitized.updatedAt) || Date.now();
      
      // Strip landmarks if too large (IndexedDB limit ~100MB per record)
      if (sanitized.landmarks && Array.isArray(sanitized.landmarks)) {
        const landmarksSize = JSON.stringify(sanitized.landmarks).length;
        if (landmarksSize > 50000) { // 50KB limit per record
          console.warn('[EyeGuard:SW] Landmarks too large, stripping from live_stats');
          sanitized.landmarks = [];
        }
      }
      break;
      
    case 'session_data':
      // Ensure required fields exist and are valid
      sanitized.id = 1; // Fixed primary key
      sanitized.durationMs = Math.max(0, Number(sanitized.durationMs) || 0);
      sanitized.updatedAt = Number(sanitized.updatedAt) || Date.now();
      break;
  }
  
  return sanitized;
}

// Production-grade write with concurrency control
async function safeWrite(tableName: string, data: any): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const queue = getWriteQueue(tableName);
    
    // Add to queue
    queue.queue.push({ table: tableName, data, resolve, reject });
    
    // Start processing if not already processing
    if (!queue.pending) {
      processWriteQueue(tableName);
    }
  });
}

// Process write queue sequentially (no parallel writes)
async function processWriteQueue(tableName: string) {
  const queue = getWriteQueue(tableName);
  if (queue.pending) return;
  
  queue.pending = true;
  
  while (queue.queue.length > 0) {
    const item = queue.queue.shift()!;
    
    try {
      // Sanitize data before writing
      const sanitizedData = sanitizeData(item.table, item.data);
      
      // Write to IndexedDB
      await db.table(item.table).put(sanitizedData);
      
      console.log(`[EyeGuard:SW] ${item.table} write successful`);
      item.resolve(true);
    } catch (err) {
      // Enhanced error logging
      const errorDetails = {
        name: (err as any)?.name || 'UnknownError',
        message: (err as any)?.message || 'Unknown error',
        table: item.table,
        dataKeys: Object.keys(item.data),
        dataSize: JSON.stringify(item.data).length
      };
      
      console.error(`[EyeGuard:SW] ${item.table} write failed:`, errorDetails);
      console.error(`[EyeGuard:SW] Failed payload:`, JSON.stringify(item.data, null, 2));
      
      item.resolve(false);
    }
  }
  
  queue.pending = false;
}

// -------------------- STATE --------------------
let frameBuffer: SensorFrame[] = [];
let activeSessionId: string | null = null;
let sessionStartTime: number | null = null;
let isHydrated = false;
let lastWriteTime = 0; // For time-based throttling
let lastLiveStats: any = null; // Track changes for write optimization
let retryCount = 0;
let writeIntervalId: number | null = null;
let lastLandmarks: any[] = []; // Cache for UI stability

// 🔴 NEW: prevents duplicate consent checks
let isCheckingConsent = false;

// Service worker restart handling
chrome.runtime.onStartup.addListener(() => {
  console.log('[EyeGuard:SW] Service worker started/restarted');
  // Reset state on restart
  lastWriteTime = 0;
  lastLiveStats = null;
  retryCount = 0;
});

// Prevent duplicate intervals
function ensureSingleWriteInterval() {
  if (writeIntervalId) {
    clearInterval(writeIntervalId);
  }
  
  writeIntervalId = setInterval(() => {
    // Heartbeat to ensure service worker stays active
    if (Date.now() - lastWriteTime > 10000) {
      console.warn('[EyeGuard:SW] No writes for 10s - checking health');
    }
  }, 5000);
}

// -------------------- BACKPRESSURE HANDLING --------------------
let consecutiveFailures = 0;
let lastFailureTime = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_COOLDOWN_MS = 10000; // 10 seconds

// Check if we should throttle writes due to repeated failures
function shouldThrottleWrites(): boolean {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    const timeSinceLastFailure = Date.now() - lastFailureTime;
    if (timeSinceLastFailure < FAILURE_COOLDOWN_MS) {
      console.warn(`[EyeGuard:SW] Throttling writes due to ${consecutiveFailures} consecutive failures`);
      return true;
    } else {
      // Reset after cooldown period
      consecutiveFailures = 0;
    }
  }
  return false;
}

// Enhanced write function with backpressure handling
async function writeWithBackpressure(tableName: string, data: any): Promise<boolean> {
  // Check if we should throttle
  if (shouldThrottleWrites()) {
    return false;
  }
  
  const success = await safeWrite(tableName, data);
  
  if (success) {
    consecutiveFailures = 0; // Reset on success
  } else {
    consecutiveFailures++;
    lastFailureTime = Date.now();
    
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`[EyeGuard:SW] ${MAX_CONSECUTIVE_FAILURES} consecutive write failures - entering cooldown mode`);
    }
  }
  
  return success;
}

// Check if values changed significantly
function hasSignificantChange(current: any, previous: any, threshold = 0.05) {
  if (!previous) return true;
  
  return (
    Math.abs(current.distanceCm - previous.distanceCm) > 1 ||
    Math.abs(current.blinkRate - previous.blinkRate) > 0.5 ||
    Math.abs(current.lux - previous.lux) > 5 ||
    current.faceDetected !== previous.faceDetected
  );
}

// -------------------- HYDRATION --------------------
async function hydrateState() {
  if (isHydrated) return;

  const state = await chrome.storage.local.get([
    'activeSessionId',
    'sessionStartTime'
  ]);

  if (state.activeSessionId) {
    activeSessionId = String(state.activeSessionId);
    sessionStartTime = Number(state.sessionStartTime) || null;
    console.log('[EyeGuard:SW] Re-hydrated session:', activeSessionId);
  }

  isHydrated = true;
}

// -------------------- LIFECYCLE --------------------
self.addEventListener('install', () => {
  console.log('[EyeGuard:SW] Installing');
  // @ts-ignore
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[EyeGuard:SW] Activated');

  // @ts-ignore
  event.waitUntil(
    Promise.all([
      (self as any).clients.claim(),
      hydrateState()
    ]).then(() => checkConsentAndAct())
  );
});

// -------------------- INSTALL --------------------
chrome.runtime.onInstalled.addListener(async () => {
  console.log("EyeGuard Extension Installed");

  const settings = await chrome.storage.local.get(["theme", "isMonitoring"]);
  if (!settings.theme) await chrome.storage.local.set({ theme: "light" });
  if (settings.isMonitoring === undefined) {
    await chrome.storage.local.set({ isMonitoring: true });
  }

  await setupMidnightAlarm();
  await setupRecomputeAlarm();
  await hydrateState();
});

// -------------------- STARTUP --------------------
chrome.runtime.onStartup.addListener(async () => {
  console.log("EyeGuard Extension Started");
  await hydrateState();
});

// -------------------- CONSENT LOGIC --------------------
async function checkConsentAndAct() {
  if (isCheckingConsent) {
    console.log('[EyeGuard:SW] Skipping duplicate consent check');
    return;
  }

  isCheckingConsent = true;

  console.log('[EyeGuard:SW] Starting consent check (2000ms delay)...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const records = await db.consent.toArray();
    const hasConsent = records.some(r => r.cameraGranted === true);

    console.log(
      '[EyeGuard:SW] Consent result:',
      hasConsent,
      '| Records:',
      records.length
    );

    if (!hasConsent) {
      console.log('[EyeGuard:SW] STOP_CAMERA (no consent)');
      console.log('[SW DEBUG] Monitoring active:', false);
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, { type: 'STOP_CAMERA' })
              .catch(() => {});
          }
        });
      });
    } else {
      console.log('[EyeGuard:SW] START_CAMERA (consent OK)');
      console.log('[SW DEBUG] Monitoring active:', true);
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, { type: 'START_CAMERA' })
            .catch(() => {});
        }
      }

      if (!tracker.getActiveSession()) {
        const session = await tracker.startSession();
        activeSessionId = session.sessionId;
        sessionStartTime = session.startTime;
        await chrome.storage.local.set({ activeSessionId, sessionStartTime });
        console.log('[EyeGuard:SW] Session started automatically:', activeSessionId);
      }
    }
  } catch (err) {
    console.error('[EyeGuard:SW] Consent check failed:', err);
  } finally {
    isCheckingConsent = false;
  }
}

// -------------------- DB INIT --------------------
db.open()
  .then(() => {
    console.log('[EyeGuard:SW] Database opened successfully');
  })
  .catch(err => {
    console.error('[EyeGuard:SW] Database failed to open:', err);
  });

// -------------------- ALARMS --------------------
async function setupMidnightAlarm() {
  await chrome.alarms.clear("COMPUTE_DAILY_SCORE");

  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 1, 0
  );

  chrome.alarms.create("COMPUTE_DAILY_SCORE", {
    when: midnight.getTime(),
    periodInMinutes: 24 * 60
  });

  console.log(`Midnight alarm set for: ${midnight.toISOString()}`);
}

async function setupRecomputeAlarm() {
  await chrome.alarms.create('RECOMPUTE_SCORE', { periodInMinutes: 1 });
}

// Broadcast helper
async function broadcastScoreUpdate() {
  try {
    const score = await scoreEngine.getTodayScore();
    chrome.runtime.sendMessage({ 
      type: 'SCORE_UPDATE', 
      payload: { scoreData: score } 
    }).catch(() => {});
  } catch (err) {
    console.error('[EyeGuard:SW] Score broadcast failed:', err);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "COMPUTE_DAILY_SCORE") {
    console.log("Triggering daily score computation");
    await broadcastScoreUpdate();
  }

  if (alarm.name === 'RECOMPUTE_SCORE') {
    await broadcastScoreUpdate();
  }
});

// Alert Cooldown State
let lastAlertTimes: Record<string, number> = {
  DISTANCE: 0,
  BLINK: 0,
  LIGHT: 0,
  USAGE: 0
};
let last2020Trigger = 0; // Usage tracking for stability

function evaluateAlerts(stats: any): any[] {
  const alerts = [];
  const now = Date.now();

  // 1. Distance Alert (Cooldown: 10s)
  if (stats.faceDetected && stats.distanceCm < 50 && (now - lastAlertTimes.DISTANCE > 10000)) {
    alerts.push({
      type: 'DISTANCE',
      message: "You're too close to the screen - Move back to reduce eye strain",
      severity: 'warning'
    });
    lastAlertTimes.DISTANCE = now;
  }

  // 2. Blink Alert (Cooldown: 3m)
  if (stats.faceDetected && stats.blinkRate < 12 && (now - lastAlertTimes.BLINK > 180000)) {
    alerts.push({
      type: 'BLINK',
      message: 'Low blink rate detected - Blink more to prevent dry eyes',
      severity: 'info'
    });
    lastAlertTimes.BLINK = now;
  }

  // 3. Low Light Alert (Cooldown: 5m)
  if (stats.lux < 50 && (now - lastAlertTimes.LIGHT > 300000)) {
    alerts.push({
      type: 'LIGHT',
      message: 'Lighting is too dim - Increase ambient light to reduce eye strain',
      severity: 'warning'
    });
    lastAlertTimes.LIGHT = now;
  }

  // 4. 20-20-20 Rule (Fixed: triggers exactly every 20 mins)
  if (stats.durationMs - last2020Trigger >= 1200000 && (now - lastAlertTimes.USAGE > 60000)) {
    alerts.push({
      type: 'USAGE',
      message: '20-20-20 Rule - Time for a break! Look 20 feet away for 20 seconds',
      severity: 'info'
    });
    lastAlertTimes.USAGE = now;
    last2020Trigger = stats.durationMs;
  }

  return alerts;
}

// -------------------- MESSAGES --------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'START_SESSION') {
    (async () => {
      if (!tracker.getActiveSession()) {
        const session = await tracker.startSession();
        activeSessionId = session.sessionId;
        sessionStartTime = session.startTime;
        await chrome.storage.local.set({ activeSessionId, sessionStartTime });
        console.log('[EyeGuard:SW] Session started via message:', activeSessionId);
      }
      sendResponse({ sessionId: activeSessionId });
    })();
    return true;
  }

  if (message.type === 'CHECK_CONSENT') {
    (async () => {
      try {
        if (!db.isOpen()) await db.open();
        const records = await db.consent.toArray();
        const granted = records.some(r => r.cameraGranted === true);

        console.log('[EyeGuard:SW] CHECK_CONSENT:', granted);
        sendResponse({ granted });

      } catch (err) {
        console.error('[EyeGuard:SW] CHECK_CONSENT error:', err);
        sendResponse({ granted: false });
      }
    })();

    return true;
  }

  if (message.type === 'GRANT_CONSENT') {
    (async () => {
      try {
        if (!db.isOpen()) await db.open();

        await db.consent.clear();

        await db.consent.add({
          consentedAt: Date.now(),
          consentVersion: '1.0',
          cameraGranted: true,
          backendSyncEnabled: false,
          dataRetentionDays: 90
        });

        const saved = await db.consent.toArray();

        if (saved.length === 0) {
          throw new Error('Consent write failed');
        }

        console.log('[EyeGuard:SW] Consent saved');

        // ✅ FIXED: only ONE START_CAMERA broadcast
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, { type: 'START_CAMERA' })
              .catch(() => {});
          }
        }

        sendResponse({ success: true });

      } catch (err) {
        console.error('[EyeGuard:SW] GRANT_CONSENT error:', err);
        sendResponse({ success: false });
      }
    })();

    return true;
  }

  if (message.type === 'SENSOR_FRAME') {
    (async () => {
      if (!isHydrated) await hydrateState();

      const frame: SensorFrame = message.payload;
      const now = Date.now();
      
      console.log('[SW DEBUG] Received SENSOR_FRAME', frame);
      
      const durationMs = sessionStartTime ? (now - sessionStartTime) : 0;

      // Update landmark cache if valid
      if (frame.landmarks && frame.landmarks.length > 0) {
        lastLandmarks = frame.landmarks;
      }

      const liveStatsPayload = {
        distanceCm: Math.round(frame.screenDistanceCm),
        blinkRate: parseFloat(frame.blinkRate.toFixed(1)),
        lux: Math.round(frame.ambientLuxLevel),
        faceDetected: frame.faceDetected,
        confidence: frame.confidence || 0,
        landmarks: lastLandmarks,
        durationMs: durationMs,
        updatedAt: now
      };

      const alerts = evaluateAlerts(liveStatsPayload);
      
      // Remove all chrome.runtime.sendMessage for camera stats - use Dexie only
      // LIVE_CAMERA_STATS and SESSION_UPDATE messages removed
      // Only keep LIVE_STATS_UPDATE for overlay (content script)
      
      // Send alerts to overlay only
      if (sender.tab?.id) {
        const alertData = {
          type: 'LIVE_STATS_UPDATE',
          payload: {
            ...liveStatsPayload,
            alerts: alerts
          }
        };
        chrome.tabs.sendMessage(sender.tab.id, alertData).catch(() => {
          // Silence errors (content script might not be ready)
        });
      }

      frameBuffer.push(frame);

      // Write live stats to Dexie (single source of truth) - EXACTLY 3 FPS
      if (now - lastWriteTime > 333) {
        lastWriteTime = now;
        
        // Prepare live stats data
        const liveStatsData = {
          id: 1,
          distanceCm: Math.round(frame.screenDistanceCm),
          blinkRate: parseFloat(frame.blinkRate.toFixed(1)),
          lux: Math.round(frame.ambientLuxLevel),
          faceDetected: frame.faceDetected,
          confidence: frame.confidence || 0,
          landmarks: lastLandmarks || [], // Ensure stable landmarks
          updatedAt: now
        };
        
        // Only write if values changed significantly (write optimization)
        if (hasSignificantChange(liveStatsData, lastLiveStats)) {
          const success = await writeWithBackpressure('live_stats', liveStatsData);
          if (success) {
            lastLiveStats = { ...liveStatsData }; // Store for comparison
            console.log('[EyeGuard:SW] live_stats written (optimized)');
          }
        }
        
        // Write session data to Dexie (always update session duration)
        if (sessionStartTime) {
          const sessionData = {
            id: 1,
            durationMs: durationMs,
            updatedAt: now
          };
          
          await writeWithBackpressure('session_data', sessionData);
        }
      }

      if (frameBuffer.length % 25 === 0 && activeSessionId) {
        const faced = frameBuffer.slice(-25).filter(f => f.faceDetected);
        const now = Date.now();
        const newTotalDuration = now - (sessionStartTime ?? now);
        
        const session = await db.sessions.get(activeSessionId);

        if (session && faced.length > 0) {
          const prevDuration = session.durationMs;
          const batchDuration = Math.max(1, newTotalDuration - prevDuration);

          const batchDist = faced.reduce((s,f) => s + f.screenDistanceCm, 0) / faced.length;
          const batchBlink = faced.reduce((s,f) => s + f.blinkRate, 0) / faced.length;
          const batchLux = frameBuffer.slice(-25).reduce((s,f) => s + f.ambientLuxLevel, 0) / 25;

          const update: any = { durationMs: newTotalDuration };

          if (prevDuration === 0) {
            update.avgDistanceCm = batchDist;
            update.avgBlinkRate = batchBlink;
            update.avgLuxLevel = batchLux;
          } else {
            // True Weighted Average: (avg1 * dur1 + avg2 * dur2) / (dur1 + dur2)
            update.avgDistanceCm = (session.avgDistanceCm * prevDuration + batchDist * batchDuration) / newTotalDuration;
            update.avgBlinkRate = (session.avgBlinkRate * prevDuration + batchBlink * batchDuration) / newTotalDuration;
            update.avgLuxLevel = (session.avgLuxLevel * prevDuration + batchLux * batchDuration) / newTotalDuration;
          }

          await db.sessions.update(activeSessionId, update).catch(() => {});
        }
      }

      sendResponse({ ok: true });
    })();

    return true;
  }

});
