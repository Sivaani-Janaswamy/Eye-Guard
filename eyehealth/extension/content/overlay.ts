import { AlertEvent } from "../db/schema";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// Unified State
let unifiedToastElement: HTMLDivElement | null = null;
let isMinimized = false;
let hudPos = { top: 20, left: 20 };
let currentTheme: 'light' | 'dark' = 'light';
let websiteStyleElement: HTMLStyleElement | null = null;
let lastDistance: number = -1;
let activeAlert: AlertEvent | null = null;
let keepaliveInterval: any = null;
let hudVisible: boolean = false;

// Camera management
let monitoringStream: MediaStream | null = null;
let monitoringVideo: HTMLVideoElement | null = null;

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
      --eg-red: #E24B4A;
      --eg-red-bg: #FCEBEB;
      --eg-amber: #EF9F27;
      --eg-amber-bg: #FAEEDA;
    }

    .eg-unified-toast {
      position: fixed;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease, background-color 0.3s ease;
      user-select: none;
      box-sizing: border-box;
    }

    .eg-toast-expanded {
      width: 280px;
      background: var(--eg-bg-primary);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.12);
      border: 1px solid var(--eg-border);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .eg-toast-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .eg-eye-container {
      width: 32px;
      height: 32px;
      background: var(--eg-blue-bg);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .eg-eye-img {
      width: 20px;
      height: 20px;
      object-fit: contain;
    }

    .eg-stats-container {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .eg-dist-label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--eg-text-s);
      letter-spacing: 0.5px;
    }

    .eg-dist-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--eg-text-p);
    }

    .eg-minimize-btn {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: none;
      background: var(--eg-bg-secondary);
      color: var(--eg-text-s);
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }

    .eg-minimize-btn:hover {
      background: #e5e4e0;
      color: var(--eg-text-p);
    }

    .eg-alert-container {
      background: var(--eg-blue-bg);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-left: 3px solid var(--eg-blue);
    }

    .eg-alert-container.warning {
      background: var(--eg-amber-bg);
      border-left-color: var(--eg-amber);
    }

    .eg-alert-container.critical {
      background: var(--eg-red-bg);
      border-left-color: var(--eg-red);
    }

    .eg-alert-text {
      font-size: 12px;
      font-weight: 500;
      color: var(--eg-text-p);
      line-height: 1.3;
    }

    .eg-toast-minimized {
      width: 48px;
      height: 48px;
      background: var(--eg-bg-primary);
      border-radius: 50%;
      box-shadow: 0 4px 15px rgba(0,0,0,0.15);
      border: 2px solid var(--eg-blue);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      overflow: hidden;
    }

    .eg-toast-minimized:hover {
      transform: scale(1.1);
    }

    .eg-toast-minimized img {
      width: 26px;
      height: 26px;
    }

    /* Dark Mode Overrides */
    .eg-dark-mode .eg-toast-expanded,
    .eg-dark-mode .eg-toast-minimized {
      background: #1e1e1e;
      border-color: #333;
      color: #f0f0f0;
    }
    .eg-dark-mode .eg-dist-value,
    .eg-dark-mode .eg-alert-text {
      color: #f0f0f0;
    }
    .eg-dark-mode .eg-bg-secondary {
      background: #2a2a2a;
    }
  `;
  document.head.appendChild(style);
}

function makeDraggable(el: HTMLElement) {
  let offsetX = 0, offsetY = 0;

  el.onmousedown = (e: MouseEvent) => {
    // Prevent dragging when clicking the minimize button
    if ((e.target as HTMLElement).closest('.eg-minimize-btn')) return;
    
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
    
    el.style.top = `${newY}px`;
    el.style.left = `${newX}px`;
  }

  function closeDragElement() {
    document.onmousemove = null;
    document.onmouseup = null;
    el.style.transition = "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease, background-color 0.3s ease";
    el.style.cursor = isMinimized ? "pointer" : "default";
  }
}

function renderUnifiedToast() {
  if (!hudVisible) {
    if (unifiedToastElement) {
      unifiedToastElement.remove();
      unifiedToastElement = null;
    }
    return;
  }

  ensureStylesInjected();

  if (!unifiedToastElement) {
    unifiedToastElement = document.createElement('div');
    unifiedToastElement.className = 'eg-unified-toast';
    document.body.appendChild(unifiedToastElement);
    makeDraggable(unifiedToastElement);
  }

  unifiedToastElement.style.top = `${hudPos.top}px`;
  unifiedToastElement.style.left = `${hudPos.left}px`;
  
  if (currentTheme === 'dark') {
    unifiedToastElement.classList.add('eg-dark-mode');
  } else {
    unifiedToastElement.classList.remove('eg-dark-mode');
  }

  if (isMinimized) {
    renderMinimizedState();
  } else {
    renderExpandedState();
  }
}

function renderMinimizedState() {
  if (!unifiedToastElement) return;
  
  unifiedToastElement.innerHTML = `
    <div class="eg-toast-minimized">
      <img src="${chrome.runtime.getURL('assets/eye.png')}" alt="EyeGuard" />
    </div>
  `;
  
  unifiedToastElement.classList.remove('eg-toast-expanded');
  unifiedToastElement.style.cursor = 'pointer';
  unifiedToastElement.onclick = (e) => {
    // Only toggle if we didn't just drag
    if (unifiedToastElement?.style.cursor === 'grabbing') return;
    isMinimized = false;
    renderUnifiedToast();
  };
}

function renderExpandedState() {
  if (!unifiedToastElement) return;

  const distText = lastDistance > 0 ? `${Math.round(lastDistance)}cm` : 'Measuring...';
  const alertHtml = activeAlert ? `
    <div class="eg-alert-container ${activeAlert.severity}">
      <div class="eg-alert-text">${activeAlert.message.split(' — ')[0]}</div>
    </div>
  ` : '';

  unifiedToastElement.innerHTML = `
    <div class="eg-toast-expanded">
      <div class="eg-toast-header">
        <div class="eg-eye-container">
          <img src="${chrome.runtime.getURL('assets/eye.png')}" class="eg-eye-img" />
        </div>
        <div class="eg-stats-container">
          <div class="eg-dist-label">Distance</div>
          <div class="eg-dist-value">${distText}</div>
        </div>
        <button class="eg-minimize-btn" title="Minimize">−</button>
      </div>
      ${alertHtml}
    </div>
  `;

  unifiedToastElement.classList.add('eg-toast-expanded');
  unifiedToastElement.style.cursor = 'default';
  unifiedToastElement.onclick = null;

  const minBtn = unifiedToastElement.querySelector('.eg-minimize-btn');
  if (minBtn) {
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isMinimized = true;
      renderUnifiedToast();
    });
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
        .eg-unified-toast,
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

function startKeepalive() {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'KEEPALIVE' })
      .catch(() => {
        startSession();
      });
  }, 25000);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

function injectMainInterceptor(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/main-world.js');
  script.setAttribute('data-ext-id', chrome.runtime.id);
  (document.head || document.documentElement).appendChild(script);
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
    await monitoringVideo.play().catch(() => {});
    
    // Start main-world processing loop
    if ((window as any).eyeguardMainWorld) {
      (window as any).eyeguardMainWorld.startProcessingLoop();
    }
  } catch (err) {
    console.error('[CAM] camera failed:', err);
    activeAlert = {
      alertId: 'cam-error',
      type: 'distance' as any,
      severity: 'critical',
      triggeredAt: Date.now(),
      dismissed: false,
      snoozedUntil: null,
      message: 'Camera Access Denied — Please allow camera to use EyeGuard',
      actionTaken: null
    };
    renderUnifiedToast();
  }
}

function stopMonitoring() {
  // Stop main-world processing loop
  if ((window as any).eyeguardMainWorld) {
    (window as any).eyeguardMainWorld.stopProcessingLoop();
  }
  
  if (monitoringStream) {
    monitoringStream.getTracks().forEach(track => track.stop());
    monitoringStream = null;
  }
  if (monitoringVideo) {
    monitoringVideo.srcObject = null;
    monitoringVideo.remove();
    monitoringVideo = null;
  }
  
  // Clear last distance to prevent stale data
  lastDistance = -1;
}

function startHUD() {
  hudVisible = true;
  renderUnifiedToast();
  startSession();
  startKeepalive();
  startMonitoring();
}

function stopHUD() {
  hudVisible = false;
  if (unifiedToastElement) {
    unifiedToastElement.remove();
    unifiedToastElement = null;
  }
  stopKeepalive();
  stopMonitoring();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (hudVisible) startMonitoring();
  } else {
    stopMonitoring();
  }
});

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
    if (message.alert) {
      activeAlert = message.alert;
      renderUnifiedToast();
    }
  }

  if (message.type === 'APPLY_CORRECTION') {
    if (message.profile) applyCorrection(message.profile);
  }

  if (message.type === 'REMOVE_CORRECTION') {
    removeCorrection();
  }

  if (message.type === 'THEME_CHANGED') {
    currentTheme = message.theme;
    renderUnifiedToast();
    updateWebsiteTheme();
  }
});

// Bridge: Receive frames from Main World
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'EYEGUARD_FRAME') return;

  const frameData = event.data.payload;
  
  if (frameData.faceDetected) {
    lastDistance = frameData.screenDistanceCm;
  } else {
    lastDistance = -1;
  }
  
  // Throttle re-renders for stats
  if (!isMinimized && hudVisible) {
    renderExpandedState();
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
    if (message.payload.alerts.length > 0) {
      const alert = message.payload.alerts[0];
      activeAlert = {
        alertId: alert.type.toLowerCase(),
        message: alert.message,
        severity: alert.severity,
        triggeredAt: Date.now(),
        dismissed: false,
        snoozedUntil: null,
        type: alert.type,
        actionTaken: null
      };
      renderUnifiedToast();
    }
  }
});

// Bootstrapper
(async () => {
  injectMainInterceptor();

  const storage = await chrome.storage.local.get('theme');
  currentTheme = (storage.theme as 'light' | 'dark') || 'light';

  updateWebsiteTheme();

  const alreadyGranted = await checkConsent();
  if (alreadyGranted) {
    startHUD();
  }
})();
