import { useRef, useState, useCallback, memo, useEffect } from 'react';
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

interface MessageData {
  distance: number;
  blinkRate: number;
  lux: number;
  faceDetected: boolean;
}

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on'>('off');
  
  // Real-time data from chrome.runtime messages
  const [realTimeData, setRealTimeData] = useState<MessageData | null>(null);
  const [lastMessageTime, setLastMessageTime] = useState<number>(0);
  
  // IndexedDB fallback
  const liveStats = useLiveQuery<LiveStats | null>(
    () => db.table('live_stats').get(1).catch(() => null),
    []
  );
  
  // Debug panel data
  const sessionsCount = useLiveQuery(() => db.sessions.count(), [], 0);
  const scoresCount = useLiveQuery(() => db.scores.count(), [], 0);
  const lastScore = useLiveQuery(() => db.scores.orderBy('date').last(), [], null);
  
  // Score computation state
  const [scoreComputing, setScoreComputing] = useState(false);
  const [scoreResult, setScoreResult] = useState<string>('');

  // Use real-time data if recent (within 2s), otherwise fallback to IndexedDB
  const useRealTime = realTimeData && (Date.now() - lastMessageTime) < 2000;
  const currentData = useRealTime ? realTimeData : (liveStats ? {
    distance: liveStats.distanceCm,
    blinkRate: liveStats.blinkRate,
    lux: liveStats.lux,
    faceDetected: liveStats.faceDetected
  } : null);
  
  const faceDetected = currentData?.faceDetected ?? false;
  const distance = currentData?.distance ?? 0;
  const lastUpdate = useRealTime ? lastMessageTime : (liveStats?.updatedAt ?? 0);
  const dataAge = lastUpdate ? Date.now() - lastUpdate : Infinity;

  // Distance color
  const getDistanceColor = () => {
    if (!faceDetected) return '#ef4444';
    if (distance >= 50 && distance <= 70) return '#22c55e';
    if (distance < 50) return '#f59e0b';
    return '#3b82f6';
  };

  // Message listener for real-time updates
  useEffect(() => {
    const listener = (message: any, _sender: any, _sendResponse: any) => {
      if (message.type === 'LIVE_STATS' && message.data) {
        setRealTimeData(message.data);
        setLastMessageTime(Date.now());
      }
    };
    
    if (chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(listener);
    }
    
    return () => {
      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
  }, []);

  // Camera start
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

  // Camera stop
  const stopCamera = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setCamStatus('off');
  }, []);

  // Manual score computation
  const computeScore = useCallback(async () => {
    setScoreComputing(true);
    setScoreResult('');
    let timeout = setTimeout(() => {
      setScoreResult('No response from service worker');
      setScoreComputing(false);
    }, 3000);
    
    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: 'COMPUTE_SCORE' }, (response) => {
          clearTimeout(timeout);
          if (response?.success) {
            setScoreResult('Score computed successfully');
          } else {
            setScoreResult('Failed to compute score');
          }
          resolve();
        });
      });
    } catch (err) {
      clearTimeout(timeout);
      setScoreResult('Error: ' + (err as Error).message);
    } finally {
      setScoreComputing(false);
    }
  }, []);

  return (
    <div style={{ 
      background: '#ffffff', 
      border: '1px solid #e5e7eb', 
      borderRadius: '12px', 
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <h3 style={{ 
        fontSize: '18px', 
        fontWeight: 600, 
        color: '#111827', 
        marginBottom: '20px' 
      }}>
        Camera Diagnostics
      </h3>

      {/* Stale data warning */}
      {dataAge > 5000 && (
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          background: '#f0f9ff', 
          border: '1px solid #bae6fd', 
          borderRadius: '8px' 
        }}>
          <p style={{ fontSize: '13px', color: '#0369a1', margin: 0 }}>
            Open any webpage — the extension monitors you there and sends data here automatically.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {/* Left: Video Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: '480px',
                height: '360px',
                backgroundColor: '#000',
                transform: 'scaleX(-1)',
                borderRadius: '8px',
                display: 'block'
              }}
            />
            
            {/* Bounding Box */}
            {camStatus === 'on' && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '200px',
                height: '200px',
                border: `3px solid ${faceDetected ? '#22c55e' : '#ef4444'}`,
                borderRadius: '8px',
                transition: 'border-color 0.3s ease',
                pointerEvents: 'none'
              }} />
            )}
            
            {/* Distance Overlay */}
            {camStatus === 'on' && currentData && (
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                background: 'rgba(0,0,0,0.7)',
                border: `1px solid ${getDistanceColor()}`,
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: 'monospace'
              }}>
                {Math.round(distance)} cm
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {camStatus === 'off' ? (
              <button
                onClick={startCamera}
                style={{
                  padding: '8px 16px',
                  background: '#22c55e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#16a34a'}
                onMouseOut={(e) => e.currentTarget.style.background = '#22c55e'}
              >
                Start Camera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                style={{
                  padding: '8px 16px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#dc2626'}
                onMouseOut={(e) => e.currentTarget.style.background = '#ef4444'}
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>

        {/* Right: Stats Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '280px' }}>
          {/* Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Distance */}
            <div style={{ 
              padding: '16px', 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: '4px' }}>Distance</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: getDistanceColor() }}>
                {currentData ? Math.round(distance) : '—'}
              </div>
              {currentData && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>cm</div>}
            </div>

            {/* Blink Rate */}
            <div style={{ 
              padding: '16px', 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: '4px' }}>Blink Rate</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: (currentData?.blinkRate ?? 0) >= 15 ? '#22c55e' : '#f59e0b' }}>
                {currentData ? Math.round(currentData.blinkRate) : '—'}
              </div>
              {currentData && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>/min</div>}
            </div>

            {/* Lighting */}
            <div style={{ 
              padding: '16px', 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: '4px' }}>Lighting</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: (currentData?.lux ?? 0) >= 50 ? '#22c55e' : '#f59e0b' }}>
                {currentData ? Math.round(currentData.lux) : '—'}
              </div>
              {currentData && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>lux</div>}
            </div>

            {/* Data Age */}
            <div style={{ 
              padding: '16px', 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb', 
              borderRadius: '8px' 
            }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: '4px' }}>Data Age</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: dataAge > 3000 ? '#ef4444' : dataAge > 1000 ? '#f59e0b' : '#22c55e' }}>
                {dataAge === Infinity ? '—' : Math.round(dataAge / 1000)}
              </div>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>seconds ago</div>
            </div>
          </div>

          {/* Score Computation Button */}
          <div style={{ padding: '16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <button
              onClick={computeScore}
              disabled={scoreComputing}
              style={{
                width: '100%',
                padding: '10px',
                background: scoreComputing ? '#9ca3af' : '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: scoreComputing ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => !scoreComputing && (e.currentTarget.style.background = '#2563eb')}
              onMouseOut={(e) => !scoreComputing && (e.currentTarget.style.background = '#3b82f6')}
            >
              {scoreComputing ? 'Computing...' : 'Compute Today\'s Score'}
            </button>
            {scoreResult && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: scoreResult.includes('success') ? '#22c55e' : '#ef4444' }}>
                {scoreResult}
              </div>
            )}
          </div>

          {/* Debug Panel */}
          <div style={{ padding: '16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>Debug Panel</div>
            <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: '1.6' }}>
              <div>Sessions: {sessionsCount}</div>
              <div>Scores: {scoresCount}</div>
              <div>Last score: {lastScore?.date || 'None'}</div>
              <div>Data source: {useRealTime ? 'Real-time message' : 'IndexedDB fallback'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(CameraTest);
