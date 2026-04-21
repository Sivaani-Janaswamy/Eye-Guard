import { FaceMesh, Results } from "@mediapipe/face_mesh";

/**
 * EyeGuard Main-World Engine
 * Runs AI processing directly in the webpage context for maximum stability.
 */
(function() {
  const EXT_ID = document.currentScript?.getAttribute('data-ext-id');
  if (!EXT_ID) {
    console.error('[EyeGuard:main-world] Failed: Extension ID missing');
    return;
  }

  let faceMesh: FaceMesh | null = null;
  let videoElement: HTMLVideoElement | null = null;
  let isRunning = false;
  let isPaused = false;
  let animFrameId: number | null = null;

  // Initialize FaceMesh with correct locateFile path
  try {
    faceMesh = new FaceMesh({
      locateFile: (file) => {
        const url = `chrome-extension://${EXT_ID}/dist/cv/${file}`;
        return url;
      }
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results: Results) => {
      const faceCount = results.multiFaceLandmarks?.length ?? 0;
      const now = Date.now();

      // Log every 3 seconds — not every frame (too noisy)
      const self = window as any;
      if (!self._lastFaceLog || now - self._lastFaceLog > 3000) {
        self._lastFaceLog = now;
        console.log(
          '[EyeGuard:main-world] onResults —',
          'faces:', faceCount,
          '| video:', (videoElement ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : 'none'),
          '| readyState:', videoElement?.readyState
        );
      }

      // --- BLINK & DISTANCE STATE ---
      self._egBlinkHistory = self._egBlinkHistory || [];
      self._egLastBlink = self._egLastBlink || 0;
      self._egFrameCount = (self._egFrameCount || 0) + 1;

      if (faceCount === 0) {
        window.postMessage({
          type: 'EYEGUARD_FRAME',
          payload: {
            faceDetected: false,
            screenDistanceCm: -1,
            blinkRate: 0,
            ambientLuxLevel: 0,
            isLowLight: false,
            confidence: 0,
            timestamp: now,
            landmarks: []
          }
        }, '*');
        return;
      }

      const landmarks = results.multiFaceLandmarks![0];
      const videoWidth = videoElement?.videoWidth || 640;
      const videoHeight = videoElement?.videoHeight || 480;

      // --- DISTANCE CALCULATION (calibrated) ---
      const IPD_CM = 6.3;
      const FOCAL_PX = 550;
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const pixelDist = Math.sqrt(
        Math.pow((rightEye.x - leftEye.x) * videoWidth, 2) +
        Math.pow((rightEye.y - leftEye.y) * videoHeight, 2)
      );
      const distanceCm = (IPD_CM * FOCAL_PX) / pixelDist;
      console.log('[EyeGuard] distance calc:', Math.round(distanceCm), 'cm, pixelDist:', Math.round(pixelDist));

      // --- BLINK DETECTION (EAR) ---
      function computeEAR(a: number, b: number, c: number, d: number, e: number, f: number) {
        // Euclidean distances between vertical pairs
        const dist = (i: number, j: number) => {
          const dx = landmarks[i].x - landmarks[j].x;
          const dy = landmarks[i].y - landmarks[j].y;
          return Math.sqrt(dx*dx + dy*dy);
        };
        return (dist(b, d) + dist(c, e)) / (2.0 * dist(a, f));
      }
      // Left eye: 33, 160, 158, 133, 153, 144
      // Right eye: 263, 387, 385, 362, 380, 373
      const leftEAR = computeEAR(33, 160, 158, 133, 153, 144);
      const rightEAR = computeEAR(263, 387, 385, 362, 380, 373);
      if (self._egFrameCount % 60 === 0) {
        console.log('[EyeGuard:main-world] EAR:', leftEAR.toFixed(3), rightEAR.toFixed(3));
      }
      const EAR_THRESHOLD = 0.21;
      const isBlink = leftEAR < EAR_THRESHOLD && rightEAR < EAR_THRESHOLD;
      // Rolling window for blinks/min (60s)
      const nowSec = now / 1000;
      // Remove blinks older than 60s
      self._egBlinkHistory = self._egBlinkHistory.filter((t: number) => nowSec - t < 60);
      if (isBlink && (!self._egLastBlink || nowSec - self._egLastBlink > 0.2)) {
        self._egBlinkHistory.push(nowSec);
        self._egLastBlink = nowSec;
      }
      const blinkRate = self._egBlinkHistory.length;

      const frame = {
        type: 'EYEGUARD_FRAME',
        payload: {
          faceDetected: true,
          screenDistanceCm: distanceCm,
          blinkRate: blinkRate,
          ambientLuxLevel: 100,
          isLowLight: false,
          confidence: 0.9,
          timestamp: now,
          landmarks: landmarks ? landmarks.map(pt => [pt.x, pt.y, pt.z ?? 0]) : []
        }
      };

      window.postMessage(frame, '*');
    });

  } catch (e) {
    console.error('[EyeGuard:main-world] FaceMesh Init Error:', e);
  }

  let framesSent = 0;
  let lastFrameLog = Date.now();

  async function processFrame() {
    if (!isRunning) {
      console.log('[EyeGuard:main-world] Loop exiting — isRunning=false');
      return; // Log when loop actually stops
    }

    if (!isPaused && videoElement && videoElement.readyState >= 2) {
      try {
        if (faceMesh) {
          await faceMesh.send({ image: videoElement });
          framesSent++;
        }
      } catch (err) {
        console.error('[EyeGuard:main-world] faceMesh.send failed:', err);
        // DO NOT stop loop on error — just skip this frame
      }
    }

    const now = Date.now();
    if (now - lastFrameLog > 5000) {
      console.log('[EyeGuard:main-world] frames sent to MediaPipe:',
        framesSent, 'in last 5s');
      framesSent = 0;
      lastFrameLog = now;
    }

    animFrameId = requestAnimationFrame(processFrame);
  }

  // Handle Visibility for pausing (Fix Cause 1)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[EyeGuard:main-world] Tab hidden, pausing frame processing');
      isPaused = true;
    } else {
      console.log('[EyeGuard:main-world] Tab visible, resuming frame processing');
      isPaused = false;
    }
  });

  function startProcessingLoop() {
    if (animFrameId !== null) return; // already running
    isRunning = true;
    console.log('[EyeGuard:main-world] Starting faceMesh send loop');
    animFrameId = requestAnimationFrame(processFrame);
  }

  // Monitor for video element injected by overlay.ts
  const findVideoAndStart = () => {
    videoElement = document.querySelector('video') as HTMLVideoElement;
    if (videoElement) {
        console.log('[EyeGuard:main-world] video detected, waiting for metadata...');
        videoElement.onloadedmetadata = () => {
            console.log('[EyeGuard:main-world] metadata loaded, playing...');
            videoElement!.play().then(() => {
                console.log('[EyeGuard:main-world] Video playing, starting loop');
                startProcessingLoop();
            }).catch(e => {
                console.warn('[EyeGuard:main-world] video.play() failed - might need interaction', e);
                // Fallback: start anyway
                startProcessingLoop();
            });
        };
    } else {
        setTimeout(findVideoAndStart, 1000);
    }
  };

  findVideoAndStart();

  // Network Interceptors (preserved from previous version)
  const MEDIAPIPE_ASSET_PATTERN = /face_mesh_solution|face_mesh\.binarypb/i;
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    if (MEDIAPIPE_ASSET_PATTERN.test(url) && !url.startsWith('chrome-extension')) {
      const filename = url.split('/').pop()?.split('?')[0];
      return originalFetch.call(this, `chrome-extension://${EXT_ID}/dist/cv/${filename}`, init);
    }
    return originalFetch.call(this, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    const urlStr = url.toString();
    if (MEDIAPIPE_ASSET_PATTERN.test(urlStr) && !urlStr.startsWith('chrome-extension')) {
      const filename = urlStr.split('/').pop()?.split('?')[0];
      const redirectedUrl = `chrome-extension://${EXT_ID}/dist/cv/${filename}`;
      Object.defineProperty(this, 'onprogress', { get: () => null, set: () => {}, configurable: true });
      return originalOpen.apply(this, [method, redirectedUrl, ...rest] as any);
    }
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  console.log('[EyeGuard] Main-world engine active');
})();
