import { useEffect, useRef, useState } from 'react';

interface LiveMetrics {
  faceDetected: boolean;
  distanceCm: number;
  blinkRate: number;
  lux: number;
  confidence: number;
  fps: number;
  lastUpdate: number;
}

export default function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [metrics, setMetrics] = useState<LiveMetrics>({
    faceDetected: false, distanceCm: 0, blinkRate: 0,
    lux: 0, confidence: 0, fps: 0, lastUpdate: 0
  });
  const [status, setStatus] = useState<
    'idle' | 'requesting' | 'active' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const frameCountRef = useRef(0);
  const lastFpsRef = useRef(Date.now());

  useEffect(() => {
    // Listen for frames posted from main-world via the extension
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'EYEGUARD_FRAME') return;
      const f = event.data.payload;

      frameCountRef.current++;
      const now = Date.now();
      const elapsed = (now - lastFpsRef.current) / 1000;
      let currentFps = metrics.fps;
      if (elapsed >= 1) {
        currentFps = Math.round(frameCountRef.current / elapsed);
        frameCountRef.current = 0;
        lastFpsRef.current = now;
      }

      setMetrics({
        faceDetected: f.faceDetected,
        distanceCm:   Math.round(f.screenDistanceCm),
        blinkRate:    parseFloat(f.blinkRate?.toFixed(1) ?? '0'),
        lux:          Math.round(f.ambientLuxLevel),
        confidence:   Math.round((f.confidence ?? 0) * 100),
        fps:          currentFps,
        lastUpdate:   now
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [metrics.fps]);

  async function startCamera() {
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('active');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message ?? 'Camera access denied');
    }
  }

  function stopCamera() {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream)
        .getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setStatus('idle');
    setMetrics(m => ({ ...m, faceDetected: false, fps: 0 }));
  }

  const isStale = Date.now() - metrics.lastUpdate > 3000;
  const dataColor = !metrics.faceDetected || isStale
    ? '#791F1F' : '#27500A';
  const dataBg = !metrics.faceDetected || isStale
    ? '#FCEBEB' : '#EAF3DE';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '0.5px solid rgba(255,255,255,0.1)',
      borderRadius: 12, padding: 16, marginBottom: 12
    }}>
      <div style={{
        fontSize: 13, fontWeight: 500,
        color: '#fff', marginBottom: 12
      }}>
        Camera test panel
      </div>

      {/* Video preview */}
      <div style={{
        background: '#000', borderRadius: 8, overflow: 'hidden',
        marginBottom: 12, position: 'relative',
        aspectRatio: '4/3', maxWidth: 320
      }}>
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover',
            transform: 'scaleX(-1)' /* mirror */
          }}
        />
        {status !== 'active' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#888', fontSize: 13
          }}>
            {status === 'idle' && 'Camera off'}
            {status === 'requesting' && 'Starting...'}
            {status === 'error' && errorMsg}
          </div>
        )}
        {/* FPS badge */}
        {status === 'active' && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            fontSize: 11, padding: '2px 6px', borderRadius: 6
          }}>
            {metrics.fps} fps
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={status === 'active' ? stopCamera : startCamera}
          style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 13,
            border: '0.5px solid rgba(255,255,255,0.1)',
            background: status === 'active' ? '#791F1F22' : 'rgba(255,255,255,0.05)',
            color: status === 'active' ? '#ff8080' : '#fff',
            cursor: 'pointer'
          }}
        >
          {status === 'active' ? 'Stop camera' : 'Start camera'}
        </button>
        <div style={{
          padding: '7px 12px', borderRadius: 8, fontSize: 12,
          background: dataBg, color: dataColor,
          border: `0.5px solid ${dataColor}22`
        }}>
          {!metrics.lastUpdate
            ? 'Waiting for frames...'
            : isStale
            ? 'No frames (stale)'
            : metrics.faceDetected
            ? 'Face detected'
            : 'No face in frame'
          }
        </div>
      </div>

      {/* Live metrics grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8
      }}>
        {[
          { label: 'Distance', value: metrics.distanceCm + ' cm',
            warn: metrics.distanceCm > 0 && metrics.distanceCm < 50 },
          { label: 'Blink rate', value: metrics.blinkRate + ' /min',
            warn: metrics.blinkRate > 0 && metrics.blinkRate < 15 },
          { label: 'Lighting', value: metrics.lux + ' lux',
            warn: metrics.lux > 0 && metrics.lux < 50 },
          { label: 'Confidence', value: metrics.confidence + '%',
            warn: metrics.confidence > 0 && metrics.confidence < 60 },
          { label: 'Frames/sec', value: metrics.fps,
            warn: status === 'active' && metrics.fps < 3 },
          { label: 'Data age',
            value: metrics.lastUpdate
              ? Math.round((Date.now() - metrics.lastUpdate) / 1000) + 's ago'
              : '—',
            warn: isStale && !!metrics.lastUpdate
          }
        ].map(({ label, value, warn }) => (
          <div key={label} style={{
            background: warn ? '#FAEEDA' : 'rgba(255,255,255,0.05)',
            borderRadius: 8, padding: '10px 12px'
          }}>
            <div style={{
              fontSize: 11, color: warn ? '#633806' : 'rgba(255,255,255,0.5)',
              marginBottom: 3
            }}>{label}</div>
            <div style={{
              fontSize: 18, fontWeight: 500,
              color: warn ? '#633806' : '#fff'
            }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{
        fontSize: 11, color: 'rgba(255,255,255,0.3)',
        marginTop: 10, fontStyle: 'italic'
      }}>
        This panel reads live frames from the EyeGuard extension.
        Values update in real time when face is detected.
      </div>
    </div>
  );
}
