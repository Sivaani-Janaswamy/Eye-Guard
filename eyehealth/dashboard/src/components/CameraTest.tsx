import { useEffect, useRef, useState, useCallback, memo } from 'react';

// TypeScript declaration for global FaceMesh loaded via CDN
declare global {
  interface Window {
    FaceMesh: any;
  }
}

interface Stats {
  faceDetected: boolean;
  distanceCm: number;
  blinkRate: number;
  lux: number;
  updatedAt: number;
  landmarks: number[][];
}

// Load FaceMesh script from CDN
const loadFaceMeshScript = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (window.FaceMesh) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = '/face_mesh/face_mesh.js';
    console.log('[CameraTest] Loading FaceMesh from:', script.src);
    script.crossOrigin = 'anonymous';
    script.onload = async () => {
      // Wait for window.FaceMesh to be available (up to 2 seconds)
      let attempts = 0;
      const maxAttempts = 20;
      const interval = 100;

      while (!window.FaceMesh && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, interval));
        attempts++;
      }

      if (window.FaceMesh) {
        resolve();
      } else {
        reject(new Error('FaceMesh not available after script load'));
      }
    };
    script.onerror = (err) => {
      console.error('[CameraTest] Failed to load FaceMesh script from:', script.src, err);
      reject(new Error(`Failed to load FaceMesh from ${script.src}`));
    };
    document.head.appendChild(script);
  });
};

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on'>('off');
  const [stats, setStats] = useState<Stats | null>(null);
  const [fps, setFps] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const blinkTimestamps = useRef<number[]>([]);
  const isBlinking = useRef(false);
  const lastFpsTime = useRef(Date.now());
  const frameCount = useRef(0);

  // FaceMesh instance ref for proper lifecycle management
  const faceMeshRef = useRef<any>(null);
  const isLoopRunning = useRef(false);
  const lastFrameSend = useRef(0);

  // ----------- CAMERA START -----------
  const startCamera = useCallback(async () => {
    setCamStatus('starting');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCamStatus('on');
    }
  }, []);

  // ----------- CAMERA STOP -----------
  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    // Stop animation loop
    isLoopRunning.current = false;
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    // Close FaceMesh instance
    if (faceMeshRef.current) {
      faceMeshRef.current.close();
      faceMeshRef.current = null;
    }

    // Reset blink tracking
    blinkTimestamps.current = [];
    isBlinking.current = false;

    setStats(null);
    setFps(0);
    setCamStatus('off');
  }, []);

  // ----------- FACE MESH LOGIC -----------
  useEffect(() => {
    if (camStatus !== 'on') return;

    // Prevent duplicate initialization
    if (faceMeshRef.current) {
      console.log('[CameraTest] FaceMesh already initialized, skipping');
      return;
    }

    let isMounted = true;

    const initFaceMesh = async () => {
      try {
        setIsLoading(true);
        await loadFaceMeshScript();

        if (!isMounted || !window.FaceMesh) return;

        const faceMesh = new window.FaceMesh({
          locateFile: (file: string) => {
            const path = `/face_mesh/${file}`;
            console.log('[CameraTest] FaceMesh locating file:', file, '->', path);
            return path;
          }
        });

        faceMeshRef.current = faceMesh;

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results: any) => {
          const now = Date.now();

          if (!results.multiFaceLandmarks?.length) {
            setStats({
              faceDetected: false,
              distanceCm: 0,
              blinkRate: blinkTimestamps.current.length,
              lux: 0,
              updatedAt: now,
              landmarks: []
            });
            return;
          }

          const lm = results.multiFaceLandmarks[0];

          // -------- DISTANCE --------
          const dx = (lm[263].x - lm[33].x) * 640;
          const dy = (lm[263].y - lm[33].y) * 480;
          const pixelDist = Math.sqrt(dx * dx + dy * dy);
          const distanceCm = Math.min(200, Math.max(15, (6.3 * 600) / pixelDist));

          // -------- BLINK --------
          const computeEAR = (a: number, b: number, c: number, d: number, e: number, f: number) => {
            const dist = (p1: any, p2: any) =>
              Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

            const v1 = dist(lm[b], lm[f]);
            const v2 = dist(lm[c], lm[e]);
            const h = dist(lm[a], lm[d]);

            return (v1 + v2) / (2 * h);
          };

          const ear =
            (computeEAR(33, 160, 158, 133, 153, 144) +
              computeEAR(362, 385, 387, 263, 373, 380)) /
            2;

          if (ear < 0.18 && !isBlinking.current) {
            isBlinking.current = true;
            blinkTimestamps.current.push(now);
          } else if (ear > 0.18) {
            isBlinking.current = false;
          }

          // keep last 60s
          blinkTimestamps.current = blinkTimestamps.current.filter(
            t => now - t < 60000
          );

          // -------- LUX --------
          let lux = 0;
          try {
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx && videoRef.current) {
              ctx.drawImage(videoRef.current, 0, 0, 40, 30);
              const data = ctx.getImageData(0, 0, 40, 30).data;
              let sum = 0;
              for (let i = 0; i < data.length; i += 16) {
                sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
              }
              lux = Math.round((sum / (data.length / 16)) / 255 * 500);
            }
          } catch {}

          setStats({
            faceDetected: true,
            distanceCm: Math.round(distanceCm),
            blinkRate: blinkTimestamps.current.length,
            lux,
            updatedAt: now,
            landmarks: lm.map((p: any) => [p.x, p.y])
          });
        });

        // Throttled loop at ~30 FPS (33ms between frames)
        const loop = async () => {
          if (!isLoopRunning.current) return;

          const video = videoRef.current;
          const now = Date.now();

          // Throttle: only send every 33ms (~30 FPS)
          if (video && video.readyState >= 2 && now - lastFrameSend.current >= 33) {
            try {
              lastFrameSend.current = now;
              await faceMesh.send({ image: video });
            } catch (err) {
              console.warn('[CameraTest] FaceMesh send error:', err);
            }
          }

          frameCount.current++;

          if (now - lastFpsTime.current >= 1000) {
            setFps(frameCount.current);
            frameCount.current = 0;
            lastFpsTime.current = now;
          }

          if (isLoopRunning.current) {
            animRef.current = requestAnimationFrame(loop);
          }
        };

        // Start loop only if not already running
        if (!isLoopRunning.current) {
          isLoopRunning.current = true;
          lastFrameSend.current = 0;
          loop();
        }

        setIsLoading(false);
      } catch (err) {
        console.error('[CameraTest] Failed to initialize FaceMesh:', err);
        setIsLoading(false);
      }
    };

    initFaceMesh();

    return () => {
      isMounted = false;
      isLoopRunning.current = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
        faceMeshRef.current = null;
      }
    };
  }, [camStatus]);

  // ----------- DRAW LANDMARKS ON CANVAS -----------
  useEffect(() => {
    if (!canvasRef.current || !stats?.landmarks?.length) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw landmarks as small circles
    ctx.fillStyle = '#00ff00';
    const radius = 2;

    for (const point of stats.landmarks) {
      const x = point[0] * canvas.width;
      const y = point[1] * canvas.height;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [stats?.landmarks]);

  // ----------- RENDER -----------
  return (
    <div className="glassmorphism p-6 rounded-2xl">
      <h3 className="text-lg font-semibold text-white mb-4">Camera Diagnostics (Isolated)</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Video + Canvas Overlay */}
        <div className="flex flex-col gap-4">
          <div className="relative w-fit">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="rounded-lg"
              style={{ width: 320, height: 240, backgroundColor: '#000' }}
            />
            <canvas
              ref={canvasRef}
              width={320}
              height={240}
              className="absolute top-0 left-0 rounded-lg pointer-events-none"
            />
          </div>

          <div className="flex gap-2">
            {camStatus === 'off' ? (
              <button
                onClick={startCamera}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Start
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {/* Right: Stats */}
        <div className="flex flex-col justify-center">
          {stats ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-white/60">Face:</span>
                <span className={stats.faceDetected ? 'text-green-400' : 'text-red-400'}>
                  {stats.faceDetected ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Distance:</span>
                <span className="text-white font-medium">{stats.distanceCm} cm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Blinks/min:</span>
                <span className="text-white font-medium">{stats.blinkRate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Light:</span>
                <span className="text-white font-medium">{stats.lux} lux</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">FPS:</span>
                <span className="text-white font-medium">{fps}</span>
              </div>
            </div>
          ) : (
            <div className="text-white/40 text-sm italic">Face detection unavailable</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(CameraTest);