import { useRef, useState, useCallback, memo } from 'react';
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

  // Read live_stats from IndexedDB (written by extension main-world.ts)
  const liveStats = useLiveQuery<LiveStats | null>(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  );

  // ----------- DERIVED STATE -----------
  const isStale = !liveStats || (Date.now() - liveStats.updatedAt) > 5000;
  const faceDetected = !isStale && liveStats?.faceDetected;

  // Optimal conditions: good distance (50-70cm) AND good lighting (>=50 lux)
  const isDistanceGood = faceDetected && liveStats!.distanceCm >= 50 && liveStats!.distanceCm <= 70;
  const isLightingGood = !isStale && liveStats!.lux >= 50;
  const isOptimal = isDistanceGood && isLightingGood;

  // Color helpers
  const getDistanceColor = () => {
    if (!faceDetected) return 'text-gray-400';
    const d = liveStats!.distanceCm;
    if (d < 50) return 'text-amber-400';
    if (d <= 70) return 'text-green-400';
    return 'text-blue-400';
  };

  const getBlinkColor = () => {
    if (!faceDetected) return 'text-gray-400';
    const b = liveStats!.blinkRate;
    if (b < 15) return 'text-amber-400';
    return 'text-green-400';
  };

  const getLuxColor = () => {
    if (isStale) return 'text-gray-400';
    const l = liveStats!.lux;
    if (l < 50) return 'text-amber-400';
    return 'text-green-400';
  };

  const getAgeColor = () => {
    if (!liveStats) return 'text-gray-400';
    const age = Date.now() - liveStats.updatedAt;
    if (age > 3000) return 'text-red-400';
    if (age > 1000) return 'text-amber-400';
    return 'text-green-400';
  };

  const getStatusColor = () => {
    if (isStale) return 'text-gray-400';
    if (!faceDetected) return 'text-amber-400';
    if (isOptimal) return 'text-green-400';
    return 'text-amber-400';
  };

  const getStatusText = () => {
    if (isStale) return 'Waiting for data';
    if (!faceDetected) return 'No face detected';
    if (isOptimal) return 'Optimal';
    if (!isDistanceGood) return 'Adjust distance';
    if (!isLightingGood) return 'More light needed';
    return 'Face detected';
  };

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

  // ----------- RENDER -----------
  return (
    <div className="glassmorphism p-8 rounded-2xl">
      <h3 className="text-xl font-semibold text-white mb-6">Camera Diagnostics</h3>

      {/* Stale data message */}
      {isStale && (
        <div className="mb-6 p-4 bg-blue-500/15 border border-blue-500/30 rounded-xl">
          <p className="text-blue-200 text-sm leading-relaxed">
            Open any webpage — the extension monitors you there and sends data here automatically.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Video Preview */}
        <div className="flex flex-col gap-5">
          <div className="relative self-start">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="rounded-xl shadow-lg"
              style={{
                width: 640,
                height: 480,
                backgroundColor: '#000',
                transform: 'scaleX(-1)'
              }}
            />
          </div>

          <div className="flex gap-3">
            {camStatus === 'off' ? (
              <button
                onClick={startCamera}
                className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
              >
                Start Camera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>

        {/* Right: Stats Grid */}
        <div className="flex flex-col">
          <div className="grid grid-cols-2 gap-4 h-full">
            {/* Distance */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Distance</div>
              <div className={`text-2xl font-bold ${getDistanceColor()}`}>
                {faceDetected ? `${liveStats!.distanceCm}` : '—'}
              </div>
              {faceDetected && <div className="text-white/30 text-xs mt-1">cm</div>}
            </div>

            {/* Blink Rate */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Blink Rate</div>
              <div className={`text-2xl font-bold ${getBlinkColor()}`}>
                {faceDetected ? `${liveStats!.blinkRate}` : '—'}
              </div>
              {faceDetected && <div className="text-white/30 text-xs mt-1">/min</div>}
            </div>

            {/* Lighting */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Lighting</div>
              <div className={`text-2xl font-bold ${getLuxColor()}`}>
                {!isStale ? `${liveStats!.lux}` : '—'}
              </div>
              {!isStale && <div className="text-white/30 text-xs mt-1">lux</div>}
            </div>

            {/* Confidence */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Confidence</div>
              <div className={`text-2xl font-bold ${faceDetected ? 'text-green-400' : 'text-gray-400'}`}>
                {faceDetected && liveStats!.confidence !== undefined
                  ? `${Math.round(liveStats!.confidence * 100)}`
                  : '—'}
              </div>
              {faceDetected && <div className="text-white/30 text-xs mt-1">%</div>}
            </div>

            {/* Data Age */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Data Age</div>
              <div className={`text-2xl font-bold ${getAgeColor()}`}>
                {liveStats
                  ? `${Math.round((Date.now() - liveStats.updatedAt) / 1000)}`
                  : '—'}
              </div>
              {liveStats && <div className="text-white/30 text-xs mt-1">seconds ago</div>}
            </div>

            {/* Status */}
            <div className="flex flex-col justify-center p-5 bg-white/5 rounded-xl">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Status</div>
              <div className={`text-lg font-semibold leading-tight ${getStatusColor()}`}>
                {getStatusText()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CameraTest);