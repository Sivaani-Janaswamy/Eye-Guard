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
      // Use window properties for a simpler "globals" in main-world script injection
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
            timestamp: now
          }
        }, '*');
        return;
      }

      const landmarks = results.multiFaceLandmarks![0];
      // Compute Distance (simplified robust version)
      const p1 = landmarks[33];
      const p2 = landmarks[263];
      const dx = Math.abs(p2.x - p1.x); // normalized
      let distanceCm = 50;
      if (dx > 0) {
        // IPD based estimation: 6.3cm average, assumes standard 720p FOV
        distanceCm = 63 / dx; 
      }

      const frame = {
        type: 'EYEGUARD_FRAME',
        payload: {
          faceDetected: true,
          screenDistanceCm: distanceCm,
          blinkRate: 0, 
          ambientLuxLevel: 100, 
          isLowLight: false,
          confidence: 0.9,
          timestamp: now
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
