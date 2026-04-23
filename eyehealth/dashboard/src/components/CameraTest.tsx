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

  const liveStats = useLiveQuery(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  ) as LiveStats | null;

  // ---------------- DISPLAY THROTTLING ----------------
  useEffect(() => {
    if (!liveStats) return;

    const now = Date.now();
    if (now - lastDisplayUpdateRef.current > 500) {
      setDisplayStats(liveStats);
      lastDisplayUpdateRef.current = now;
    }
  }, [liveStats]);

  // ---------------- LANDMARKS SYNC ----------------
  useEffect(() => {
    if (liveStats?.landmarks) {
      lastLandmarksRef.current = liveStats.landmarks;
      if (Date.now() - logFlags.current.lastLandmarkLog > 2000) {
        console.log(`[LANDMARKS] Received: exists=true, points=${liveStats.landmarks.length}`);
        logFlags.current.lastLandmarkLog = Date.now();
      }
    } else if (liveStats && Date.now() - logFlags.current.lastLandmarkLog > 2000) {
      console.log('[LANDMARKS] No landmarks in liveStats');
      logFlags.current.lastLandmarkLog = Date.now();
    }
  }, [liveStats]);

  // ---------------- FPS TRACKING ----------------
  useEffect(() => {
    if (!liveStats) return;

    fpsCountRef.current++;
    const now = Date.now();
    if (now - lastFpsReset.current >= 1000) {
      const currentFps = fpsCountRef.current;
      setFps(currentFps);
      console.log(`[FPS] Current rate: ${currentFps}`);
      fpsCountRef.current = 0;
      lastFpsReset.current = now;
    }
  }, [liveStats?.updatedAt]);

  // ---------------- DRAW LOOP ----------------
  useEffect(() => {
    function drawLoop() {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas && video && video.readyState >= 2) {
        if (!logFlags.current.videoReady) {
          console.log('[VIDEO] Video element ready (readyState >= 2)');
          logFlags.current.videoReady = true;
        }

        const w = video.videoWidth || canvas.width;
        const h = video.videoHeight || canvas.height;

        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('[DRAW] Canvas context is null');
        } else {
          if (lastLandmarksRef.current) {
            if (Date.now() - logFlags.current.lastDrawLog > 3000) {
              console.log('[DRAW] Executing drawLandmarks on canvas');
              logFlags.current.lastDrawLog = Date.now();
            }
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
        cancelAnimationFrame(animRef.current);
      }
    };
  }, []);

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

      <div style={{ width: '100%', height: '80px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', position: 'relative', overflow: 'hidden' }}>
        <video 
          ref={videoRef} 
          id="eyeguard-video" 
          autoPlay 
          muted 
          playsInline 
          style={{ display: 'none' }} 
        />
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', border: '2px solid var(--blue-text)', 
          position: 'absolute', top: '50%', left: `${faceLeftPct}%`, transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'left 0.5s ease-out'
        }}>
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
            <circle cx="6" cy="8" r="3" stroke="var(--blue-text)" strokeWidth="1.2"/>
            <circle cx="14" cy="8" r="3" stroke="var(--blue-text)" strokeWidth="1.2"/>
            <circle cx="6" cy="8" r="1" fill="var(--blue-text)" />
            <circle cx="14" cy="8" r="1" fill="var(--blue-text)" />
          </svg>
        </div>
        <div style={{ 
          height: '2px', background: distanceCm < 50 ? 'var(--red-text)' : 'var(--green-text)', 
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '12%',
          width: `${lineWidthPct}%`, transition: 'width 0.5s ease-out, background 0.3s ease'
        }}></div>
        <div style={{ width: '28px', height: '22px', background: 'var(--border)', borderRadius: '3px', position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {metrics.map((m, i) => (
          <div key={i} style={{ background: 'var(--bg-secondary)', border: '0.5px solid var(--border)' }} className="p-3 rounded-xl flex flex-col gap-1">
            <span style={{ color: 'var(--text-tertiary)' }} className="text-[10px] uppercase font-bold tracking-wider">{m.label}</span>
            <span style={{ color: m.warn ? 'var(--amber-text)' : 'var(--text-primary)' }} className="text-lg font-bold">
              {m.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(CameraTest);