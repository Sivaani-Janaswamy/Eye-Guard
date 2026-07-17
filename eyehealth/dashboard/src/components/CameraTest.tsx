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
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

function CameraTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camStatus, setCamStatus] = useState<'off' | 'starting' | 'on'>('off');
  const [camError, setCamError] = useState<string>('');
  
  // Real-time data from chrome.runtime messages
  const [realTimeData, setRealTimeData] = useState<MessageData | null>(null);
  const [lastMessageTime, setLastMessageTime] = useState<number>(0);
  const [bbox, setBbox] = useState<MessageData['bbox']>(null);
  
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

  // Scale bbox to video size
  function scaleBbox(bbox: MessageData['bbox'], videoWidth: number, videoHeight: number) {
    if (!bbox) return null;
    return {
      left: bbox.x * videoWidth,
      top: bbox.y * videoHeight,
      width: bbox.width * videoWidth,
      height: bbox.height * videoHeight
    };
  }

  // Message listener for real-time updates
  useEffect(() => {
    const listener = (message: any, _sender: any, _sendResponse: any) => {
      if (message.type === 'LIVE_STATS' && message.data) {
        console.log('[CameraTest] LIVE_STATS received:', message.data);
        console.log('[CameraTest] bbox in message:', message.data.bbox);
        setRealTimeData(message.data);
        setLastMessageTime(Date.now());
        setBbox(message.data.bbox || null);
      }
    };
    
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(listener);
    }
    
    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
  }, []);

  // Camera start
  const startCamera = useCallback(async () => {
    setCamStatus('starting');
    setCamError('');
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
      let friendlyError = 'Failed to access camera. Please check your browser permissions.';
      const errName = (err as Error).name;
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        friendlyError = 'Camera access denied. Please click the camera icon in your browser address bar and allow access to this site.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        friendlyError = 'No camera hardware detected. Please connect a webcam and try again.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        friendlyError = 'Camera is already in use by another application (e.g. Zoom, Teams, Discord). Please close other camera apps and try again.';
      }
      setCamError(friendlyError);
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
    setCamError('');
  }, []);

  // Manual score computation
  const computeScore = useCallback(async () => {
    setScoreComputing(true);
    setScoreResult('');
    
    // Check if we are running without the Chrome extension
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      // In demo mode/development, we simulate score computation locally
      try {
        const demoScoreVal = Math.floor(Math.random() * 20 + 75); // random score 75-95
        const todayString = new Date().toISOString().split('T')[0];
        
        // Write the mock score to local IndexedDB so the charts and cards update reactively
        await db.scores.put({
          date: todayString,
          score: demoScoreVal,
          breakdown: { screenTimeScore: 8, distanceScore: 9, blinkScore: 7, lightingScore: 9 },
          riskLevel: "low" as const,
          myopiaRiskFlag: false,
          totalScreenMinutes: 120,
          avgDistanceCm: 55,
          avgBlinkRate: 15,
          avgLux: 150,
          totalDurationMs: 120 * 60000
        });
        
        setScoreResult(`🧪 Demo Mode: Computed mock score of ${demoScoreVal}/100 and updated local charts.`);
      } catch (err) {
        setScoreResult('⚠️ Demo Mode Error: Failed to write mock score to database: ' + (err as Error).message);
      } finally {
        setScoreComputing(false);
      }
      return;
    }
    
    let timeout = setTimeout(() => {
      setScoreResult('⚠️ No response from the extension service worker. Try restarting the extension.');
      setScoreComputing(false);
    }, 4000);
    
    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: 'COMPUTE_SCORE' }, (response) => {
          clearTimeout(timeout);
          if (response?.success) {
            const scoreVal = response.score?.score ?? 'N/A';
            setScoreResult(`✅ Score computed successfully! Today's score: ${scoreVal}/100.`);
          } else {
            let errorMsg = 'Failed to compute score.';
            if (response?.error === 'No sessions today') {
              errorMsg = '⚠️ No monitoring data recorded today yet. Please open a regular website in a new tab (e.g. google.com or youtube.com) and stay on it for at least 30 seconds so the extension can record a tracking session.';
            } else if (response?.error) {
              errorMsg = `⚠️ Error from extension: ${response.error}`;
            }
            setScoreResult(errorMsg);
          }
          resolve();
        });
      });
    } catch (err) {
      clearTimeout(timeout);
      setScoreResult('⚠️ Message Error: Could not connect to extension background script. ' + (err as Error).message);
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

      {/* Dynamic presence warning */}
      {!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? (
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          background: '#fffbeb', 
          border: '1px solid #fcd34d', 
          borderRadius: '8px' 
        }}>
          <p style={{ fontSize: '13px', color: '#92400e', margin: 0, fontWeight: 500 }}>
            🧪 Running in Demo Mode (Extension not active). Background monitoring is disabled. You can still test camera capture and simulate scores below.
          </p>
        </div>
      ) : dataAge > 5000 ? (
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          background: '#f0f9ff', 
          border: '1px solid #bae6fd', 
          borderRadius: '8px' 
        }}>
          <p style={{ fontSize: '13px', color: '#0369a1', margin: 0 }}>
            ℹ️ Monitoring is active. Open any standard webpage (e.g., google.com or youtube.com) and stay on it for a few seconds to update real-time face metrics here.
          </p>
        </div>
      ) : null}

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
            {camStatus === 'on' && (() => {
              const videoEl = videoRef.current;
              const scaledBox = bbox && videoEl
                ? scaleBbox(bbox, videoEl.clientWidth, videoEl.clientHeight)
                : null;
              console.log('[CameraTest] Rendering bbox:', { bbox, videoEl, scaledBox });
              return scaledBox && (
                <div style={{
                  position: 'absolute',
                  left: scaledBox.left,
                  top: scaledBox.top,
                  width: scaledBox.width,
                  height: scaledBox.height,
                  border: `2px solid ${faceDetected ? '#22c55e' : '#ef4444'}`,
                  borderRadius: '8px',
                  transition: 'all 0.1s linear',
                  pointerEvents: 'none'
                }} />
              );
            })()}
            
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

          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', width: '100%' }}>
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

            {camError && (
              <div style={{
                marginTop: '8px',
                padding: '10px 12px',
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                borderRadius: '6px',
                color: '#b91c1c',
                fontSize: '12px',
                lineHeight: '1.4'
              }}>
                ⚠️ {camError}
              </div>
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
