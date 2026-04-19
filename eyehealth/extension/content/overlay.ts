import { AlertEvent } from "../db/schema";
import { FaceMeshProcessor } from "../cv/face-mesh";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// State pointers
let videoElement: HTMLVideoElement | null = null;
let captureInterval: number | null = null;
let faceMeshProcessor: FaceMeshProcessor | null = null;
let cameraRunning = false;
let hudElement: HTMLDivElement | null = null;
let hudAccentBar: HTMLDivElement | null = null;
let hudContent: HTMLDivElement | null = null;
let isHudMinimized = false;
let hudIconElement: HTMLDivElement | null = null;
let currentTheme: 'light' | 'dark' = 'light';

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

/**
 * Injects a small, temporary toast (snackbar) notification for status updates.
 */
export function injectToast(message: string): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.setProperty("position", "fixed", "important");
  toast.style.setProperty("bottom", "20px", "important");
  toast.style.setProperty("left", "20px", "important");
  toast.style.setProperty("z-index", "2147483647", "important");
  toast.style.setProperty("background-color", "rgba(0, 0, 0, 0.85)", "important");
  toast.style.setProperty("color", "#ffffff", "important");
  toast.style.setProperty("padding", "12px 20px", "important");
  toast.style.setProperty("border-radius", "25px", "important");
  toast.style.setProperty("font-size", "14px", "important");
  toast.style.setProperty("font-weight", "600", "important");
  toast.style.setProperty("font-family", "'Outfit', 'Inter', -apple-system, sans-serif", "important");
  toast.style.setProperty("pointer-events", "none", "important");
  toast.style.setProperty("box-shadow", "0 4px 15px rgba(0,0,0,0.3)", "important");
  toast.style.setProperty("transition", "opacity 0.4s ease, transform 0.4s ease", "important");
  toast.style.setProperty("opacity", "0", "important");
  toast.style.setProperty("transform", "translateY(20px)", "important");

  // Attempt to target top window if in an iframe or just ensure root access
  const target = document.body || document.documentElement;
  target.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.setProperty("opacity", "1", "important");
    toast.style.setProperty("transform", "translateY(0)", "important");
  });

  // Fade out and remove
  setTimeout(() => {
    toast.style.setProperty("opacity", "0", "important");
    toast.style.setProperty("transform", "translateY(10px)", "important");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 400);
  }, 4000); // 4 seconds visibility
}

/**
 * Injects the Status HUD (Heads-Up Display) into the webpage.
 * Designed with a Professional Corporate Pastel aesthetic.
 */
function injectStatusHUD(): void {
  if (hudElement) return;

  hudElement = document.createElement("div");
  hudElement.id = "eyeguard-hud";
  
  // Style the main container (Pastel White)
  Object.assign(hudElement.style, {
    position: "fixed",
    top: "20px",
    left: "20px",
    width: "320px",
    backgroundColor: currentTheme === 'dark' ? "rgba(26, 26, 26, 0.98)" : "#FFFFFF",
    borderRadius: "8px",
    boxShadow: currentTheme === 'dark' ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 30px rgba(0,0,0,0.12)",
    zIndex: "2147483647",
    display: "flex",
    overflow: "hidden",
    fontFamily: "'Inter', -apple-system, sans-serif",
    transition: "transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease",
    border: currentTheme === 'dark' ? "1px solid #333333" : "1px solid #E0E0E0"
  });

  // Accent Bar (Left side)
  hudAccentBar = document.createElement("div");
  Object.assign(hudAccentBar.style, {
    width: "6px",
    backgroundColor: "#0056b3",
    transition: "background-color 0.4s ease"
  });

  // Content Container
  hudContent = document.createElement("div");
  Object.assign(hudContent.style, {
    padding: "12px 16px",
    flex: "1",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  });

  const header = document.createElement("div");
  header.textContent = "EYEGUARD MONITOR";
  Object.assign(header.style, {
    fontSize: "10px",
    fontWeight: "800",
    color: "#666",
    letterSpacing: "1px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  });

  // Minimize Button
  const minBtn = document.createElement("div");
  minBtn.textContent = "—";
  Object.assign(minBtn.style, {
    cursor: "pointer",
    padding: "0 4px",
    fontSize: "14px",
    transition: "color 0.2s"
  });
  minBtn.onclick = toggleHUD;
  header.appendChild(minBtn);

  const message = document.createElement("div");
  message.id = "eyeguard-hud-msg";
  message.textContent = "System active. Initializing...";
  Object.assign(message.style, {
    fontSize: "13px",
    fontWeight: "600",
    color: currentTheme === 'dark' ? "#F0F0F0" : "#333",
    lineHeight: "1.4"
  });

  hudContent.appendChild(header);
  hudContent.appendChild(message);
  hudElement.appendChild(hudAccentBar);
  hudElement.appendChild(hudContent);
  
  (document.body || document.documentElement).appendChild(hudElement);

  // Inject Minimized Icon (hidden by default)
  injectStatusIcon();
}

/**
 * Creates the small floating eye icon for minimized state.
 */
function injectStatusIcon(): void {
  if (hudIconElement) return;

  hudIconElement = document.createElement("div");
  hudIconElement.id = "eyeguard-hud-icon";
  hudIconElement.innerHTML = "👁️";
  
  Object.assign(hudIconElement.style, {
    position: "fixed",
    top: "20px",
    left: "20px",
    width: "48px",
    height: "48px",
    backgroundColor: "#FFFFFF",
    borderRadius: "50%",
    boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
    zIndex: "2147483647",
    display: "none", // Hidden by default
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    cursor: "pointer",
    border: "2px solid #0056b3",
    transition: "transform 0.2s ease, background-color 0.3s ease, border-color 0.3s ease"
  });

  hudIconElement.onclick = toggleHUD;
  (document.body || document.documentElement).appendChild(hudIconElement);
}

/**
 * Toggles between full HUD and minimized icon.
 */
function toggleHUD(): void {
  isHudMinimized = !isHudMinimized;
  if (!hudElement || !hudIconElement) return;

  if (isHudMinimized) {
    hudElement.style.display = "none";
    hudIconElement.style.display = "flex";
  } else {
    hudElement.style.display = "flex";
    hudIconElement.style.display = "none";
  }
}

/**
 * Updates the HUD with real-time messages and color states.
 */
function updateStatusHUD(level: 'info' | 'success' | 'warning' | 'error' | 'notice', msg: string): void {
  if (!hudElement || !hudAccentBar || !hudContent || !hudIconElement) return;

  const msgEl = document.getElementById("eyeguard-hud-msg");
  if (msgEl) {
    msgEl.textContent = msg;
    msgEl.style.color = currentTheme === 'dark' ? "#F0F0F0" : "#333";
  }

  let color = "#0056b3"; // Default Info Blue

  switch (level) {
    case 'success': color = "#28a745"; break;
    case 'warning': color = "#fd7e14"; break;
    case 'error': color = "#dc3545"; break;
    case 'notice': color = "#0056b3"; break;
    case 'info': color = "#0056b3"; break;
  }

  hudAccentBar.style.backgroundColor = color;
  hudIconElement.style.borderColor = color;
  
  if (level === 'error' || level === 'warning') {
    hudElement.style.borderColor = color;
  } else {
    hudElement.style.borderColor = currentTheme === 'dark' ? "#333333" : "#E0E0E0";
  }
  
  // Dynamic update for background
  hudElement.style.backgroundColor = currentTheme === 'dark' ? "rgba(26, 26, 26, 0.98)" : "#FFFFFF";
  hudIconElement.style.backgroundColor = currentTheme === 'dark' ? "#1E1E1E" : "#FFFFFF";
}

/**
 * Injects the Main-World interceptor script to handle 404 redirection
 * within the website context.
 */
function injectMainInterceptor(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/main-world.js');
  script.setAttribute('data-extension-id', chrome.runtime.id);
  (document.head || document.documentElement).appendChild(script);
  console.log('[EyeGuard] Main-world interceptor injected via script tag');
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
  injectStatusHUD();
  
  try {
    updateStatusHUD('info', "EyeGuard is initializing deep-vision models... Please ensure camera is unobstructed.");
    console.log('[EyeGuard] Requesting camera...');
    
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    console.log('[EyeGuard] Camera stream acquired');
    updateStatusHUD('info', "Camera Switched On. Configuring AI engine...");
    cameraRunning = true;
    
    videoElement = document.createElement("video");
    videoElement.style.display = "none";
    videoElement.autoplay = true;
    videoElement.srcObject = stream;

    // Wait for video to have dimensions
    await new Promise((resolve) => {
        if (!videoElement) return resolve(false);
        videoElement.onloadedmetadata = () => resolve(true);
    });

    // Load Mesh Processor securely
    try {
      faceMeshProcessor = new FaceMeshProcessor();
      // Test the initialization path
      updateStatusHUD('info', "Calculating distance and optimizing vision... Please hold still.");
    } catch (e) {
      console.error("[EyeGuard] AI Engine Error:", e);
      updateStatusHUD('error', "AI LOADING FAILED: Model assets blocked or missing. Please reload.");
      return;
    }

    // Start 5 fps polling hook
    let lastFaceState = false;

    captureInterval = window.setInterval(async () => {
      if (!videoElement || !faceMeshProcessor) return;
      
      try {
        const frameData = await faceMeshProcessor.processFrame(videoElement);
        
        // Update HUD based on frame state
        if (frameData.faceDetected) {
            if (frameData.screenDistanceCm < 50) {
                updateStatusHUD('warning', `POSTURE ALERT: Leaning too close. Please move back (Target: 50cm+, Current: ${Math.round(frameData.screenDistanceCm)}cm).`);
            } else {
                updateStatusHUD('success', `Tracking Active: Optimal posture detected [${Math.round(frameData.screenDistanceCm)}cm]. EyeGuard is protecting your vision.`);
            }
        } else {
            updateStatusHUD('notice', "Searching: No face detected. Please align yourself with the camera to continue tracking.");
        }

        // UX logic: Notify console of detection transitions
        if (frameData.faceDetected !== lastFaceState) {
          lastFaceState = frameData.faceDetected;
          console.log(lastFaceState ? '[EyeGuard] Face detected' : '[EyeGuard] Face lost - searching...');
        }

        // Send resulting SensorFrame to service worker
        chrome.runtime.sendMessage({ type: "SENSOR_FRAME", payload: frameData }).catch(() => {});
      } catch (err) {
          // Check for CSP block or model load failure
          if (err.toString().includes('is not a valid') || err.toString().includes('Script error')) {
            updateStatusHUD('error', "SECURITY BLOCK: This website is preventing EyeGuard from loading AI assets.");
          }
      }
      
    }, 200);
    console.log('[EyeGuard] Monitoring loop started');

  } catch (err: any) {
    console.error("EyeGuard Camera Initialization Error:", err);
    if (err.name === 'NotAllowedError') {
      updateStatusHUD('error', "CAMERA BLOCKED: Please check site permissions or ensure camera isn't covered.");
    } else {
      updateStatusHUD('error', "SYSTEM ERROR: " + err.message);
    }
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
  updateStatusHUD('notice', "Camera Switched Off. Monitoring paused.");
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
  if (message.type === 'THEME_CHANGED') {
    currentTheme = message.theme;
    if (hudElement) {
        // Force refresh styles
        updateStatusHUD('info', document.getElementById("eyeguard-hud-msg")?.textContent || "");
    }
  }
});

// Bootstrapper hook
(async () => {
  // 0. Inject Main-world interceptor via script tag injection
  // This is required to catch MediaPipe loader requests in the page context.
  injectMainInterceptor();

  // 1. Load Theme from storage
  const settings = await chrome.storage.local.get('theme');
  currentTheme = settings.theme || 'light';

  // 2. Initialize Status HUD
  injectStatusHUD();
  updateStatusHUD('info', "[EyeGuard] System check... verifying permissions.");

  const alreadyGranted = await checkConsent();
  if (alreadyGranted) {
    initializeCameraLoop();
  } else {
    updateStatusHUD('notice', "EyeGuard is ready. Please grant camera access via the extension popup.");
  }
})();
