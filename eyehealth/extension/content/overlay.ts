import { AlertEvent } from "../db/schema";
import { applyCorrection, removeCorrection } from "../correction/display-corrector";

const DEBUG = false;

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

// Time-based suggestion tracking
let lowBlinkStartRef: number | null = null;
let closeDistanceStartRef: number | null = null;
let sessionStartRef: number = Date.now();
let lastSuggestionByType: Record<string, number> = {};
let currentSuggestion: { type: string; message: string; priority: number; icon: string } | null = null;

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
      user-select: none;
      box-sizing: border-box;
      
      /* Expanded state styling */
      width: 320px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border: 1px solid #e5e7eb;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Alert-specific color variants - background tints */
    .eg-unified-toast.warning {
      background: #fffbeb;
      border-color: #fcd34d;
    }
    
    .eg-unified-toast.critical {
      background: #fef2f2;
      border-color: #fca5a5;
    }
    
    .eg-unified-toast.good {
      background: #f0fdf4;
      border-color: #86efac;
    }

    .eg-unified-toast.positive {
      background: #f0fdf4;
      border-color: #86efac;
    }
    
    .eg-unified-toast.normal {
      background: #f0f9ff;
      border-color: #7dd3fc;
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
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .eg-eye-container.info { background: #dbeafe; }
    .eg-eye-container.warning { background: #fef3c7; }
    .eg-eye-container.critical { background: #fee2e2; }
    .eg-eye-container.good { background: #dcfce7; }
    .eg-eye-container.positive { background: #dcfce7; }
    .eg-eye-container.normal { background: #dbeafe; }

    .eg-eye-img {
      width: 20px;
      height: 20px;
      object-fit: contain;
    }

    .eg-text-content {
      flex: 1;
      min-width: 0;
    }

    .eg-title {
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 2px;
      line-height: 1.3;
    }

    .eg-message {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .eg-distance {
      font-size: 15px;
      font-weight: 600;
      color: #111827;
      margin-top: 2px;
      line-height: 1.3;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
    }

    .eg-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .eg-minimize-btn {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: none;
      background: #f3f4f6;
      color: #6b7280;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .eg-minimize-btn:hover {
      background: #e5e7eb;
      color: #374151;
    }

    .eg-unified-toast:only-child img {
      width: 32px;
      height: 32px;
    }

    /* Minimized state - class-based approach for Firefox compatibility */
    .eg-unified-toast.minimized {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      overflow: hidden;
      padding: 0;
      gap: 0;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .eg-unified-toast.minimized.warning {
      background: #fffbeb;
      border-color: #fcd34d;
    }
    
    .eg-unified-toast.minimized.critical {
      background: #fef2f2;
      border-color: #fca5a5;
    }
    
    .eg-unified-toast.minimized.good,
    .eg-unified-toast.minimized.positive {
      background: #f0fdf4;
      border-color: #86efac;
    }
    
    .eg-unified-toast.minimized.normal {
      background: #f0f9ff;
      border-color: #7dd3fc;
    }

    .eg-unified-toast.minimized:hover {
      box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }

    .eg-unified-toast.minimized img {
      width: 24px;
      height: 24px;
    }

    /* Dark Mode Overrides */
    .eg-dark-mode {
      background: #1f2937;
      border-color: #374151;
    }
    .eg-dark-mode .eg-title,
    .eg-dark-mode .eg-message,
    .eg-dark-mode .eg-distance {
      color: #f9fafb;
    }
    .eg-dark-mode .eg-minimize-btn {
      background: #374151;
      color: #9ca3af;
    }
    .eg-dark-mode .eg-minimize-btn:hover {
      background: #4b5563;
      color: #f3f4f6;
    }
    .eg-dark-mode.warning {
      background: #451a03;
      border-color: #92400e;
    }
    .eg-dark-mode.critical {
      background: #450a0a;
      border-color: #991b1b;
    }
    .eg-dark-mode.good,
    .eg-dark-mode.positive {
      background: #052e16;
      border-color: #166534;
    }
    .eg-dark-mode.normal {
      background: #0c4a6e;
      border-color: #075985;
    }
    .eg-dark-mode .eg-eye-container.info { background: #1e3a8a; }
    .eg-dark-mode .eg-eye-container.warning { background: #78350f; }
    .eg-dark-mode .eg-eye-container.critical { background: #7f1d1d; }
    .eg-dark-mode .eg-eye-container.good,
    .eg-dark-mode .eg-eye-container.positive { background: #14532d; }
    .eg-dark-mode .eg-eye-container.normal { background: #1e3a8a; }
    
    /* Dark mode for minimized toast */
    .eg-dark-mode.minimized.warning {
      background: #451a03;
      border-color: #92400e;
    }
    .eg-dark-mode.minimized.critical {
      background: #450a0a;
      border-color: #991b1b;
    }
    .eg-dark-mode.minimized.good,
    .eg-dark-mode.minimized.positive {
      background: #052e16;
      border-color: #166534;
    }
    .eg-dark-mode.minimized.normal {
      background: #0c4a6e;
      border-color: #075985;
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
function calculateHealthStatus(): { status: 'positive' | 'normal' | 'warning' | 'critical', message?: string } {
  // Critical state check
  if (activeAlert?.severity === 'critical') {
    return { status: 'critical', message: activeAlert.message };
  }

  // Get current metrics
  const distance = lastDistance;
  const lux = lastLux || 0;

  // Check for positive state (distance 50-70cm AND lux >= 100, ignore blink rate)
  const isDistanceOptimal = distance >= 50 && distance <= 70;
  const isLightingOptimal = lux >= 100;

  if (isDistanceOptimal && isLightingOptimal) {
    return { status: 'positive', message: 'Great posture! Your eyes are healthy' };
  }

  // Warning if distance OR lighting outside optimal range
  if (distance > 0 && !isDistanceOptimal) {
    return { status: 'warning', message: 'Adjust your distance' };
  }
  if (lux > 0 && !isLightingOptimal) {
    return { status: 'warning', message: 'Adjust your lighting' };
  }

  // Check for active alerts (fallback)
  if (activeAlert?.severity === 'warning') {
    return { status: 'warning', message: activeAlert.message };
  }

  // Normal state (no specific issues, but not all optimal)
  return { status: 'normal' };
}

// -------------------- SUGGESTION GENERATION --------------------
function generateSuggestion(distance: number, blinkRate: number, lux: number, now: number): { type: string; message: string; priority: number; icon: string } | null {
  const suggestions: Array<{ type: string; message: string; priority: number; icon: string }> = [];
  const COOLDOWN_MS = 15000; // 15 seconds per-type cooldown

  // 1. Low blink rate (after 10s of <15 blinks/min)
  if (blinkRate < 15) {
    if (!lowBlinkStartRef) {
      lowBlinkStartRef = now;
    }
    const lowBlinkDuration = now - lowBlinkStartRef;
    if (lowBlinkDuration > 10000) { // 10 seconds
      if (!lastSuggestionByType['blink'] || now - lastSuggestionByType['blink'] > COOLDOWN_MS) {
        suggestions.push({
          type: 'blink',
          message: 'Blink more — your blink rate is low',
          priority: 3,
          icon: '👁️'
        });
      }
    }
  } else {
    lowBlinkStartRef = null;
  }

  // 2. Close distance (after 5s of <50cm)
  if (distance < 50) {
    if (!closeDistanceStartRef) {
      closeDistanceStartRef = now;
    }
    const closeDuration = now - closeDistanceStartRef;
    if (closeDuration > 5000) { // 5 seconds
      if (!lastSuggestionByType['distance'] || now - lastSuggestionByType['distance'] > COOLDOWN_MS) {
        suggestions.push({
          type: 'distance',
          message: 'Move back — you\'re too close',
          priority: 2,
          icon: '📏'
        });
      }
    }
  } else {
    closeDistanceStartRef = null;
  }

  // 3. Poor lighting (immediate if <50 lux)
  if (lux < 50) {
    if (!lastSuggestionByType['lighting'] || now - lastSuggestionByType['lighting'] > COOLDOWN_MS) {
      suggestions.push({
        type: 'lighting',
        message: 'More light needed — room is too dark',
        priority: 2,
        icon: '💡'
      });
    }
  }

  // 4. Break suggestion (after 20min session)
  const sessionDuration = now - sessionStartRef;
  if (sessionDuration > 20 * 60 * 1000) { // 20 minutes
    if (!lastSuggestionByType['break'] || now - lastSuggestionByType['break'] > COOLDOWN_MS) {
      suggestions.push({
        type: 'break',
        message: 'Take a break — 20+ mins of screen time',
        priority: 1,
        icon: '⏸️'
      });
    }
  }

  // Return highest priority suggestion
  if (suggestions.length > 0) {
    return suggestions.reduce((max, s) => s.priority > max.priority ? s : max);
  }
  return null;
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
  
  const healthStatus = calculateHealthStatus();
  const alertType = healthStatus.status;
  
  // Apply minimized class with alert type
  unifiedToastElement.className = `eg-unified-toast minimized ${alertType}`;
  
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
  
  // Use suggestion message if available, otherwise use health status message
  const displayMessage = currentSuggestion ? currentSuggestion.message : (healthStatus.message || '');
  
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
        ${displayMessage ? `<div class="eg-message">${displayMessage}</div>` : ''}
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

  // Generate suggestions based on current metrics
  const now = Date.now();
  const newSuggestion = generateSuggestion(lastDistance, lastBlinkRate, lastLux, now);
  
  // Only update UI if suggestion type changes (prevent flickering)
  if (newSuggestion && (!currentSuggestion || currentSuggestion.type !== newSuggestion.type)) {
    currentSuggestion = newSuggestion;
    lastSuggestionByType[newSuggestion.type] = now;
    
    // Reset session timer after showing break suggestion
    if (newSuggestion.type === 'break') {
      sessionStartRef = now;
    }
    
    renderUnifiedToast();
  } else if (!newSuggestion && currentSuggestion) {
    currentSuggestion = null;
    renderUnifiedToast();
  }
  
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
      landmarks: frameData.landmarks,
      bbox: frameData.bbox || null
    }
  }).catch(() => {});

  if (DEBUG) {
    console.log('[OVERLAY DEBUG] Forwarding SENSOR_FRAME', {
      screenDistanceCm: frameData.screenDistanceCm,
      blinkRate: frameData.blinkRate,
      ambientLuxLevel: frameData.ambientLuxLevel,
      faceDetected: frameData.faceDetected
    });
  }
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
