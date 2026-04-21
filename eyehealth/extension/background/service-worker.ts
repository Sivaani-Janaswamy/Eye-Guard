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
        await tracker.startSession().catch(() => {});
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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "COMPUTE_DAILY_SCORE") {
    console.log("Triggering daily score computation");
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

// -------------------- MESSAGES --------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

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
      frameBuffer.push(frame);

      db.table('live_stats').put({
        id: 1,
        distanceCm: Math.round(frame.screenDistanceCm),
        blinkRate: parseFloat(frame.blinkRate.toFixed(1)),
        lux: Math.round(frame.ambientLuxLevel),
        faceDetected: frame.faceDetected,
        landmarks: frame.landmarks,
        updatedAt: Date.now()
      }).catch(() => {});

      if (frameBuffer.length % 25 === 0 && activeSessionId) {
        const faced = frameBuffer.slice(-25).filter(f => f.faceDetected);

        if (faced.length > 0) {
          const avgDist = faced.reduce((s,f)=>s+f.screenDistanceCm,0)/faced.length;
          const avgBlink = faced.reduce((s,f)=>s+f.blinkRate,0)/faced.length;
          const avgLux = frameBuffer.slice(-25).reduce((s,f)=>s+f.ambientLuxLevel,0)/25;

          await db.sessions.update(activeSessionId, {
            durationMs: Date.now() - (sessionStartTime ?? Date.now()),
            avgDistanceCm: parseFloat(avgDist.toFixed(1)),
            avgBlinkRate: parseFloat(avgBlink.toFixed(1)),
            avgLuxLevel: Math.round(avgLux),
            endTime: Date.now()
          }).catch(() => {});
        }
      }

      sendResponse({ ok: true });
    })();

    return true;
  }

});