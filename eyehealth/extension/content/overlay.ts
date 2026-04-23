import { AlertEvent } from "../db/schema";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// State pointers
let hudElement: HTMLDivElement | null = null;
let hudAccentBar: HTMLDivElement | null = null;
let hudContent: HTMLDivElement | null = null;
let isHudMinimized = false;
let hudIconElement: HTMLDivElement | null = null;
let currentTheme: 'light' | 'dark' = 'light';
let websiteStyleElement: HTMLStyleElement | null = null;
let hudPos = { top: 20, left: 20 };
let keepaliveInterval: any = null;

// Declare hudVisible globally
let hudVisible: boolean = false;

// Toast State
let isToastMinimized = false;
let lastReceivedAlert: AlertEvent | null = null;
let currentToastElement: HTMLElement | null = null;
let toastIconElement: HTMLElement | null = null;
let lottieInstance: any = null;

function loadLottie(): Promise<any> {
  return new Promise((resolve) => {
    if ((window as any).lottie) {
      resolve((window as any).lottie);
      return;
    }
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js";
    script.onload = () => resolve((window as any).lottie);
    (document.head || document.documentElement).appendChild(script);
  });
}

// Camera management
let monitoringStream: MediaStream | null = null;
let monitoringVideo: HTMLVideoElement | null = null;

// Alert Logic State
let alertCounters = {
  distance: 0,
  blink: 0,
  usage: 0,
  lastAlert: 0
};
const ALERT_THRESHOLDS = {
  DISTANCE_SECS: 5,   // 5 consecutive frames (~2.5s) of low distance
  BLINK_MINS: 1,      // check every minute
  USAGE_MINS: 20      // 20-20-20 rule
};
let activeAlerts: Map<string, HTMLElement> = new Map();

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
    .eg-alert-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 320px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.15);
      padding: 16px;
      z-index: 2147483647;
      display: flex;
      gap: 12px;
      font-family: -apple-system, sans-serif;
      border: 1px solid var(--eg-border);
      transition: all 0.3s ease;
    }
    .eg-alert-toast.minimized {
      width: 48px;
      height: 48px;
      padding: 0;
      border-radius: 50%;
      overflow: hidden;
      cursor: pointer;
    }
    .eg-alert-toast.minimized .eg-alert-body, 
    .eg-alert-toast.minimized .eg-alert-actions,
    .eg-alert-toast.minimized .eg-alert-dot {
      display: none;
    }
    .eg-alert-toast.minimized .eg-alert-icon-min {
      display: flex !important;
    }
    .eg-alert-icon-min {
      display: none;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
      background: var(--eg-blue);
    }
    .eg-alert-icon-min img {
      width: 24px;
      height: 24px;
      filter: brightness(0) invert(1);
    }
    .eg-alert-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
    .eg-dot-red { background: var(--eg-red); }
    .eg-dot-amber { background: var(--eg-amber); }
    .eg-dot-blue { background: var(--eg-blue); }
    .eg-alert-body { flex: 1; }
    .eg-alert-title { font-weight: 700; font-size: 14px; color: var(--eg-text-p); margin-bottom: 2px; }
    .eg-alert-sub { font-size: 12px; color: var(--eg-text-s); }
    .eg-alert-actions { display: flex; flex-direction: column; gap: 4px; }
    .eg-alert-btn { 
      background: var(--eg-bg-secondary); border: none; padding: 4px 8px; 
      border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
      color: var(--eg-text-p); transition: background 0.2s;
    }
    .eg-alert-btn:hover { background: #e0ded7; }
    .eg-alert-btn.min-btn { background: none; color: var(--eg-blue); }
  `;
  document.head.appendChild(style);
}

/**
 * Injects a floating alert notification into the corner of the active webpage.
 */
export function injectAlert(alert: AlertEvent): void {
  lastReceivedAlert = alert;
  
  if (isToastMinimized) {
    // If already minimized, just update the icon state (maybe a subtle pulse)
    if (!toastIconElement) renderMinimizedIcon();
    return;
  }

  renderAlertToast(alert);
}

function renderAlertToast(alert: AlertEvent) {
  // Clear existing instances
  if (currentToastElement) currentToastElement.remove();
  if (toastIconElement) toastIconElement.remove();

  console.log(`[HUD] showing alert: ${alert.message}`);
  const alertBox = document.createElement("div");
  alertBox.className = "eg-alert-toast";
  currentToastElement = alertBox;

  const dotClass = alert.severity === 'critical' ? 'eg-dot-red' : alert.severity === 'warning' ? 'eg-dot-amber' : 'eg-dot-blue';
  
  alertBox.innerHTML = `
    <div class="eg-alert-dot ${dotClass}"></div>
    <div class="eg-alert-body">
      <div class="eg-alert-title">${alert.message.split(' — ')[0]}</div>
      <div class="eg-alert-sub">${alert.message.split(' — ')[1] || 'Action recommended'}</div>
    </div>
    <div class="eg-alert-actions">
      <button class="eg-alert-btn" id="eg-minimize">Minimize</button>
      <button class="eg-alert-btn" id="eg-dismiss">Dismiss</button>
    </div>
  `;

  document.body.appendChild(alertBox);

  alertBox.querySelector('#eg-dismiss')?.addEventListener("click", () => {
    alertBox.remove();
    currentToastElement = null;
  });

  alertBox.querySelector('#eg-minimize')?.addEventListener("click", () => {
    isToastMinimized = true;
    alertBox.remove();
    currentToastElement = null;
    renderMinimizedIcon();
  });
}

async function renderMinimizedIcon() {
  if (toastIconElement) return;

  const iconContainer = document.createElement("div");
  iconContainer.id = "eg-minimized-icon";
  toastIconElement = iconContainer;

  Object.assign(iconContainer.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '56px',
    height: '56px',
    background: 'white',
    borderRadius: '50%',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    cursor: 'pointer',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    border: '1px solid var(--eg-border)',
    overflow: 'hidden'
  });

  const lottie = await loadLottie();
  
  if (lottie) {
    lottieInstance = lottie.loadAnimation({
      container: iconContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: chrome.runtime.getURL("assets/eye.json")
    });
  } else {
    // Fallback to static PNG if CDN fails
    const iconImg = document.createElement("img");
    iconImg.src = chrome.runtime.getURL("icons/icon48.png");
    iconImg.style.width = '28px';
    iconContainer.appendChild(iconImg);
  }

  iconContainer.addEventListener('mouseenter', () => iconContainer.style.transform = 'scale(1.15)');
  iconContainer.addEventListener('mouseleave', () => iconContainer.style.transform = 'scale(1)');

  iconContainer.onclick = () => {
    isToastMinimized = false;
    if (lottieInstance) {
      lottieInstance.destroy();
      lottieInstance = null;
    }
    iconContainer.remove();
    toastIconElement = null;
    if (lastReceivedAlert) renderAlertToast(lastReceivedAlert);
  };

  document.body.appendChild(iconContainer);
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
  if (hudElement || !hudVisible) return; // Only inject if visible

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
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    console.log('[EyeGuard:overlay] Stopped keepalive heartbeat');
  }
}

/**
 * Injects the Main-World interceptor script.
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

async function startMonitoring() {
  if (monitoringStream) return;
  console.log('[CAM] camera started');
  try {
    monitoringStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    
    if (!monitoringVideo) {
      monitoringVideo = document.createElement('video');
      monitoringVideo.id = 'eyeguard-monitoring-video';
      monitoringVideo.autoplay = true;
      monitoringVideo.muted = true;
      monitoringVideo.playsInline = true;
      Object.assign(monitoringVideo.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '1px',
        height: '1px',
        opacity: '0.01',
        pointerEvents: 'none',
        zIndex: '-2147483648'
      });
      (document.body || document.documentElement).appendChild(monitoringVideo);
    }
    
    monitoringVideo.srcObject = monitoringStream;
    await monitoringVideo.play().catch(e => console.warn('[EyeGuard:CAM] Video play failed:', e));
    console.log('[DATA] camera stream active');
  } catch (err) {
    console.error('[CAM] camera failed:', err);
    updateStatusHUD('error', 'Camera access denied. Please allow camera for EyeGuard.');
  }
}

function stopMonitoring() {
  if (monitoringStream) {
    monitoringStream.getTracks().forEach(track => track.stop());
    monitoringStream = null;
  }
  if (monitoringVideo) {
    monitoringVideo.srcObject = null;
    monitoringVideo.remove();
    monitoringVideo = null;
  }
}

function startHUD() {
  hudVisible = true;
  injectStatusHUD();
  startSession();
  startKeepalive();
  updateStatusHUD('info', "EyeGuard Active. Monitoring posture and blinks.");
  startMonitoring();
}

function stopHUD() {
  hudVisible = false;
  if (hudElement) {
    hudElement.remove();
    hudElement = null;
  }
  if (hudIconElement) {
    hudIconElement.remove();
    hudIconElement = null;
  }
  stopKeepalive();
  stopMonitoring();
}

// Handle visibility change to save resources when tab is backgrounded
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (hudVisible) startMonitoring();
  } else {
    stopMonitoring();
  }
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'START_CAMERA') {
    startHUD();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CONSENT_GRANTED') {
    startHUD();
    return true;
  }

  if (message.type === 'STOP_CAMERA' || message.type === 'STOP_MONITORING') {
    stopHUD();
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
    updateStatusHUD('success', `Tracking Active: ${Math.round(frameData.screenDistanceCm)}cm · ${Math.round(frameData.blinkRate)}/min`);
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
});

// Centralized Alert Display
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'LIVE_STATS_UPDATE' && message.payload.alerts) {
    message.payload.alerts.forEach((alert: any) => {
      injectAlert({
        alertId: alert.type.toLowerCase(),
        message: alert.message,
        severity: alert.severity,
        timestamp: Date.now()
      });
      
      if (alert.type === 'DISTANCE') {
        updateStatusHUD('warning', `POSTURE ALERT: Too close! Move back.`);
      }
    });
  }
});

// Bootstrapper
(async () => {
  injectMainInterceptor();

  const storage = await chrome.storage.local.get('theme');
  currentTheme = storage.theme || 'light';

  updateWebsiteTheme();

  const alreadyGranted = await checkConsent();
  if (alreadyGranted) {
    startHUD();
  }
})();
