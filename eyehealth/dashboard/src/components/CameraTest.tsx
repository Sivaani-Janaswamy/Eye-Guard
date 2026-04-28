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

type SuggestionType = 'blink' | 'distance' | 'lighting' | 'break' | null;

interface Suggestion {
  type: SuggestionType;
  message: string;
  priority: number; // Higher = more urgent
}

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on'>('off');

  // FPS tracking for live_stats updates
  const updateCountRef = useRef(0);
  const [dataFps, setDataFps] = useState(0);
  const lastFpsTimeRef = useRef(Date.now());

  // Suggestion tracking
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const lowBlinkStartRef = useRef<number | null>(null);
  const closeDistanceStartRef = useRef<number | null>(null);
  const lastSuggestionRef = useRef<number>(0);

  // Read live_stats from IndexedDB (written by extension main-world.ts)
  const liveStats = useLiveQuery<LiveStats | null>(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  );

  // Track update rate and generate suggestions
  useEffect(() => {
    if (liveStats) {
      updateCountRef.current++;
      const now = Date.now();

      // Debug logging
      console.log('[CameraTest] liveStats:', {
        faceDetected: liveStats.faceDetected,
        distanceCm: liveStats.distanceCm,
        blinkRate: liveStats.blinkRate,
        lux: liveStats.lux,
        isOptimal: liveStats.faceDetected && liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 && liveStats.lux >= 50
      });

      // FPS counter
      if (now - lastFpsTimeRef.current >= 1000) {
        setDataFps(updateCountRef.current);
        updateCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      // Generate suggestions based on metrics (every 5 seconds max)
      if (now - lastSuggestionRef.current > 5000) {
        const newSuggestion = generateSuggestion(liveStats, now);
        console.log('[CameraTest] Generated suggestion:', newSuggestion);
        if (newSuggestion) {
          setSuggestion(newSuggestion);
          lastSuggestionRef.current = now;
        }
      }
    }
  }, [liveStats]);

  // Generate health suggestion based on current metrics
  const generateSuggestion = (stats: LiveStats, now: number): Suggestion | null => {
    if (!stats.faceDetected) return null;

    const suggestions: Suggestion[] = [];

    // 1. Blink rate check (priority: 3) - warn after 10s of low blinking
    if (stats.blinkRate < 15) {
      if (!lowBlinkStartRef.current) {
        lowBlinkStartRef.current = now;
        console.log('[CameraTest] Started tracking low blink rate');
      }
      const lowBlinkDuration = now - lowBlinkStartRef.current;
      console.log('[CameraTest] Low blink duration:', lowBlinkDuration, 'ms');
      if (lowBlinkDuration > 10000) { // 10 seconds for testing
        suggestions.push({
          type: 'blink',
          message: 'Blink more — your blink rate is low, which can dry out eyes',
          priority: 3
        });
      }
    } else {
      if (lowBlinkStartRef.current) {
        console.log('[CameraTest] Reset low blink tracking (rate good)');
      }
      lowBlinkStartRef.current = null;
    }

    // 2. Distance check (priority: 2) - warn after 5s of being too close
    if (stats.distanceCm < 50) {
      if (!closeDistanceStartRef.current) {
        closeDistanceStartRef.current = now;
        console.log('[CameraTest] Started tracking close distance');
      }
      const closeDuration = now - closeDistanceStartRef.current;
      console.log('[CameraTest] Close distance duration:', closeDuration, 'ms');
      if (closeDuration > 5000) { // 5 seconds for testing
        suggestions.push({
          type: 'distance',
          message: 'Move back — you\'re too close to the screen (aim for 50-70cm)',
          priority: 2
        });
      }
    } else {
      if (closeDistanceStartRef.current) {
        console.log('[CameraTest] Reset distance tracking (distance good)');
      }
      closeDistanceStartRef.current = null;
    }

    // 3. Lighting check (priority: 2) - immediate if dark
    if (stats.lux < 50) {
      console.log('[CameraTest] Poor lighting detected:', stats.lux, 'lux');
      suggestions.push({
        type: 'lighting',
        message: 'More light needed — room is too dark for comfortable viewing',
        priority: 2
      });
    }

    // 4. Break check (priority: 1) - suggest break every 20 minutes
    const sessionDuration = now - sessionStartRef.current;
    if (sessionDuration > 20 * 60 * 1000) { // 20 minutes
      suggestions.push({
        type: 'break',
        message: 'You\'ve been looking at the screen for 20+ mins — consider taking a break or closing the laptop for a bit',
        priority: 1
      });
    }

    // Return highest priority suggestion
    return suggestions.length > 0
      ? suggestions.reduce((max, s) => s.priority > max.priority ? s : max)
      : null;
  };

  // Dismiss current suggestion
  const dismissSuggestion = () => {
    setSuggestion(null);
    lastSuggestionRef.current = Date.now(); // Reset timer
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

  // ----------- DERIVED STATE -----------
  const isStale = !liveStats || (Date.now() - liveStats.updatedAt) > 5000;
  const hasData = liveStats && !isStale;
  const faceDetected = hasData && liveStats.faceDetected;

  // Optimal conditions: good distance (50-70cm) AND good lighting (>=50 lux)
  const isDistanceGood = faceDetected && liveStats!.distanceCm >= 50 && liveStats!.distanceCm <= 70;
  const isLightingGood = hasData && liveStats!.lux >= 50;
  const isOptimal = isDistanceGood && isLightingGood; // Green toast condition

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

  // Status badge color logic
  const getStatusBadgeStyle = () => {
    if (!hasData) return 'bg-gray-500/90 text-white';
    if (!faceDetected) return 'bg-amber-500/90 text-white';
    if (isOptimal) return 'bg-green-500/90 text-white';
    return 'bg-amber-500/90 text-white'; // Face detected but not optimal
  };

  const getStatusText = () => {
    if (!hasData) return 'Extension not active';
    if (!faceDetected) return 'No face in frame';
    if (isOptimal) return 'Optimal ✓';
    if (!isDistanceGood) return 'Adjust distance';
    if (!isLightingGood) return 'More light needed';
    return 'Face detected';
  };

  // ----------- RENDER -----------
  return (
    <div className="glassmorphism p-8 rounded-2xl">
      <h3 className="text-xl font-semibold text-white mb-6">Camera Diagnostics</h3>

      {/* Warning when camera is on but no data */}
      {camStatus === 'on' && isStale && (
        <div className="mb-6 p-4 bg-amber-500/15 border border-amber-500/30 rounded-xl">
          <p className="text-amber-200 text-sm leading-relaxed">
            Camera preview is on but the extension is not sending data.
            Make sure you have a webpage open with EyeGuard active.
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
                width: 360,
                height: 270,
                backgroundColor: '#000',
                transform: 'scaleX(-1)'
              }}
            />
            {/* FPS Badge */}
            <div className="absolute top-3 right-3 px-2.5 py-1.5 bg-black/70 backdrop-blur-sm rounded-md text-xs text-white font-mono">
              {dataFps} fps
            </div>
            {/* Status Badge - Shows overall health */}
            <div className={`absolute bottom-3 left-3 px-3 py-1.5 rounded-md text-xs font-medium ${getStatusBadgeStyle()}`}>
              {getStatusText()}
            </div>
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
                {hasData ? `${liveStats!.lux}` : '—'}
              </div>
              {hasData && <div className="text-white/30 text-xs mt-1">lux</div>}
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
              <div className={`text-lg font-semibold leading-tight ${
                isOptimal ? 'text-green-400' :
                  faceDetected ? 'text-amber-400' :
                    hasData ? 'text-amber-400' :
                      'text-gray-400'
              }`}>
                {isOptimal ? 'Optimal conditions' :
                  faceDetected ? 'Face detected' :
                    hasData ? 'No face' :
                      'Not active'}
              </div>
              {isOptimal && <div className="text-white/30 text-xs mt-1">Distance & light good</div>}
              {faceDetected && !isOptimal && !isDistanceGood && <div className="text-white/30 text-xs mt-1">Move 50-70cm away</div>}
              {faceDetected && !isOptimal && isDistanceGood && !isLightingGood && <div className="text-white/30 text-xs mt-1">Need more light</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Yellow Suggestion Banner */}
      {suggestion && (
        <div className="mt-6 p-4 bg-amber-500/15 border border-amber-500/30 rounded-xl flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center">
            <span className="text-amber-400 text-lg">💡</span>
          </div>
          <div className="flex-1">
            <div className="text-amber-300 text-sm font-medium mb-1">
              Health Tip
            </div>
            <p className="text-amber-100 text-sm leading-relaxed">
              {suggestion.message}
            </p>
          </div>
          <button
            onClick={dismissSuggestion}
            className="flex-shrink-0 text-amber-400/60 hover:text-amber-400 transition-colors text-sm"
            aria-label="Dismiss suggestion"
          >
            ✕
          </button>
        </div>
      )}

      {/* Info about suggestions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="text-white/30 text-xs">Suggestions appear for:</span>
        <span className="text-amber-400/60 text-xs">Low blink rate</span>
        <span className="text-white/20 text-xs">•</span>
        <span className="text-amber-400/60 text-xs">Close distance</span>
        <span className="text-white/20 text-xs">•</span>
        <span className="text-amber-400/60 text-xs">Poor lighting</span>
        <span className="text-white/20 text-xs">•</span>
        <span className="text-amber-400/60 text-xs">Screen time</span>
      </div>
    </div>
  );
}

export default memo(CameraTest);