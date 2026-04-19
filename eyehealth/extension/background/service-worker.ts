import { db } from "../db/db.js";
import type { ConsentRecord } from "../db/schema.js";
import { SessionTracker } from "../engine/session-tracker.js";
import { AlertEngine } from "../engine/alert-engine.js";

// Initialize engine singletons
const tracker = new SessionTracker();
const alertEngine = new AlertEngine();

// Handle startup and installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log("EyeGuard Extension Installed");
  
  // Set default settings if not already present
  const settings = await chrome.storage.local.get(["theme", "isMonitoring"]);
  if (!settings.theme) await chrome.storage.local.set({ theme: "light" });
  if (settings.isMonitoring === undefined) await chrome.storage.local.set({ isMonitoring: true });

  await setupMidnightAlarm();
  await checkConsentAndInitialize();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("EyeGuard Extension Started");
  await checkConsentAndInitialize();
});

/**
 * Checks if user has provided consent. If not, opens the popup to prompt for it.
 */
async function checkConsentAndInitialize() {
  try {
    const consentCount = await db.consent.count();
    if (consentCount === 0) {
      console.log("No consent record found, opening popup.");
      chrome.action.openPopup().catch(() => {
        chrome.tabs.create({ url: "popup/popup.html" });
      });
    } else {
      console.log("Consent record exists.");
      // Auto-start a session if consent exists
      if (!tracker.getActiveSession()) {
        await tracker.startSession();
      }
    }
  } catch (error) {
    console.error("Error during consent check:", error);
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "COMPUTE_DAILY_SCORE") {
    console.log("Triggering daily score computation (Module E)");
    // TODO: Hook into score-engine.ts computeLogic
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    db.consent.clear()
      .then(() => db.consent.add(record))
      .then(async () => {
        // Confirm committed
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
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Handle data-heavy pipeline messages
  if (message.type === 'SENSOR_FRAME') {
    const frame = message.payload;
    const session = tracker.getActiveSession();
    
    // Log for verification (User UX requirement)
    console.log('[EyeGuard] SENSOR_FRAME:', frame);

    if (session) {
      // 1. Log to trackable session
      tracker.addFrame(frame);
      
      // 2. Evaluate for health alerts
      const durationMs = Date.now() - session.startTime;
      const alert = alertEngine.evaluateFrame(frame, durationMs);
      
      if (alert && sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_ALERT', alert })
          .catch(() => {});
      }
    }
    return false; // No async response needed
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
      tracker.startSession();
      break;
    case "END_SESSION":
      if (tracker.getActiveSession()) {
        tracker.endSession(tracker.getActiveSession()!.sessionId);
      }
      break;
    default:
      break;
  }
});
