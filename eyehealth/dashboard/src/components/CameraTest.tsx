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

  // ---------------- FPS TRACKING ----------------
  useEffect(() => {
    if (!liveStats) return;

    fpsCountRef.current++;
    const now = Date.now();
    if (now - lastFpsReset.current >= 1000) {
      const currentFps = fpsCountRef.current;
      setFps(currentFps);
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
        const w = video.videoWidth || canvas.width;
        const h = video.videoHeight || canvas.height;

        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (lastLandmarksRef.current) {
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

  const faceLeftPct = hasLiveData 
    ? Math.min(85, Math.max(5, ((displayStats.distanceCm - 15) / 100) * 100)) 
    : 10;
  
  const lineWidthPct = hasLiveData 
    ? Math.max(0, 90 - faceLeftPct - 5) 
    : 80;

  return (
    <div className="glassmorphism p-6 rounded-2xl flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">
          Camera Diagnostics
        </h3>
        <div className="flex gap-2">
          {camStatus === 'off' ? (
            <button onClick={startCamera} className="text-xs px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 rounded-lg transition font-bold shadow-lg shadow-indigo-500/20">
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera} className="text-xs px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition font-bold border border-red-500/30">
              Stop Camera
            </button>
          )}
        </div>
      </div>

      {/* Simulation Canvas - Purely Visual */}
      <div style={{ width: '100%', height: '80px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', position: 'relative', overflow: 'hidden' }}>
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
          height: '2px', background: displayStats?.distanceCm && displayStats.distanceCm < 50 ? 'var(--red-text)' : 'var(--green-text)', 
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '12%',
          width: `${lineWidthPct}%`, transition: 'width 0.5s ease-out, background 0.3s ease'
        }}></div>
        <div style={{ width: '28px', height: '22px', background: 'var(--border)', borderRadius: '3px', position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {metrics.map((m, i) => (
          <div key={i} style={{ background: 'var(--bg-secondary)', border: '0.5px solid var(--border)' }} className="p-3 rounded-xl flex flex-col gap-1">
            <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">{m.label}</span>
            <span className={`text-lg font-bold ${m.warn ? 'text-amber-400' : 'text-white'}`}>
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {camStatus === 'on' && (
        <div className="relative aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/10 shadow-inner">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover grayscale opacity-40 mix-blend-screen" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          
          <div className="absolute top-4 right-4 flex gap-2">
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${hasLiveData && displayStats.faceDetected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] font-bold text-white tracking-widest uppercase">
                {hasLiveData && displayStats.faceDetected ? 'Face Locked' : 'Searching...'}
              </span>
            </div>
          </div>
        </div>
      )}

      {camStatus === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-center">
          <p className="text-red-400 text-sm font-medium">{camError}</p>
        </div>
      )}
    </div>
  );
}

export default memo(CameraTest);