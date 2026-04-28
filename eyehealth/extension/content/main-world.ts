import { FaceMesh, Results } from "@mediapipe/face_mesh";

/**
 * EyeGuard Main-World Engine
 * Runs AI processing directly in the webpage context for maximum stability.
 */
(function() {
  const DEBUG = false;

  const EXT_ID = document.currentScript?.getAttribute('data-ext-id');
  if (!EXT_ID) {
    console.error('[EyeGuard:main-world] Failed: Extension ID missing');
    return;
  }

  let faceMesh: FaceMesh | null = null;
  let videoElement: HTMLVideoElement | null = null;
  let isRunning = false;
let cameraActive = false;
  let animFrameId: number | null = null;

  // --- STATE FOR SMOOTHING & BLINKS ---
  const distanceHistory: number[] = [];
  const earHistory: number[] = [];
  const blinkTimestamps: number[] = []; // Proper rolling window
  let isBlinking = false;
  let lastLux = 100;
  let smoothedLux = 0; // Persistent smoothed value
  let sendErrorLogged = false; // Deduplicate error logging

  // Offscreen canvas for lighting computation
  const lightingCanvas = document.createElement('canvas');
  lightingCanvas.width = 40; // Small size for fast processing
  lightingCanvas.height = 30;
  const lightingCtx = lightingCanvas.getContext('2d', { willReadFrequently: true });

  // Constants
  const IPD_CM = 6.3;
  const APPROX_FOCAL = 550;
  const EAR_THRESHOLD = 0.21;

  function getBoundingBox(landmarks: any[]) {
    const xs = landmarks.map(p => p.x);
    const ys = landmarks.map(p => p.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function computeAmbientLux(): number {
    if (!videoElement || !lightingCtx || videoElement.readyState < 2) return Math.round(smoothedLux || lastLux);

    try {
      // Draw small version for performance
      lightingCtx.drawImage(videoElement, 0, 0, lightingCanvas.width, lightingCanvas.height);
      const data = lightingCtx.getImageData(0, 0, lightingCanvas.width, lightingCanvas.height).data;
      
      let totalBrightness = 0;
      let sampleCount = 0;

      // Sample every 4th pixel (step of 16 in rgba array)
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        totalBrightness += (r + g + b) / 3;
        sampleCount++;
      }

      const avgBrightness = totalBrightness / (sampleCount || 1);
      // Map 0-255 brightness to 0-500 lux range
      let rawLux = Math.round((avgBrightness / 255) * 500);
      
      // Initialize if first frame
      if (smoothedLux === 0) {
        smoothedLux = rawLux;
      }

      // Clamp sudden extreme spikes (sensor noise / sudden screen flash)
      if (Math.abs(rawLux - smoothedLux) > 150) {
        rawLux = smoothedLux + (rawLux > smoothedLux ? 50 : -50);
      }

      // Exponential Moving Average (EMA) smoothing
      // 0.8 weight on history, 0.2 on new data
      smoothedLux = (0.8 * smoothedLux) + (0.2 * rawLux);
      
      lastLux = Math.round(smoothedLux);
      return lastLux;
    } catch (e) {
      return Math.round(smoothedLux || lastLux);
    }
  }

  // Initialize FaceMesh with correct locateFile path
  try {
    faceMesh = new FaceMesh({
      locateFile: (file) => {
        const url = `chrome-extension://${EXT_ID}/face_mesh/${file}`;
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
      const self = window as any;
      self._egFrameCount = (self._egFrameCount || 0) + 1;

      if (faceCount === 0) {
        const lux = computeAmbientLux();
        
        // Continue blink counting even when face is temporarily lost
        // Clean old timestamps from rolling window
        while (blinkTimestamps.length && now - blinkTimestamps[0] > 60000) {
          blinkTimestamps.shift();
        }
        const currentBlinkRate = blinkTimestamps.length;
        
        window.postMessage({
          type: 'EYEGUARD_FRAME',
          payload: {
            faceDetected: false,
            screenDistanceCm: -1,
            blinkRate: currentBlinkRate, // Don't reset to 0
            ambientLuxLevel: lux,
            isLowLight: lux < 50,
            confidence: 0,
            timestamp: now,
            landmarks: []
          }
        }, '*');
        return;
      }

      const landmarks = results.multiFaceLandmarks![0];
      if (!landmarks || landmarks.length === 0) return;

      const videoWidth = videoElement?.videoWidth || 640;
      const videoHeight = videoElement?.videoHeight || 480;

      // --- DISTANCE CALCULATION (Calibrated + Smoothing) ---
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const dx = (rightEye.x - leftEye.x) * videoWidth;
      const dy = (rightEye.y - leftEye.y) * videoHeight;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      
      let rawDistance = (IPD_CM * APPROX_FOCAL) / (pixelDist || 1);
      rawDistance = Math.min(200, Math.max(15, rawDistance));

      distanceHistory.push(rawDistance);
      if (distanceHistory.length > 5) distanceHistory.shift();
      const distanceCm = distanceHistory.reduce((a, b) => a + b, 0) / distanceHistory.length;

      // --- BLINK DETECTION (EAR + Debounce + Smoothing) ---
      function computeEAR(indices: number[]) {
        const [p1, p2, p3, p4, p5, p6] = indices.map(i => landmarks[i]);
        const v1 = Math.sqrt(Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2));
        const v2 = Math.sqrt(Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2));
        const h = Math.sqrt(Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2));
        return (v1 + v2) / (2.0 * h);
      }
      
      const leftEAR = computeEAR([362, 385, 387, 263, 373, 380]);
      const rightEAR = computeEAR([33, 160, 158, 133, 153, 144]);
      const avgEAR = (leftEAR + rightEAR) / 2;

      earHistory.push(avgEAR);
      if (earHistory.length > 3) earHistory.shift();
      const smoothEAR = earHistory.reduce((a, b) => a + b, 0) / earHistory.length;

      if (smoothEAR < EAR_THRESHOLD && !isBlinking) {
        isBlinking = true;
        blinkTimestamps.push(now);
      } else if (smoothEAR > EAR_THRESHOLD) {
        isBlinking = false;
      }

      // Rolling 60s window
      while (blinkTimestamps.length && now - blinkTimestamps[0] > 60000) {
        blinkTimestamps.shift();
      }
      const blinkRate = blinkTimestamps.length;

      // Logging
      if (DEBUG && self._egFrameCount % 90 === 0) {
        console.log(`[DATA] values computed | dist: ${Math.round(distanceCm)}cm | blinkRate: ${blinkRate} | EAR: ${smoothEAR.toFixed(3)} | isBlinking: ${isBlinking}`);
      }
      
      // Log blink detection events
      if (DEBUG) {
        if (smoothEAR < EAR_THRESHOLD && !isBlinking) {
          console.log(`[BLINK] Detected! EAR: ${smoothEAR.toFixed(3)} < ${EAR_THRESHOLD}, timestamps: ${blinkTimestamps.length}`);
        } else if (smoothEAR > EAR_THRESHOLD && isBlinking) {
          console.log(`[BLINK] Ended. EAR: ${smoothEAR.toFixed(3)} > ${EAR_THRESHOLD}`);
        }
      }

      const lux = computeAmbientLux();

      const bbox = landmarks ? getBoundingBox(landmarks) : null;

      const frame = {
        type: 'EYEGUARD_FRAME',
        payload: {
          faceDetected: true,
          screenDistanceCm: distanceCm,
          blinkRate: blinkRate,
          ambientLuxLevel: lux,
          isLowLight: lux < 50,
          confidence: 0,
          timestamp: now,
          landmarks: landmarks ? landmarks.map(pt => [pt.x, pt.y, pt.z ?? 0]) : [],
          bbox
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
    if (!isRunning || !cameraActive) {
      if (!cameraActive) {
        console.log('[EyeGuard:main-world] Camera inactive - stopping loop');
        animFrameId = null;
        return;
      }
      return;
    }

    if (document.hidden) {
      animFrameId = requestAnimationFrame(processFrame);
      return;
    }

    if (videoElement && videoElement.readyState >= 2) {
      try {
        if (faceMesh) {
          if (DEBUG && framesSent % 60 === 0) console.log('[MESH] processing frame');
          await faceMesh.send({ image: videoElement });
          framesSent++;
        }
      } catch (err) {
        if (!sendErrorLogged) {
          console.error('[EyeGuard:main-world] faceMesh.send failed (first occurrence):', err);
          sendErrorLogged = true;
        }
      }
    }

    const now = Date.now();
    if (DEBUG && now - lastFrameLog > 5000) {
      console.log('[DATA] frames sent to MediaPipe:', framesSent);
      framesSent = 0;
      lastFrameLog = now;
    }

    animFrameId = requestAnimationFrame(processFrame);
  }

  function startProcessingLoop() {
    if (animFrameId !== null) return; // already running
    isRunning = true;
    cameraActive = true;
    if (DEBUG) console.log('[EyeGuard:main-world] Starting faceMesh send loop');
    animFrameId = requestAnimationFrame(processFrame);
  }

  function stopProcessingLoop() {
    isRunning = false;
    cameraActive = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (DEBUG) console.log('[EyeGuard:main-world] Processing loop stopped');
  }

  // Monitor for video element
  const findVideoAndStart = () => {
    // Prioritize EyeGuard monitoring video, then manual test video, then any video
    videoElement = (
      document.getElementById('eyeguard-monitoring-video') || 
      document.getElementById('eyeguard-video') || 
      document.querySelector('video')
    ) as HTMLVideoElement;
    
    if (videoElement) {
        if (DEBUG) {
            if (videoElement.id === 'eyeguard-monitoring-video') {
                console.log('[EyeGuard:main-world] monitoring video detected');
            } else {
                console.log('[EyeGuard:main-world] alternative video source detected');
            }
        }
        
        const onMetadata = () => {
            if (DEBUG) console.log('[EyeGuard:main-world] metadata loaded, playing...');
            videoElement!.play().then(() => {
                if (DEBUG) console.log('[EyeGuard:main-world] Video playing, starting loop');
                startProcessingLoop();
            }).catch(e => {
                if (DEBUG) console.warn('[EyeGuard:main-world] video.play() failed', e);
                startProcessingLoop();
            });
        };

        if (videoElement.readyState >= 1) {
            onMetadata();
        } else {
            videoElement.onloadedmetadata = onMetadata;
        }
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
      return originalFetch.call(this, `chrome-extension://${EXT_ID}/face_mesh/${filename}`, init);
    }
    return originalFetch.call(this, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    const urlStr = url.toString();
    if (MEDIAPIPE_ASSET_PATTERN.test(urlStr) && !urlStr.startsWith('chrome-extension')) {
      const filename = urlStr.split('/').pop()?.split('?')[0];
      const redirectedUrl = `chrome-extension://${EXT_ID}/face_mesh/${filename}`;
      Object.defineProperty(this, 'onprogress', { get: () => null, set: () => {}, configurable: true });
      return originalOpen.apply(this, [method, redirectedUrl, ...rest] as any);
    }
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  // Expose control functions to overlay script
  (window as any).eyeguardMainWorld = {
    startProcessingLoop,
    stopProcessingLoop
  };

  if (DEBUG) console.log('[EyeGuard] Main-world engine active');
})();
