import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@extension/db/db';

interface LiveStats {
  id: number;
  distanceCm: number;
  blinkRate: number;
  lux: number;
  faceDetected: boolean;
  updatedAt: number;
  confidence?: number;
}

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on'>('off');

  // FPS tracking for live_stats updates
  const updateCountRef = useRef(0);
  const [dataFps, setDataFps] = useState(0);
  const lastFpsTimeRef = useRef(Date.now());

  // Read live_stats from IndexedDB (written by extension main-world.ts)
  const liveStats = useLiveQuery<LiveStats | null>(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  );

  // Track update rate
  useEffect(() => {
    if (liveStats) {
      updateCountRef.current++;
      const now = Date.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        setDataFps(updateCountRef.current);
        updateCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }
    }
  }, [liveStats]);

  // ----------- CAMERA START -----------
  const startCamera = useCallback(async () => {
    setCamStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamStatus('on');
      }
    } catch (err) {
      console.error('[CameraTest] Failed to start camera:', err);
      setCamStatus('off');
    }
  }, []);

  // ----------- CAMERA STOP -----------
  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setCamStatus('off');
  }, []);

  // ----------- DERIVED STATE -----------
  const isStale = !liveStats || (Date.now() - liveStats.updatedAt) > 5000;
  const hasData = liveStats && !isStale;
  const faceDetected = hasData && liveStats.faceDetected;

  // Color helpers
  const getDistanceColor = () => {
    if (!faceDetected) return 'text-gray-400';
    const d = liveStats!.distanceCm;
    if (d < 50) return 'text-amber-400'; // Too close
    if (d <= 70) return 'text-green-400'; // Good
    return 'text-blue-400'; // Far
  };

  const getBlinkColor = () => {
    if (!faceDetected) return 'text-gray-400';
    const b = liveStats!.blinkRate;
    if (b < 15) return 'text-amber-400'; // Too low
    return 'text-green-400';
  };

  const getLuxColor = () => {
    if (!hasData) return 'text-gray-400';
    const l = liveStats!.lux;
    if (l < 50) return 'text-amber-400'; // Too dark
    return 'text-green-400';
  };

  const getAgeColor = () => {
    if (!liveStats) return 'text-gray-400';
    const age = Date.now() - liveStats.updatedAt;
    if (age > 3000) return 'text-red-400';
    if (age > 1000) return 'text-amber-400';
    return 'text-green-400';
  };

  // ----------- RENDER -----------
  return (
    <div className="glassmorphism p-6 rounded-2xl">
      <h3 className="text-lg font-semibold text-white mb-4">Camera Diagnostics</h3>

      {/* Warning when camera is on but no data */}
      {camStatus === 'on' && isStale && (
        <div className="mb-4 p-3 bg-amber-500/20 border border-amber-500/40 rounded-lg">
          <p className="text-amber-200 text-sm">
            Camera preview is on but the extension is not sending data.
            Make sure you have a webpage open with EyeGuard active.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Video Preview */}
        <div className="flex flex-col gap-4">
          <div className="relative w-fit">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="rounded-lg"
              style={{
                width: 320,
                height: 240,
                backgroundColor: '#000',
                transform: 'scaleX(-1)' // Mirror for natural feel
              }}
            />
            {/* FPS Badge */}
            <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-white font-mono">
              {dataFps} fps
            </div>
            {/* Status Badge */}
            <div className={`absolute bottom-2 left-2 px-2 py-1 rounded text-xs font-medium ${
              faceDetected ? 'bg-green-500/80 text-white' :
                hasData ? 'bg-amber-500/80 text-white' :
                  'bg-gray-500/80 text-white'
            }`}>
              {faceDetected ? 'Face detected ✓' :
                hasData ? 'No face in frame' :
                  'Extension not active'}
            </div>
          </div>

          <div className="flex gap-2">
            {camStatus === 'off' ? (
              <button
                onClick={startCamera}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Start Camera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>

        {/* Right: Stats Grid */}
        <div className="flex flex-col justify-center">
          <div className="grid grid-cols-2 gap-4">
            {/* Distance */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Distance</div>
              <div className={`text-lg font-semibold ${getDistanceColor()}`}>
                {faceDetected ? `${liveStats!.distanceCm} cm` : '—'}
              </div>
            </div>

            {/* Blink Rate */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Blink Rate</div>
              <div className={`text-lg font-semibold ${getBlinkColor()}`}>
                {faceDetected ? `${liveStats!.blinkRate} /min` : '—'}
              </div>
            </div>

            {/* Lighting */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Lighting</div>
              <div className={`text-lg font-semibold ${getLuxColor()}`}>
                {hasData ? `${liveStats!.lux} lux` : '—'}
              </div>
            </div>

            {/* Confidence */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Confidence</div>
              <div className={`text-lg font-semibold ${faceDetected ? 'text-green-400' : 'text-gray-400'}`}>
                {faceDetected && liveStats!.confidence !== undefined
                  ? `${Math.round(liveStats!.confidence * 100)}%`
                  : '—'}
              </div>
            </div>

            {/* Data Age */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Data Age</div>
              <div className={`text-lg font-semibold ${getAgeColor()}`}>
                {liveStats
                  ? `${Math.round((Date.now() - liveStats.updatedAt) / 1000)}s ago`
                  : '—'}
              </div>
            </div>

            {/* Status */}
            <div className="p-3 bg-white/5 rounded-lg">
              <div className="text-white/50 text-xs mb-1">Status</div>
              <div className={`text-sm font-medium ${
                faceDetected ? 'text-green-400' :
                  hasData ? 'text-amber-400' :
                    'text-gray-400'
              }`}>
                {faceDetected ? 'Face detected ✓' :
                  hasData ? 'No face in frame' :
                    'Extension not active'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CameraTest);