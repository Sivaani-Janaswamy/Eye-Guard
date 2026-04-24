import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../extension/db/db';

interface LiveStats {
  faceDetected: boolean;
  distanceCm: number;
  blinkRate: number;
  lux: number;
  updatedAt: number;
  // optional (not always present from SW)
  confidence?: number;
  landmarks?: number[][];
}

const FACE_OUTLINE = [
  10,338,297,332,284,251,389,356,454,323,361,288,
  397,365,379,378,400,377,152,148,176,149,150,136,
  172,58,132,93,234,127,162,21,54,103,67,109,10
];

const LEFT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362];
const RIGHT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
const LEFT_IRIS = [474,475,476,477,474];
const RIGHT_IRIS = [469,470,471,472,469];
const NOSE_BRIDGE = [168,6,197,195,5];
const LIPS_OUTER = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];

function drawPath(
  ctx: CanvasRenderingContext2D,
  landmarks: number[][],
  indices: number[],
  close = false
) {
  ctx.beginPath();
  indices.forEach((idx, i) => {
    const pt = landmarks[idx];
    if (!pt) return;
    const [x, y] = pt;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: number[][],
  w: number,
  h: number
) {
  const scaled = landmarks.map(pt => [pt[0] * w, pt[1] * h]);

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(0, 255, 170, 0.6)';
  ctx.lineWidth = 1.5;
  drawPath(ctx, scaled, FACE_OUTLINE, true);

  ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
  drawPath(ctx, scaled, LEFT_EYE, true);
  drawPath(ctx, scaled, RIGHT_EYE, true);

  ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
  drawPath(ctx, scaled, LEFT_IRIS, true);
  drawPath(ctx, scaled, RIGHT_IRIS, true);

  ctx.strokeStyle = 'rgba(0, 255, 170, 0.4)';
  drawPath(ctx, scaled, NOSE_BRIDGE);

  ctx.strokeStyle = 'rgba(255, 100, 150, 0.7)';
  drawPath(ctx, scaled, LIPS_OUTER, true);

  const keyPoints = [1, 4, 9, 10, 152, 33, 263, 61, 291];
  ctx.fillStyle = 'rgba(0, 255, 170, 0.9)';
  keyPoints.forEach(idx => {
    const pt = scaled[idx];
    if (!pt) return;
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const lastLandmarksRef = useRef<number[][] | null>(null);
  const logFlags = useRef({ videoReady: false, lastLandmarkLog: 0, lastDrawLog: 0, lastFpsLog: 0, lastOverlayLog: 0 });

  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [camError, setCamError] = useState('');
  const [fps, setFps] = useState(0);
  
  const fpsCountRef = useRef(0);
  const lastFpsReset = useRef(Date.now());
  const lastDisplayUpdateRef = useRef(0);

  const [displayStats, setDisplayStats] = useState<LiveStats | null>(null);

  // 1. Initial load from DB
  useEffect(() => {
    db.table('live_stats').get(1).then(stats => {
      if (stats) setDisplayStats(stats);
    });
  }, []);

  // 2. Real-time stream via messaging
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'LIVE_STATS_UPDATE') {
        console.log('[STATS UPDATE] Received live data');
        setDisplayStats(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ---------------- LANDMARKS SYNC ----------------
  useEffect(() => {
    // Only update landmarks for the overlay if the local camera is active
    if (camStatus !== 'on') return;

    const landmarks = displayStats?.landmarks;
    if (landmarks && landmarks.length > 0) {
      lastLandmarksRef.current = landmarks;
      if (Date.now() - logFlags.current.lastLandmarkLog > 2000) {
        console.log(`[LANDMARKS] Received: exists=true, points=${landmarks.length}`);
        logFlags.current.lastLandmarkLog = Date.now();
      }
    } else if (displayStats && Date.now() - logFlags.current.lastLandmarkLog > 2000) {
      console.warn("No landmarks received from LIVE_STATS_UPDATE (using last known)");
      logFlags.current.lastLandmarkLog = Date.now();
    }
  }, [displayStats, camStatus]);

  // ---------------- FPS TRACKING ----------------
  useEffect(() => {
    if (!displayStats || camStatus !== 'on') return;

    fpsCountRef.current++;
    const now = Date.now();
    if (now - lastFpsReset.current >= 1000) {
      const currentFps = fpsCountRef.current;
      setFps(currentFps);
      console.log(`[FPS] Current rate: ${currentFps}`);
      fpsCountRef.current = 0;
      lastFpsReset.current = now;
    }
  }, [displayStats?.updatedAt, camStatus]);

  // ---------------- DRAW LOOP ----------------
  useEffect(() => {
    if (camStatus !== 'on') {
      console.log('[LOOP STOP] Camera is off');
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current?.width || 0, canvasRef.current?.height || 0);
      return;
    }

    console.log('[LOOP START] Initializing render loop');
    function drawLoop() {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas && video && video.readyState >= 2) {
        if (!logFlags.current.videoReady) {
          console.log('[VIDEO] Video element ready (readyState >= 2)');
          logFlags.current.videoReady = true;
        }

        // Sync canvas internal resolution to video source resolution
        const w = video.videoWidth;
        const h = video.videoHeight;

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (lastLandmarksRef.current && camStatus === 'on') {
            drawLandmarks(ctx, lastLandmarksRef.current, w, h);
          } else {
            ctx.clearRect(0, 0, w, h);
          }
        }
      }

      animRef.current = requestAnimationFrame(drawLoop);
    }

    animRef.current = requestAnimationFrame(drawLoop);
    return () => {
      if (animRef.current !== null) {
        console.log('[LOOP STOP] Cleaning up animation frame');
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [camStatus]);

  // ---------------- CAMERA ----------------
  const startCamera = useCallback(async () => {
    setCamStatus('starting');
    setCamError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      console.log('[CAM] Permission granted, camera stream started');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamStatus('on');
      }
    } catch (err: any) {
      setCamStatus('error');
      setCamError(err?.message ?? 'Camera failed');
    }
  }, []);


  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }

    lastLandmarksRef.current = null;
    setCamStatus('off');
    setFps(0);
  }, []);

  // ---------------- STATE ----------------
  const isStale = displayStats ? Date.now() - displayStats.updatedAt > 5000 : true;
  const hasLiveData = !!displayStats && !isStale;

  const statusColor = !hasLiveData
    ? { bg: '#F1EFE8', text: '#5F5E5A' }
    : displayStats.faceDetected
    ? { bg: '#EAF3DE', text: '#27500A' }
    : { bg: '#FCEBEB', text: '#791F1F' };

  const metrics = [
    {
      label: 'Distance',
      value: hasLiveData ? `${displayStats.distanceCm} cm` : '—',
      warn: hasLiveData && displayStats.distanceCm < 50
    },
    {
      label: 'Blink rate',
      value: hasLiveData ? `${displayStats.blinkRate} /min` : '—',
      warn: hasLiveData && displayStats.blinkRate < 15
    },
    {
      label: 'Lighting',
      value: hasLiveData ? `${displayStats.lux} lux` : '—',
      warn: hasLiveData && displayStats.lux < 50
    },
    {
      label: 'Confidence',
      value: hasLiveData && displayStats.confidence != null
        ? `${Math.round(displayStats.confidence * 100)}%`
        : '—',
      warn: hasLiveData && displayStats.confidence != null && displayStats.confidence < 0.6
    },
    {
      label: 'FPS',
      value: fps || '—',
      warn: camStatus === 'on' && fps > 0 && fps < 3
    },
    {
      label: 'Data age',
      value: hasLiveData
        ? `${Math.round((Date.now() - displayStats.updatedAt) / 1000)}s`
        : '—',
      warn: !hasLiveData
    }
  ];

  const minDist = 20;
  const maxDist = 80;
  const distanceCm = displayStats?.distanceCm || 50;

  const normalized = Math.min(1, Math.max(0, (distanceCm - minDist) / (maxDist - minDist)));
  const faceLeftPct = 10 + normalized * 70; // Map to 10% - 80% range
  const lineWidthPct = Math.max(0, 88 - faceLeftPct);

  if (camStatus === 'on' && Date.now() - logFlags.current.lastOverlayLog > 5000) {
    console.log('[OVERLAY] Rendering active stats overlay');
    logFlags.current.lastOverlayLog = Date.now();
  }

  return (
    <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)' }} className="p-6 flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h3 style={{ color: 'var(--text-secondary)' }} className="text-xs font-semibold uppercase tracking-wider">
          Camera Diagnostics
        </h3>
        <div className="flex gap-2">
          {camStatus === 'off' ? (
            <button onClick={startCamera} style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }} className="text-xs px-3 py-1.5 rounded-lg transition font-bold shadow-sm">
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera} style={{ background: 'var(--red-bg)', color: 'var(--red-text)', border: '0.5px solid var(--border)' }} className="text-xs px-3 py-1.5 rounded-lg transition font-bold">
              Stop Camera
            </button>
          )}
        </div>
      </div>

      {/* Main split container */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Section: Camera Feed (~60%) */}
        <div style={{ 
          flex: '1.5',
          background: 'var(--bg-secondary)', 
          borderRadius: 'var(--radius-md)', 
          position: 'relative', 
          overflow: 'hidden',
          aspectRatio: '4/3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <video 
            ref={videoRef} 
            id="eyeguard-video" 
            autoPlay 
            muted 
            playsInline 
            style={{ 
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: camStatus === 'on' ? 'block' : 'none'
            }} 
          />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 10
            }}
          />
          
          {camStatus !== 'on' && (
            <div style={{ position: 'absolute', color: 'var(--text-tertiary)', fontSize: '12px', fontWeight: 600 }}>
              {camStatus === 'starting' ? 'Initializing Camera...' : 'Camera Feed Inactive'}
            </div>
          )}

          <div style={{ 
            width: '24px', height: '24px', borderRadius: '50%', border: '2px solid var(--blue-text)', 
            position: 'absolute', bottom: '16px', left: `${faceLeftPct}%`, transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'left 0.5s ease-out',
            zIndex: 20, background: 'rgba(255,255,255,0.8)'
          }}>
            <svg width="12" height="10" viewBox="0 0 20 16" fill="none">
              <circle cx="6" cy="8" r="3" stroke="var(--blue-text)" strokeWidth="1.2"/>
              <circle cx="14" cy="8" r="3" stroke="var(--blue-text)" strokeWidth="1.2"/>
            </svg>
          </div>
        </div>

        {/* Right Section: Diagnostics Panel (~40%) */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((m, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', border: '0.5px solid var(--border)' }} className="p-3 rounded-xl flex flex-col gap-0.5">
                <span style={{ color: 'var(--text-tertiary)' }} className="text-[9px] uppercase font-bold tracking-wider leading-tight">{m.label}</span>
                <span style={{ color: m.warn ? 'var(--amber-text)' : 'var(--text-primary)' }} className="text-base font-bold leading-tight">
                  {m.value}
                </span>
              </div>
            ))}
          </div>

          {/* Status Badge */}
          <div style={{ 
            background: statusColor.bg, 
            color: statusColor.text,
            border: '0.5px solid var(--border)',
            fontSize: '11px',
            fontWeight: 700
          }} className="mt-auto p-3 rounded-lg text-center uppercase tracking-widest">
            {!hasLiveData ? 'OFFLINE' : displayStats.faceDetected ? 'Face Detected' : 'No Face Detected'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CameraTest);