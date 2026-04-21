import { AlertEvent } from "../db/schema";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// State pointers
let videoElement: HTMLVideoElement | null = null;
let captureInterval: number | null = null;
let cameraRunning = false;
let hudElement: HTMLDivElement | null = null;
let hudAccentBar: HTMLDivElement | null = null;
let hudContent: HTMLDivElement | null = null;
let isHudMinimized = false;
let hudIconElement: HTMLDivElement | null = null;
let currentTheme: 'light' | 'dark' = 'light';
let websiteStyleElement: HTMLStyleElement | null = null;
let hudPos = { top: 20, left: 20 };
let keepaliveInterval: any = null;

const STYLES_BUNDLE_ID = 'eyeguard-styles-bundle';

function ensureStylesInjected() {
  if (document.getElementById(STYLES_BUNDLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_BUNDLE_ID;
  style.innerHTML = `
    :root {
      --eg-bg-primary: #ffffff;
      --eg-bg-secondary: #f5f4f0;
      --eg-border: rgba(0,0,0,0.15);
      --eg-text-p: #1a1a18;
      --eg-text-s: #6b6a63;
      --eg-blue: #378ADD;
      --eg-blue-bg: #E6F1FB;
      --eg-green: #1D9E75;
      --eg-green-bg: #EAF3DE;
      --eg-red: #E24B4A;
      --eg-red-bg: #FCEBEB;
      --eg-amber: #EF9F27;
      --eg-amber-bg: #FAEEDA;
    }
    .eg-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      font-family: -apple-system, sans-serif;
      white-space: nowrap;
      transition: background 0.3s, color 0.3s;
      margin-top: 4px;
      display: inline-block;
      align-self: flex-start;
      font-weight: 500;
    }
  `;
  document.head.appendChild(style);
}

// Ensure styles are injected at the start
ensureStylesInjected();

/**
 * Injects a floating alert notification into the corner of the active webpage.
 */
export function injectAlert(alert: AlertEvent): void {
  const alertBox = document.createElement("div");
  alertBox.className = "eg-alert-toast";

  const dotClass = alert.severity === 'critical' ? 'eg-dot-red' : alert.severity === 'warning' ? 'eg-dot-amber' : 'eg-dot-blue';
  
  alertBox.innerHTML = `
    <div class="eg-alert-dot ${dotClass}"></div>
    <div class="eg-alert-body">
      <div class="eg-alert-title">${alert.message.split(' — ')[0]}</div>
      <div class="eg-alert-sub">${alert.message.split(' — ')[1] || 'Action recommended'}</div>
    </div>
    <div class="eg-alert-actions">
      <button class="eg-alert-btn" id="eg-snooze">5 min</button>
      <button class="eg-alert-btn" id="eg-dismiss">Dismiss</button>
    </div>
  `;

  document.body.appendChild(alertBox);

  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    if (alertBox.parentNode) alertBox.parentNode.removeChild(alertBox);
  };

  const autoDismissTimer = setTimeout(cleanup, 8000);

  alertBox.querySelector('#eg-dismiss')?.addEventListener("click", () => {
    clearTimeout(autoDismissTimer);
    try {
      chrome.runtime.sendMessage({ type: "ALERT_DISMISSED", payload: { alertId: alert.alertId } });
    } catch(e) {}
    cleanup();
  });

  alertBox.querySelector('#eg-snooze')?.addEventListener("click", () => {
    clearTimeout(autoDismissTimer);
    try {
      chrome.runtime.sendMessage({ type: "ALERT_SNOOZED", payload: { alertId: alert.alertId, minutes: 5 } });
    } catch(e) {}
    cleanup();
  });
}

/**
 * Injects a small toast notification for status updates.
 */
export function injectToast(message: string): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.setProperty("position", "fixed", "important");
  toast.style.setProperty("bottom", "20px", "important");
  toast.style.setProperty("left", "20px", "important");
  toast.style.setProperty("z-index", "2147483647", "important");
  toast.style.setProperty("background-color", "rgba(0, 0, 0, 0.85)", "important");
  toast.style.setProperty("color", "var(--eg-bg-primary)", "important");
  toast.style.setProperty("padding", "12px 20px", "important");
  toast.style.setProperty("border-radius", "25px", "important");
  toast.style.setProperty("font-size", "14px", "important");
  toast.style.setProperty("font-weight", "600", "important");
  toast.style.setProperty("font-family", "-apple-system, sans-serif", "important");
  toast.style.setProperty("pointer-events", "none", "important");
  toast.style.setProperty("box-shadow", "0 4px 15px rgba(0,0,0,0.3)", "important");
  toast.style.setProperty("transition", "opacity 0.4s ease, transform 0.4s ease", "important");
  toast.style.setProperty("opacity", "0", "important");
  toast.style.setProperty("transform", "translateY(20px)", "important");

  const target = document.body || document.documentElement;
  target.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.setProperty("opacity", "1", "important");
    toast.style.setProperty("transform", "translateY(0)", "important");
  });

  setTimeout(() => {
    toast.style.setProperty("opacity", "0", "important");
    toast.style.setProperty("transform", "translateY(10px)", "important");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 400);
  }, 4000);
}

/**
 * Injects the Status HUD into the webpage.
 */
function injectStatusHUD(): void {
  if (hudElement) return;

  ensureStylesInjected();

  hudElement = document.createElement("div");
  hudElement.id = "eyeguard-hud";

  Object.assign(hudElement.style, {
    position: "fixed",
    top: `${hudPos.top}px`,
    left: `${hudPos.left}px`,
    width: "320px",
    backgroundColor: currentTheme === 'dark' ? "rgba(26, 26, 26, 0.98)" : "var(--eg-bg-primary)",
    borderRadius: "8px",
    boxShadow: currentTheme === 'dark' ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 30px rgba(0,0,0,0.12)",
    zIndex: "2147483647",
    display: "flex",
    overflow: "hidden",
    fontFamily: "-apple-system, sans-serif",
    transition: "transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease",
    border: currentTheme === 'dark' ? "1px solid #333333" : "1px solid var(--eg-border)",
    cursor: "default"
  });

  hudAccentBar = document.createElement("div");
  Object.assign(hudAccentBar.style, {
    width: "6px",
    backgroundColor: "var(--eg-blue)",
    transition: "background-color 0.4s ease"
  });

  hudContent = document.createElement("div");
  Object.assign(hudContent.style, {
    padding: "12px 16px",
    flex: "1",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  });

  const badge = document.createElement('div');
  badge.id = 'eyeguard-status-badge';
  badge.className = 'eg-badge';
  badge.style.background = 'var(--eg-blue-bg)';
  badge.style.color = 'var(--eg-blue)';
  badge.textContent = 'Initializing...';
  hudContent.appendChild(badge);

  hudElement.appendChild(hudAccentBar);
  hudElement.appendChild(hudContent);

  (document.body || document.documentElement).appendChild(hudElement);

  injectStatusIcon();
}

function injectStatusIcon(): void {
  if (hudIconElement) return;

  hudIconElement = document.createElement("div");
  hudIconElement.id = "eyeguard-hud-icon";

  const iconImg = document.createElement("img");
  iconImg.src = chrome.runtime.getURL("icons/icon48.png");
  Object.assign(iconImg.style, {
    width: "28px",
    height: "28px",
    objectFit: "contain"
  });
  hudIconElement.appendChild(iconImg);

  Object.assign(hudIconElement.style, {
    position: "fixed",
    top: `${hudPos.top}px`,
    left: `${hudPos.left}px`,
    width: "48px",
    height: "48px",
    backgroundColor: "var(--eg-bg-primary)",
    borderRadius: "50%",
    boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
    zIndex: "2147483647",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
    cursor: "pointer",
    border: "2px solid var(--eg-blue)",
    transition: "transform 0.2s ease, background-color 0.3s ease, border-color 0.3s ease"
  });

  hudIconElement.onclick = toggleHUD;
  makeDraggable(hudIconElement);
  (document.body || document.documentElement).appendChild(hudIconElement);
}

function makeDraggable(el: HTMLElement) {
  let offsetX = 0, offsetY = 0;

  el.onmousedown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.onmousemove = elementDrag;
    document.onmouseup = closeDragElement;
    el.style.transition = "none";
    el.style.cursor = "grabbing";
  };

  function elementDrag(e: MouseEvent) {
    e.preventDefault();
    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;
    const padding = 10;
    newX = Math.max(padding, Math.min(newX, window.innerWidth - el.offsetWidth - padding));
    newY = Math.max(padding, Math.min(newY, window.innerHeight - el.offsetHeight - padding));
    hudPos.top = newY;
    hudPos.left = newX;
    if (hudElement) {
      hudElement.style.top = `${newY}px`;
      hudElement.style.left = `${newX}px`;
    }
    if (hudIconElement) {
      hudIconElement.style.top = `${newY}px`;
      hudIconElement.style.left = `${newX}px`;
    }
  }

  function closeDragElement() {
    document.onmousemove = null;
    document.onmouseup = null;
    el.style.transition = "transform 0.3s ease, opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease";
    el.style.cursor = "default";
  }
}

function updateWebsiteTheme(): void {
  if (currentTheme === 'dark') {
    if (!websiteStyleElement) {
      websiteStyleElement = document.createElement("style");
      websiteStyleElement.id = "eyeguard-dark-mode";
      websiteStyleElement.innerHTML = `
        html {
          filter: invert(0.9) hue-rotate(180deg) !important;
          background: #fff !important;
        }
        img, video, iframe, canvas,
        #eyeguard-hud, #eyeguard-hud-icon,
        [style*="background-image"] {
          filter: invert(1.1) hue-rotate(180deg) !important;
        }
      `;
      (document.head || document.documentElement).appendChild(websiteStyleElement);
    }
  } else {
    if (websiteStyleElement) {
      websiteStyleElement.remove();
      websiteStyleElement = null;
    }
  }
}

function toggleHUD(): void {
  isHudMinimized = !isHudMinimized;
  if (!hudElement || !hudIconElement) return;

  if (isHudMinimized) {
    hudElement.style.display = "none";
    hudIconElement.style.display = "flex";
    hudIconElement.style.top = `${hudPos.top}px`;
    hudIconElement.style.left = `${hudPos.left}px`;
  } else {
    hudElement.style.display = "flex";
    hudIconElement.style.display = "none";
    hudElement.style.top = `${hudPos.top}px`;
    hudElement.style.left = `${hudPos.left}px`;
  }
}

function updateStatusHUD(level: 'info' | 'success' | 'warning' | 'error' | 'notice', msg: string): void {
  if (!hudElement || !hudAccentBar || !hudContent || !hudIconElement) return;

  const msgEl = document.getElementById("eyeguard-hud-msg");
  if (msgEl) {
    msgEl.textContent = msg;
    msgEl.style.color = currentTheme === 'dark' ? "#F0F0F0" : "var(--eg-text-p)";
  }

  let color = "var(--eg-blue)";
  switch (level) {
    case 'success': color = "var(--eg-green)"; break;
    case 'warning': color = "var(--eg-amber)"; break;
    case 'error':   color = "var(--eg-red)"; break;
    case 'notice':  color = "var(--eg-blue)"; break;
    case 'info':    color = "var(--eg-blue)"; break;
  }

  hudAccentBar.style.backgroundColor = color;
  hudIconElement.style.borderColor = color;

  if (level === 'error' || level === 'warning') {
    hudElement.style.borderColor = color;
  } else {
    hudElement.style.borderColor = currentTheme === 'dark' ? "#333333" : "var(--eg-border)";
  }

  hudElement.style.backgroundColor = currentTheme === 'dark' ? "rgba(26, 26, 26, 0.98)" : "var(--eg-bg-primary)";
  hudIconElement.style.backgroundColor = currentTheme === 'dark' ? "#1E1E1E" : "var(--eg-bg-primary)";

  updateWebsiteTheme();
}

function updateHudStatus(frame: any) {
  const badge = document.getElementById('eyeguard-status-badge');
  if (!badge) return;

  if (!frame.faceDetected) {
    badge.textContent = 'No face detected';
    badge.style.background = 'var(--eg-amber-bg)';
    badge.style.color = 'var(--eg-amber)';
    return;
  }

  const dist = Math.round(frame.screenDistanceCm);
  const blink = Math.round(frame.blinkRate);
  badge.textContent = `${dist}cm · ${blink}/min`;
  badge.style.background = dist < 50 ? 'var(--eg-red-bg)' : 'var(--eg-green-bg)';
  badge.style.color = dist < 50 ? 'var(--eg-red)' : 'var(--eg-green)';
}

function startKeepalive() {
  if (keepaliveInterval) return;
  console.log('[EyeGuard:overlay] Starting keepalive heartbeat');
  keepaliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'KEEPALIVE' })
      .catch(() => {
        console.log('[EyeGuard:overlay] SW was sleeping, restarting session');
        startSession();
      });
  }, 25000);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    console.log('[EyeGuard:overlay] STOP keepalive called from:', new Error().stack);
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    console.log('[EyeGuard:overlay] Stopped keepalive heartbeat');
  }
}

/**
 * Injects the Main-World interceptor script.
 * CRITICAL: Also appends the video element to the page DOM so main-world.ts
 * can find it via document.getElementById('eyeguard-video').
 */
function injectMainInterceptor(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/main-world.js');
  script.setAttribute('data-ext-id', chrome.runtime.id);
  (document.head || document.documentElement).appendChild(script);
  console.log('[EyeGuard] Main-world interceptor injected via script tag');
}

function startSession() {
  chrome.runtime.sendMessage({
    type: 'START_SESSION',
    payload: { platform: 'chrome-extension' }
  }).catch(() => {});
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
 * Initializes the camera and passes the video element to main-world
 * via a named DOM element so MediaPipe can process it.
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

    // Create video element and give it a known ID so main-world.ts can find it
    videoElement = document.createElement("video");
    videoElement.id = "eyeguard-video";           // KEY FIX — named so main-world finds it
    videoElement.style.position = "fixed";
    videoElement.style.top = "0";
    videoElement.style.left = "0";
    videoElement.style.width = "100vw";
    videoElement.style.height = "100vh";
    videoElement.style.zIndex = "1"; // Ensure video is behind other elements
    videoElement.style.pointerEvents = "none"; // Prevent interaction
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true;
    videoElement.srcObject = stream;

    // Must be in DOM for MediaPipe to read frames from it
    (document.body || document.documentElement).appendChild(videoElement);

    // Ensure canvas is properly layered and sized
    const canvas = document.createElement("canvas");
    canvas.id = "eyeguard-canvas";
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.zIndex = "2"; // Ensure canvas is above video
    canvas.style.pointerEvents = "none"; // Prevent interaction
    (document.body || document.documentElement).appendChild(canvas);

    await new Promise<void>((resolve) => {
      if (!videoElement) return resolve();
      videoElement.onloadedmetadata = () => resolve();
    });

    await videoElement.play();

    console.log('[EyeGuard] Monitoring loop starting via Main World bridge');
    console.log('[EyeGuard] Video dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);

    // Signal main-world that video is ready
    window.postMessage({ type: 'EYEGUARD_VIDEO_READY', videoId: 'eyeguard-video' }, '*');

    startSession();
    startKeepalive();

  } catch (err: any) {
    cameraRunning = false;
    console.error("EyeGuard Camera Initialization Error:", err);
    if (err.name === 'NotAllowedError') {
      updateStatusHUD('error', "CAMERA BLOCKED: Please check site permissions.");
    } else {
      updateStatusHUD('error', "SYSTEM ERROR: " + err.message);
    }
  }
}

function stopCameraLoop() {
  if (!cameraRunning) return;
  console.log('[EyeGuard:overlay] STOP camera loop called from:', new Error().stack);

  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  if (videoElement) {
    if (videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
    }
    // Signal main-world to stop processing
    window.postMessage({ type: 'EYEGUARD_STOP' }, '*');
    if (videoElement.parentNode) videoElement.parentNode.removeChild(videoElement);
    videoElement = null;
  }

  cameraRunning = false;
  stopKeepalive();
  updateStatusHUD('notice', "Camera Switched Off. Monitoring paused.");
  console.log('[EyeGuard] Monitoring loop stopped');
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'START_CAMERA') {
    console.log('[EyeGuard:overlay] START_CAMERA received from SW');
    if (!cameraRunning) {
      console.log('[EyeGuard:overlay] Camera was stopped — restarting now');
      initializeCameraLoop();
    } else {
      console.log('[EyeGuard:overlay] Camera already running — ignoring');
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CONSENT_GRANTED') {
    if (!cameraRunning) initializeCameraLoop();
    return true;
  }

  if (message.type === 'STOP_CAMERA' || message.type === 'STOP_MONITORING') {
    console.log('[EyeGuard:overlay] STOP message received — verifying consent');
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'CHECK_CONSENT' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[EyeGuard:overlay] Could not reach SW for consent check');
          return;
        }
        if (response?.granted === true) {
          console.log('[EyeGuard:overlay] STOP ignored — consent is valid');
          return;
        }
        console.log('[EyeGuard:overlay] STOP confirmed — stopping');
        stopCameraLoop();
      });
    }, 300);
    return true;
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
      updateStatusHUD('info', document.getElementById("eyeguard-hud-msg")?.textContent || "");
    }
  }
});

// Bridge: Receive frames from Main World
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'EYEGUARD_FRAME') return;

  const frameData = event.data.payload;

  updateHudStatus(frameData);

  if (frameData.faceDetected) {
    if (frameData.screenDistanceCm < 50) {
      updateStatusHUD('warning', `POSTURE ALERT: Too close! Move back (${Math.round(frameData.screenDistanceCm)}cm).`);
    } else {
      updateStatusHUD('success', `Tracking Active: ${Math.round(frameData.screenDistanceCm)}cm · ${Math.round(frameData.blinkRate)}/min`);
    }
  } else {
    updateStatusHUD('notice', "Searching: No face detected. Align with camera.");
  }

  chrome.runtime.sendMessage({
    type: "SENSOR_FRAME",
    payload: {
      screenDistanceCm: frameData.screenDistanceCm,
      blinkRate: frameData.blinkRate,
      ambientLuxLevel: frameData.ambientLuxLevel,
      faceDetected: frameData.faceDetected,
      landmarks: frameData.landmarks
    }
  }).catch(() => {});

  if (Date.now() % 5000 < 200) {
    console.log('[EyeGuard:overlay] Frame forwarded:',
      'dist:', Math.round(frameData.screenDistanceCm),
      'blink:', Math.round(frameData.blinkRate),
      'face:', frameData.faceDetected);
  }
});

// Bootstrapper
(async () => {
  injectMainInterceptor();

  const settings = await chrome.storage.local.get('theme');
  currentTheme = settings.theme || 'light';

  injectStatusHUD();
  updateWebsiteTheme();
  updateStatusHUD('info', "[EyeGuard] System check... verifying permissions.");

  const alreadyGranted = await checkConsent();
  if (alreadyGranted) {
    console.log('[EyeGuard:overlay] Consent confirmed on load — starting camera');
    initializeCameraLoop();
  } else {
    console.log('[EyeGuard:overlay] No consent on load — waiting for START_CAMERA');
    updateStatusHUD('notice', "EyeGuard ready. Please grant camera access via the extension popup.");
  }
})();
