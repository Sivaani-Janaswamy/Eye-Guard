import { useEffect, useRef, useState, useCallback } from 'react';

interface LiveFrame {
  faceDetected: boolean;
  distanceCm: number;
  blinkRate: number;
  lux: number;
  confidence: number;
  timestamp: number;
}

export default function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [camError, setCamError] = useState('');
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [fps, setFps] = useState(0);
  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  // Listen for frames from the extension content script
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // The extension broadcasts EYEGUARD_FRAME type messages to the window
      if (event.data?.type !== 'EYEGUARD_FRAME') return;
      const p = event.data.payload;

      fpsCountRef.current++;
      const now = Date.now();
      if (now - fpsTimerRef.current >= 1000) {
        setFps(fpsCountRef.current);
        fpsCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      setFrame({
        faceDetected: p.faceDetected ?? false,
        distanceCm:   Math.round(p.screenDistanceCm ?? 0),
        blinkRate:    parseFloat((p.blinkRate ?? 0).toFixed(1)),
        lux:          Math.round(p.ambientLuxLevel ?? 0),
        confidence:   Math.round((p.confidence ?? 0) * 100),
        timestamp:    now
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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
      setCamError(err.name === 'NotAllowedError'
        ? 'Camera permission denied'
        : err.message ?? 'Camera failed');
    }
  }, []);

  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setCamStatus('off');
    setFrame(null);
    setFps(0);
  }, []);

  const isStale = frame
    ? Date.now() - frame.timestamp > 4000
    : false;

  const statusColor = !frame || isStale
    ? { bg: 'rgba(255,255,255,0.05)', text: 'rgba(255,255,255,0.4)' }
    : frame.faceDetected
    ? { bg: '#EAF3DE', text: '#27500A' }
    : { bg: '#FCEBEB', text: '#791F1F' };

  const metrics = [
    { label: 'Distance',
      value: frame ? frame.distanceCm + ' cm' : '—',
      warn: !!frame && frame.faceDetected && frame.distanceCm < 50 },
    { label: 'Blink rate',
      value: frame ? frame.blinkRate + ' /min' : '—',
      warn: !!frame && frame.faceDetected && frame.blinkRate < 15 },
    { label: 'Lighting',
      value: frame ? frame.lux + ' lux' : '—',
      warn: !!frame && frame.lux < 50 },
    { label: 'Confidence',
      value: frame ? frame.confidence + '%' : '—',
      warn: !!frame && frame.faceDetected && frame.confidence < 60 },
    { label: 'Ext FPS',
      value: fps > 0 ? fps : '—',
      warn: camStatus === 'on' && fps > 0 && fps < 3 },
    { label: 'Data age',
      value: frame
        ? Math.round((Date.now() - frame.timestamp) / 1000) + 's'
        : '—',
      warn: isStale && !!frame },
  ];

  return (
    <div className="glassmorphism p-6 rounded-2xl border border-white/10 mb-8">
      <div className="flex flex-col mb-4">
        <h2 className="text-white font-bold text-lg">Camera diagnostics</h2>
        <p className="text-white/40 text-xs">Verify the extension is detecting your face and sending data.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Video preview */}
        <div className="relative aspect-video bg-black rounded-xl border border-white/5 overflow-hidden group">
          <video ref={videoRef} autoPlay playsInline muted
            className="w-full h-full object-cover mirror-mode"
            style={{ display: camStatus === 'on' ? 'block' : 'none' }}
          />
          {camStatus !== 'on' && (
            <div className="absolute inset-0 flex items-center justify-center text-white/20 text-xs italic bg-neutral-900">
              {camStatus === 'off' && 'Press Start to preview camera'}
              {camStatus === 'starting' && 'Requesting camera...'}
              {camStatus === 'error' && (camError || 'Camera error')}
            </div>
          )}
          {camStatus === 'on' && (
            <div className="absolute top-3 right-3 text-[10px] text-white/50 font-mono bg-black/40 px-2 py-1 rounded">
              {fps} fps
            </div>
          )}
        </div>

        {/* Info & Metrics */}
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <button
              onClick={camStatus === 'on' ? stopCamera : startCamera}
              disabled={camStatus === 'starting'}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                camStatus === 'on' 
                ? 'bg-red-500/10 text-red-500 border border-red-500/20' 
                : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
              }`}
            >
              {camStatus === 'on' ? 'Stop' : 'Start camera'}
            </button>

            <div className="px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2"
                 style={{ backgroundColor: statusColor.bg, color: statusColor.text, borderColor: `${statusColor.text}22` }}>
              <span className={`w-2 h-2 rounded-full ${!frame || isStale ? 'bg-neutral-500' : frame.faceDetected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              {!frame
                ? 'Waiting for extension frames...'
                : isStale
                ? 'No frames received (stale)'
                : frame.faceDetected
                ? 'Face detected'
                : 'No face in frame'
              }
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {metrics.map(({ label, value, warn }) => (
              <div key={label} className={`p-3 rounded-xl border transition-all ${
                warn 
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' 
                : 'bg-white/5 border-white/5 text-white'
              }`}>
                <div className="text-[9px] uppercase font-black opacity-40 mb-1">{label}</div>
                <div className="text-base font-bold">{String(value)}</div>
              </div>
            ))}
          </div>

          {!frame && camStatus === 'on' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-500 leading-relaxed">
              <strong>Notice:</strong> Camera is on but no frames from extension yet. 
              This indicates the extension's monitoring loop is likely paused or stopped.
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-4 text-[10px] text-white/20 italic">
        This panel is a passive diagnostic tool. It listens for EYEGUARD_FRAME messages sent by the extension's main-world context.
      </div>
    </div>
  );
}
