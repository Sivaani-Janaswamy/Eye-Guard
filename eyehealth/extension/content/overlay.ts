import { AlertEvent } from "../db/schema";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

// Unified State
let unifiedToastElement: HTMLDivElement | null = null;
let isMinimized = false;
let hudPos = { top: 20, left: 20 };
let currentTheme: 'light' | 'dark' = 'light';
let websiteStyleElement: HTMLStyleElement | null = null;
let lastDistance: number = -1;
let lastBlinkRate: number = 0;
let lastLux: number = 0;
let activeAlert: AlertEvent | null = null;
let keepaliveInterval: any = null;
let hudVisible: boolean = false;
let lastToastRender: number = 0;
const TOAST_THROTTLE_MS = 200; // Reduced throttling for responsiveness
let isDragging = false; // Track drag state to prevent click events during drag
let isRendering = false; // Prevent overlapping render calls

// -------------------- SAFETY UTILITIES --------------------
function safeSetHTML(element: HTMLElement, html: string): void {
  try {
    element.innerHTML = html;
  } catch (error) {
    console.error('[EyeGuard] Toast render failed:', error);
    // Fallback UI that never fails
    element.innerHTML = `
      <div style="padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="font-weight: 600; color: #1a1a18; margin-bottom: 4px;">EyeGuard</div>
        <div style="font-size: 12px; color: #666;">System monitoring active</div>
      </div>
    `;
  }
}

function getSafeEyeIcon(): string {
  const eyeIcon = chrome.runtime.getURL('assets/eye.png');
  // Prevent infinite onerror loops with unique ID
  const fallbackId = 'eg-eye-fallback';
  return `<img src="${eyeIcon}" alt="EyeGuard" onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<span style=\'font-size: 24px;\'>👁️</span>');" />`;
}


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
      --eg-green: #22c55e;
      --eg-green-bg: #f0fdf4;
    }

    .eg-unified-toast {
      position: fixed;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      transition: all 0.25s ease;
      user-select: none;
      box-sizing: border-box;
      
      /* Expanded state styling */
      width: 320px;
      background: var(--eg-bg-primary);
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 2px 10px rgba(0,0,0,0.1);
      border: 1px solid var(--eg-border);
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Alert-specific color variants */
    .eg-unified-toast.warning {
      border-color: var(--eg-amber);
      border-left: 4px solid var(--eg-amber);
    }
    
    .eg-unified-toast.critical {
      border-color: var(--eg-red);
      border-left: 4px solid var(--eg-red);
    }
    
    .eg-unified-toast.good {
      border-color: var(--eg-green);
      border-left: 4px solid var(--eg-green);
    }

    .eg-unified-toast.positive {
      border-color: var(--eg-green);
      border-left: 4px solid var(--eg-green);
    }
    
    .eg-unified-toast.normal {
      border-color: var(--eg-blue);
      border-left: 4px solid var(--eg-blue);
    }

    .eg-toast-expanded {
      /* No longer needed - styling moved to .eg-unified-toast */
    }

    .eg-toast-content {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .eg-eye-container {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.25s ease;
    }

    .eg-eye-container.info { background: var(--eg-blue-bg); }
    .eg-eye-container.warning { background: var(--eg-amber-bg); }
    .eg-eye-container.critical { background: var(--eg-red-bg); }
    .eg-eye-container.good { background: var(--eg-green-bg); }
    .eg-eye-container.positive { background: var(--eg-green-bg); }
    .eg-eye-container.normal { background: var(--eg-blue-bg); }

    .eg-eye-img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    .eg-text-content {
      flex: 1;
      min-width: 0;
    }

    .eg-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--eg-text-p);
      margin-bottom: 2px;
      line-height: 1.2;
    }

    .eg-message {
      font-size: 12px;
      color: var(--eg-text-s);
      line-height: 1.4;
      word-wrap: break-word;
    }

    .eg-distance {
      font-size: 14px;
      font-weight: 600;
      color: var(--eg-text-p);
      margin-top: 2px;
      line-height: 1.2;
    }

    .eg-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .eg-minimize-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: none;
      background: var(--eg-bg-secondary);
      color: var(--eg-text-s);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .eg-minimize-btn:hover {
      background: #e5e4e0;
      color: var(--eg-text-p);
      transform: scale(1.05);
    }

    .eg-unified-toast:only-child img {
      width: 32px;
      height: 32px;
    }

    /* Minimized state - class-based approach for Firefox compatibility */
    .eg-unified-toast.minimized {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 2px solid var(--eg-blue);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      overflow: hidden;
      padding: 0;
      gap: 0;
      background: var(--eg-bg-primary);
    }

    .eg-unified-toast.minimized:hover {
      transform: scale(1.1);
      box-shadow: 0 12px 40px rgba(0,0,0,0.2);
    }

    .eg-unified-toast.minimized img {
      width: 32px;
      height: 32px;
    }

    /* Dark Mode Overrides */
    .eg-dark-mode {
      background: #1e1e1e;
      border-color: #333;
      color: #f0f0f0;
    }
    .eg-dark-mode .eg-title,
    .eg-dark-mode .eg-message,
    .eg-dark-mode .eg-distance {
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
    
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    
    isDragging = false; // Start with false - only set true when actually dragging
    el.style.transition = "none";
    el.style.cursor = "grabbing";

    const elementDrag = (e: MouseEvent) => {
      e.preventDefault();
      
      // Only set dragging to true when mouse actually moves
      if (!isDragging) {
        isDragging = true;
      }
      
      let newX = e.clientX - offsetX;
      let newY = e.clientY - offsetY;
      
      const padding = 10;
      newX = Math.max(padding, Math.min(newX, window.innerWidth - el.offsetWidth - padding));
      newY = Math.max(padding, Math.min(newY, window.innerHeight - el.offsetHeight - padding));
      
      hudPos.top = newY;
      hudPos.left = newX;
      
      el.style.top = `${newY}px`;
      el.style.left = `${newX}px`;
    };

    const closeDragElement = () => {
      document.removeEventListener('mousemove', elementDrag);
      document.removeEventListener('mouseup', closeDragElement);
      
      el.style.transition = "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease, background-color 0.3s ease";
      el.style.cursor = isMinimized ? "pointer" : "default";
      
      // Immediate reset - no delay needed
      isDragging = false;
    };

    document.addEventListener('mousemove', elementDrag);
    document.addEventListener('mouseup', closeDragElement);
  };
}

// -------------------- HEALTH STATUS CALCULATION --------------------
function generateOptimizationSuggestions(distance: number, blinkRate: number, lux: number): string[] {
  const suggestions = [];
  
  if (distance > 0 && distance < 50) {
    suggestions.push("Move back to 50-70cm from screen");
  } else if (distance > 70) {
    suggestions.push("Move closer to 50-70cm from screen");
  }
  
  if (blinkRate > 0 && blinkRate < 15) {
    suggestions.push("Blink more - aim for 15-20 blinks/min");
  } else if (blinkRate > 20) {
    suggestions.push("Reduce blinking - aim for 15-20 blinks/min");
  }
  
  if (lux > 0 && lux < 200) {
    suggestions.push("Increase lighting to 200-500 lux");
  } else if (lux > 500) {
    suggestions.push("Reduce lighting to 200-500 lux");
  }
  
  return suggestions;
}

function calculateHealthStatus(): { status: 'positive' | 'normal' | 'warning' | 'critical', message?: string } {
  // Critical state check
  if (activeAlert?.severity === 'critical') {
    return { status: 'critical', message: activeAlert.message };
  }

  // Get current metrics
  const distance = lastDistance;
  const blinkRate = lastBlinkRate || 0;
  const lux = lastLux || 0;

  // Check for positive state (all metrics optimal)
  const isDistanceOptimal = distance >= 50 && distance <= 70;
  const isBlinkRateOptimal = blinkRate >= 15 && blinkRate <= 20;
  const isLightingOptimal = lux >= 200 && lux <= 500;

  if (isDistanceOptimal && isBlinkRateOptimal && isLightingOptimal) {
    return { status: 'positive', message: 'Great posture! Your eyes are healthy' };
  }

  // NEW: Warning with specific suggestions for non-optimal metrics
  const suggestions = generateOptimizationSuggestions(distance, blinkRate, lux);
  if (suggestions.length > 0) {
    return { 
      status: 'warning', 
      message: `To optimize: ${suggestions.join(', ')}` 
    };
  }

  // Check for active alerts (fallback)
  if (activeAlert?.severity === 'warning') {
    return { status: 'warning', message: activeAlert.message };
  }

  // Normal state (no specific issues, but not all optimal)
  return { status: 'normal' };
}

function renderUnifiedToast() {
  if (isRendering) return;
  isRendering = true;

  try {
    const now = Date.now();
    if (now - lastToastRender < TOAST_THROTTLE_MS) {
      return; // Skip this render - too soon since last one
    }
    lastToastRender = now;

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
  } finally {
    isRendering = false;
  }
}

function renderMinimizedState() {
  if (!unifiedToastElement) return;
  
  // Apply minimized class
  unifiedToastElement.className = 'eg-unified-toast minimized';
  
  safeSetHTML(unifiedToastElement, getSafeEyeIcon());
  
  unifiedToastElement.style.cursor = 'pointer';
  unifiedToastElement.onclick = (e) => {
    // Only toggle if we didn't just drag
    if (isDragging) return;
    isMinimized = false;
    renderUnifiedToast();
  };
}

function renderExpandedState() {
  if (!unifiedToastElement) return;

  const distText = lastDistance > 0 ? `${Math.round(lastDistance)}cm` : 'Measuring...';
  const healthStatus = calculateHealthStatus();
  const alertType = healthStatus.status;
  const title = healthStatus.status === 'positive' ? 'EyeGuard' : 
                  healthStatus.status === 'normal' ? 'EyeGuard' :
                  'EyeGuard Alert';
  const alertMessage = healthStatus.message || '';
  
  // Clear alert if it's older than 10 seconds
  if (activeAlert && Date.now() - activeAlert.triggeredAt > 10000) {
    activeAlert = null;
  }

  // Apply health status class to unified toast element
  unifiedToastElement.className = `eg-unified-toast ${alertType}`;

  safeSetHTML(unifiedToastElement, `
    <div class="eg-toast-content">
      <div class="eg-eye-container ${alertType}">
        ${getSafeEyeIcon()}
      </div>
      <div class="eg-text-content">
        <div class="eg-title">${title}</div>
        ${alertMessage ? `<div class="eg-message">${alertMessage}</div>` : ''}
        <div class="eg-distance">${distText}</div>
      </div>
    </div>
    <div class="eg-actions">
      <button class="eg-minimize-btn" title="Minimize">−</button>
    </div>
  `);

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
      message: 'Camera access denied - Please allow camera to use EyeGuard',
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
  
  // Store real-time metrics for health status calculation
  lastBlinkRate = frameData.blinkRate || 0;
  lastLux = frameData.ambientLuxLevel || 0;
  
  // Throttle re-renders for stats - only update distance text, not full toast
  if (!isMinimized && hudVisible) {
    const distText = lastDistance > 0 ? `${Math.round(lastDistance)}cm` : 'Measuring...';
    const distanceElement = unifiedToastElement?.querySelector('.eg-distance');
    if (distanceElement && distanceElement.textContent !== distText) {
      distanceElement.textContent = distText;
    }
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
  
  console.log('[OVERLAY DEBUG] Forwarding SENSOR_FRAME', {
    screenDistanceCm: frameData.screenDistanceCm,
    blinkRate: frameData.blinkRate,
    ambientLuxLevel: frameData.ambientLuxLevel,
    faceDetected: frameData.faceDetected
  });
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
