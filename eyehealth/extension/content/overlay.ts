import { AlertEvent } from "../db/schema";
import { FaceMeshProcessor } from "../cv/face-mesh";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// State pointers
let videoElement: HTMLVideoElement | null = null;
let captureInterval: number | null = null;
let faceMeshProcessor: FaceMeshProcessor | null = null;
let cameraRunning = false;

/**
 * Injects a floating alert notification into the corner of the active webpage payload window.
 */
export function injectAlert(alert: AlertEvent): void {
  // Container setup
  const alertBox = document.createElement("div");
  alertBox.style.position = "fixed";
  alertBox.style.bottom = "20px";
  alertBox.style.right = "20px";
  alertBox.style.zIndex = "999999";
  alertBox.style.backgroundColor = "white";
  alertBox.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  alertBox.style.padding = "16px";
  alertBox.style.borderRadius = "8px";
  alertBox.style.fontFamily = "sans-serif";
  alertBox.style.fontSize = "14px";
  alertBox.style.color = "#333";
  alertBox.style.maxWidth = "320px";
  alertBox.style.display = "flex";
  alertBox.style.flexDirection = "column";
  alertBox.style.gap = "12px";

  // Message body
  const messageSpan = document.createElement("span");
  messageSpan.textContent = alert.message;
  messageSpan.style.fontWeight = "500";
  alertBox.appendChild(messageSpan);

  // Actions container
  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.gap = "8px";
  buttonRow.style.justifyContent = "flex-end";

  // Dismiss button
  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.style.border = "none";
  dismissBtn.style.background = "#eeeeee";
  dismissBtn.style.padding = "6px 12px";
  dismissBtn.style.borderRadius = "4px";
  dismissBtn.style.cursor = "pointer";
  dismissBtn.style.fontWeight = "600";

  // Snooze Button
  const snoozeBtn = document.createElement("button");
  snoozeBtn.textContent = "Snooze (5m)";
  snoozeBtn.style.border = "none";
  snoozeBtn.style.background = "#007bff";
  snoozeBtn.style.color = "white";
  snoozeBtn.style.padding = "6px 12px";
  snoozeBtn.style.borderRadius = "4px";
  snoozeBtn.style.cursor = "pointer";
  snoozeBtn.style.fontWeight = "600";

  buttonRow.appendChild(dismissBtn);
  buttonRow.appendChild(snoozeBtn);
  alertBox.appendChild(buttonRow);
  document.body.appendChild(alertBox);

  // Interactions and cleanup timers
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    if (alertBox.parentNode) {
      alertBox.parentNode.removeChild(alertBox);
    }
  };

  // Auto-dismiss after 8 seconds
  const autoDimissTimer = setTimeout(() => {
    cleanup();
  }, 8000);

  dismissBtn.addEventListener("click", () => {
    clearTimeout(autoDimissTimer);
    try {
       // Note: To cleanly update the global alert state without cross-origin IndexedDB bugs
       // it's best to inform background, but since there is no native message mapped for handling DB actions,
       // we just hit our scoped DB interface or send an opaque ping. 
       // For exact spec compliance: "dismissAlert(alertId): marks alert dismissed in DB" (which is in AlertEngine).
       chrome.runtime.sendMessage({ type: "ALERT_DISMISSED", payload: { alertId: alert.alertId } });
    } catch(e) {}
    cleanup();
  });

  snoozeBtn.addEventListener("click", () => {
    clearTimeout(autoDimissTimer);
    try {
       chrome.runtime.sendMessage({ type: "ALERT_SNOOZED", payload: { alertId: alert.alertId, minutes: 5 } });
    } catch(e) {}
    cleanup();
  });
}

async function checkConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_CONSENT' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(response?.granted === true);
    });
  });
}

/**
 * Initializes the camera and evaluation loop natively if consent exists contextually.
 */
async function initializeCameraLoop() {
  if (cameraRunning) return;
  
  try {
    console.log('[EyeGuard] Requesting camera...');
    // Camera access explicitly approved
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    console.log('[EyeGuard] Camera stream acquired');
    cameraRunning = true;
    
    videoElement = document.createElement("video");
    videoElement.style.display = "none";
    videoElement.autoplay = true;
    videoElement.srcObject = stream;

    // Load Mesh Processor securely
    faceMeshProcessor = new FaceMeshProcessor();

    // Start 5 fps polling hook
    captureInterval = window.setInterval(async () => {
      if (!videoElement || !faceMeshProcessor) return;
      
      const frameData = await faceMeshProcessor.processFrame(videoElement);
      
      // Send resulting SensorFrame to service worker securely mapped without biometrics
      chrome.runtime.sendMessage({ type: "SENSOR_FRAME", payload: frameData }).catch(() => {
          // Ignore messaging port closure errors natively
      });
      
    }, 200);
    console.log('[EyeGuard] Monitoring loop started');

  } catch (err) {
    console.error("EyeGuard Camera Initialization Error:", err);
  }
}

/**
 * Stops the camera and monitoring loop.
 */
function stopCameraLoop() {
  if (!cameraRunning) return;
  
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  if (videoElement && videoElement.srcObject) {
    const stream = videoElement.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }

  cameraRunning = false;
  console.log('[EyeGuard] Monitoring loop stopped');
}

// 3. Listen for SW payloads dynamically
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'CONSENT_GRANTED') {
    initializeCameraLoop(); // idempotent guard inside prevents double-start
  }
  if (message.type === 'STOP_CAMERA') {
    stopCameraLoop();
  }
  if (message.type === 'SHOW_ALERT') {
    if (message.alert) injectAlert(message.alert);
  }
  if (message.type === 'APPLY_CORRECTION') {
    if (message.profile) applyCorrection(message.profile);
  }
  if (message.type === 'REMOVE_CORRECTION') {
    removeCorrection();
  }
});

// Bootstrapper hook
(async () => {
  const alreadyGranted = await checkConsent();
  if (alreadyGranted) {
    initializeCameraLoop();
  }
})();
