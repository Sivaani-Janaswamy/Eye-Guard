import { db } from "../db/db.js";
import type { ConsentRecord } from "../db/schema.js";
import { SessionTracker } from "../engine/session-tracker.js";
import { AlertEngine } from "../engine/alert-engine.js";
import { ScoreEngine } from "../engine/score-engine.js";
import { nanoid } from "nanoid";
import { SensorFrame } from "../db/schema.js";

// Initialize engine singletons
const tracker = new SessionTracker();
const alertEngine = new AlertEngine();
const scoreEngine = new ScoreEngine();

console.log('[EyeGuard:SW] Service worker script loaded');

// Safe DB access wrapper — never crashes the SW
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

// PERSISTENT STATE CACHE (survives hibernation via storage sync)
let frameBuffer: SensorFrame[] = [];
let activeSessionId: string | null = null;
let sessionStartTime: number | null = null;
let isHydrated = false;

/**
 * Loads session state from local storage to survive SW restarts.
 */
async function hydrateState() {
  if (isHydrated) return;
  const state = await chrome.storage.local.get(['activeSessionId', 'sessionStartTime']);
  if (state.activeSessionId) {
    activeSessionId = state.activeSessionId;
    sessionStartTime = state.sessionStartTime;
    console.log('[EyeGuard:SW] Re-hydrated session:', activeSessionId);
  }
  isHydrated = true;
}

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
      hydrateState(),
      checkConsentAndAct()
    ])
  );
});

// Handle startup and installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log("EyeGuard Extension Installed");
  
  // Set default settings if not already present
  const settings = await chrome.storage.local.get(["theme", "isMonitoring"]);
  if (!settings.theme) await chrome.storage.local.set({ theme: "light" });
  if (settings.isMonitoring === undefined) await chrome.storage.local.set({ isMonitoring: true });

  await setupMidnightAlarm();
  await setupRecomputeAlarm();
  await hydrateState();
  await checkConsentAndAct();
});

async function setupRecomputeAlarm() {
    await chrome.alarms.create('RECOMPUTE_SCORE', { periodInMinutes: 1 });
}

chrome.runtime.onStartup.addListener(async () => {
  console.log("EyeGuard Extension Started");
  await hydrateState();
  await checkConsentAndAct();
});

/**
 * Checks if user has provided consent. If not, sends STOP_CAMERA.
 * Added delay to prevent race condition before DB is fully ready.
 */
async function checkConsentAndAct() {
  console.log('[EyeGuard:SW] Starting consent check (with 500ms delay)...');
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    const records = await db.consent.toArray();
    const hasConsent = records.some(r => r.cameraGranted === true);
    
    console.log('[EyeGuard:SW] Consent result:', hasConsent, '| Records:', records.length);
    
    if (!hasConsent) {
      console.log('[EyeGuard:SW] No consent record found — sending STOP_CAMERA');
      chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_CAMERA' })
              .catch(() => {});
          }
        });
      });

      // No consent record — optional: prompt via popup if strictly needed,
      // but usually we wait for user to open it manually.
    } else {
      console.log('[EyeGuard:SW] Consent confirmed — monitoring may proceed');
      if (!tracker.getActiveSession()) {
        await tracker.startSession().catch(() => {});
      }
    }
  } catch (err) {
    console.error('[EyeGuard:SW] Consent check failed (DB error):', err);
    // FAIL OPEN: If DB crashes, do not stop the camera loop. 
    // This allows existing sessions to continue.
  }
}

/**
 * Sets an alarm to trigger the daily score computation at midnight.
 */
async function setupMidnightAlarm() {
  await chrome.alarms.clear("COMPUTE_DAILY_SCORE");

  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 1, 0 // 1 minute past midnight
  );

  chrome.alarms.create("COMPUTE_DAILY_SCORE", {
    when: midnight.getTime(),
    periodInMinutes: 24 * 60 // Repeat every 24 hours
  });
  console.log(`Midnight alarm set for: ${midnight.toISOString()}`);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "COMPUTE_DAILY_SCORE") {
    console.log("Triggering daily score computation (Midnight)");
    await scoreEngine.getTodayScore();
  }

  if (alarm.name === 'RECOMPUTE_SCORE') {
    const today = new Date().toISOString().split('T')[0];
    const startDate = new Date(`${today}T00:00:00`);
    const sessions = await db.sessions
      .where('startTime')
      .aboveOrEqual(startDate.getTime())
      .toArray();
    
    if (sessions.length > 0) {
      const score = await scoreEngine.getTodayScore();
      console.log('[EyeGuard:SW] Daily score recomputed:', score.score);
    }
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'KEEPALIVE') {
    // Just responding is enough to reset the 30s idle timer
    sendResponse({ alive: true, sessionActive: !!activeSessionId });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ alive: true, sessionId: activeSessionId });
    return true;
  }

  if (message.type === 'CHECK_CONSENT') {
    db.consent.toArray()
      .then(records => {
        const granted = records.some(r => r.cameraGranted === true);
        sendResponse({ granted });
      })
      .catch(() => sendResponse({ granted: false }));
    return true;
  }

  if (message.type === 'GRANT_CONSENT') {
    const record: ConsentRecord = {
      consentedAt: Date.now(),
      consentVersion: '1.0',
      cameraGranted: true,
      backendSyncEnabled: false,
      dataRetentionDays: 90,
    };

    // Ensure DB is open and clear/add consent
    db.open()
      .then(() => db.consent.clear())
      .then(() => db.consent.add(record))
      .then(async () => {
        sendResponse({ success: true });
        
        // Start tracking session
        if (!tracker.getActiveSession()) {
          await tracker.startSession();
        }

        setTimeout(() => {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { type: 'CONSENT_GRANTED' })
                  .catch(() => {});
              }
            });
          });
        }, 100);
      })
      .catch((err) => {
        console.error('[EyeGuard:SW] GRANT_CONSENT failed:', err);
        sendResponse({ success: false });
      });
    return true;
  }

  // Handle data-heavy pipeline messages
  if (message.type === 'SENSOR_FRAME') {
    if (!isHydrated) await hydrateState();
    
    const frame: SensorFrame = message.payload;
    frameBuffer.push(frame);

    // Always write live stats — this is what the UI polls
    db.table('live_stats').put({
      id: 1,
      distanceCm:   Math.round(frame.screenDistanceCm),
      blinkRate:    parseFloat(frame.blinkRate.toFixed(1)),
      lux:          Math.round(frame.ambientLuxLevel),
      faceDetected: frame.faceDetected,
      updatedAt:    Date.now()
    }).catch(() => {});

    // Update session averages every 25 frames (~5 seconds at 5fps)
    if (frameBuffer.length % 25 === 0 && activeSessionId) {
      const faced = frameBuffer.slice(-25).filter(f => f.faceDetected);
      if (faced.length > 0) {
        const avgDist  = faced.reduce((s,f) => s + f.screenDistanceCm, 0) / faced.length;
        const avgBlink = faced.reduce((s,f) => s + f.blinkRate, 0) / faced.length;
        const avgLux   = frameBuffer.slice(-25).reduce((s,f) => s + f.ambientLuxLevel, 0) / 25;

        await db.sessions.update(activeSessionId, {
          durationMs:      Date.now() - (sessionStartTime ?? Date.now()),
          avgDistanceCm:   parseFloat(avgDist.toFixed(1)),
          avgBlinkRate:    parseFloat(avgBlink.toFixed(1)),
          avgLuxLevel:     Math.round(avgLux),
          endTime:         Date.now()
        }).catch(() => {});
        
        console.log('[EyeGuard:SW] Session batched — dist:', Math.round(avgDist), 'blink:', Math.round(avgBlink));
      }
    }

    sendResponse({ ok: true });
    return true;
  }

  switch (message.type) {
    case "START_MONITORING":
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'CONSENT_GRANTED' }).catch(() => {});
          }
        });
      });
      break;
    case "STOP_MONITORING":
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_CAMERA' }).catch(() => {});
          }
        });
      });
      break;
    case "ALERT_DISMISSED":
      if (message.payload?.alertId) {
        alertEngine.dismissAlert(message.payload.alertId);
      }
      break;
    case "ALERT_SNOOZED":
      if (message.payload?.alertId && message.payload?.minutes) {
        alertEngine.snoozeAlert(message.payload.alertId, message.payload.minutes);
      }
      break;
    case "START_SESSION":
      activeSessionId = nanoid();
      sessionStartTime = Date.now();
      frameBuffer = [];
      console.log('[EyeGuard:SW] Session started:', activeSessionId);

      // Persist for hibernation
      await chrome.storage.local.set({ activeSessionId, sessionStartTime });

      db.sessions.add({
        sessionId: activeSessionId,
        startTime: sessionStartTime,
        endTime: null,
        durationMs: 0,
        avgDistanceCm: 0,
        avgBlinkRate: 0,
        avgLuxLevel: 0,
        breaksTaken: 0,
        alertsTriggered: 0,
        platform: 'chrome-extension'
      }).then(() => {
          sendResponse({ sessionId: activeSessionId });
      }).catch(() => {
          sendResponse({ error: 'Failed to start session' });
      });
      return true; // async response
    case "END_SESSION":
      if (tracker.getActiveSession()) {
        tracker.endSession(tracker.getActiveSession()!.sessionId);
      }
      activeSessionId = null;
      sessionStartTime = null;
      await chrome.storage.local.remove(['activeSessionId', 'sessionStartTime']);
      break;
    default:
      break;
  }
});
