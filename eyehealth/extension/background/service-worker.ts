import { db } from "../db/db.js";

// Handle startup and installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log("EyeGuard Extension Installed");
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
      // In MV3, chrome.action.openPopup might fail without user gesture.
      // Fallback to opening a new tab.
      chrome.action.openPopup().catch(() => {
        chrome.tabs.create({ url: "popup/popup.html" });
      });
    } else {
      console.log("Consent record exists.");
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
  switch (message.type) {
    case "START_SESSION":
      console.log("START_SESSION received", message.payload);
      break;
    case "END_SESSION":
      console.log("END_SESSION received", message.payload);
      break;
    case "LOG_ALERT":
      console.log("LOG_ALERT received", message.payload);
      break;
    default:
      break;
  }
});
