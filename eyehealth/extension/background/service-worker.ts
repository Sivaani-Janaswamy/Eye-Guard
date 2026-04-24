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

// -------------------- SAFE DB WRAPPER --------------------
async function safeDbCall<T>(
  fn: () => Promise<T>, 
  fallback: T,
  label: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error('[EyeGuard:SW] DB error in', label, ':', err);
    return fallback;
  }
}

// -------------------- STATE --------------------
let frameBuffer: SensorFrame[] = [];
let activeSessionId: string | null = null;
let sessionStartTime: number | null = null;
let isHydrated = false;
let lastWriteTime = 0; // For time-based throttling
let lastLandmarks: any[] = []; // Cache for UI stability

// 🔴 NEW: prevents duplicate consent checks
let isCheckingConsent = false;

// -------------------- HYDRATION --------------------
async function hydrateState() {
  if (isHydrated) return;

  const state = await chrome.storage.local.get([
    'activeSessionId',
    'sessionStartTime'
  ]);

  if (state.activeSessionId) {
    activeSessionId = state.activeSessionId;
    sessionStartTime = state.sessionStartTime;
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
      self.clients.claim(),
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
      const broadcastData = {
        type: 'LIVE_STATS_UPDATE',
        payload: {
          ...liveStatsPayload,
          alerts: alerts
        }
      };

      // 🚀 1. BROADCAST to Popup/Dashboard (extension pages)
      chrome.runtime.sendMessage(broadcastData).catch(() => {});

      // 🚀 2. BROADCAST back to the same tab (Overlay)
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, broadcastData).catch(() => {
          // Silence errors (content script might not be ready)
        });
      }

      frameBuffer.push(frame);

      // Throttle writes to ~3 FPS for DB history
      if (now - lastWriteTime > 300) {
        lastWriteTime = now;
        db.table('live_stats').put({
          id: 1,
          distanceCm: Math.round(frame.screenDistanceCm),
          blinkRate: parseFloat(frame.blinkRate.toFixed(1)),
          lux: Math.round(frame.ambientLuxLevel),
          faceDetected: frame.faceDetected,
          confidence: frame.confidence || 0,
          landmarks: lastLandmarks, // Store stable landmarks
          updatedAt: now
        }).catch((err) => console.error('[EyeGuard:SW] live_stats write failed:', err));
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
