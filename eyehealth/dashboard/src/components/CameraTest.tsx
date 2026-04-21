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
  const lastUpdateRef = useRef<number>(0);

  const liveStats = useLiveQuery(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  ) as LiveStats | null;

  useEffect(() => {
    if (liveStats?.landmarks) {
      lastLandmarksRef.current = liveStats.landmarks;
    }
  }, [liveStats?.landmarks]);

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

  // ---------------- FPS ----------------
  useEffect(() => {
    if (!liveStats) return;

    const now = Date.now();
    const dt = now - lastUpdateRef.current;

    if (lastUpdateRef.current && dt < 2000) {
      setFps(f => Math.min(10, f + 1));
    } else {
      setFps(1);
    }

    lastUpdateRef.current = now;
  }, [liveStats?.updatedAt]);

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
  const isStale = liveStats ? Date.now() - liveStats.updatedAt > 5000 : true;
  const hasLiveData = !!liveStats && !isStale;

  const statusColor = !hasLiveData
    ? { bg: '#F1EFE8', text: '#5F5E5A' }
    : liveStats.faceDetected
    ? { bg: '#EAF3DE', text: '#27500A' }
    : { bg: '#FCEBEB', text: '#791F1F' };

  const metrics = [
    {
      label: 'Distance',
      value: hasLiveData ? `${liveStats.distanceCm} cm` : '—',
      warn: hasLiveData && liveStats.distanceCm < 50
    },
    {
      label: 'Blink rate',
      value: hasLiveData ? `${liveStats.blinkRate} /min` : '—',
      warn: hasLiveData && liveStats.blinkRate < 15
    },
    {
      label: 'Lighting',
      value: hasLiveData ? `${liveStats.lux} lux` : '—',
      warn: hasLiveData && liveStats.lux < 50
    },
    {
      label: 'Confidence',
      value: hasLiveData && liveStats.confidence != null
        ? `${Math.round(liveStats.confidence * 100)}%`
        : '—',
      warn: hasLiveData && liveStats.confidence != null && liveStats.confidence < 0.6
    },
    {
      label: 'FPS',
      value: fps || '—',
      warn: camStatus === 'on' && fps > 0 && fps < 3
    },
    {
      label: 'Data age',
      value: hasLiveData
        ? `${Math.round((Date.now() - liveStats.updatedAt) / 1000)}s`
        : '—',
      warn: !hasLiveData
    }
  ];

  return (
    <div>
      {/* Face badge */}
      {camStatus === 'on' && hasLiveData && (
        <div>
          {liveStats.faceDetected
            ? `${liveStats.distanceCm}cm · ${liveStats.blinkRate}/min`
            : 'no face'}
        </div>
      )}

      {!hasLiveData && camStatus === 'on' && (
        <div>
          No data from extension — check SW + content script
        </div>
      )}
    </div>
  );
}

export default memo(CameraTest);