import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@extension/db/db';
import type { PredictionResult, AlertEvent } from '@extension/db/schema';
import { ScoreCard } from '../components/ScoreCard';
import { TrendChart } from '../components/TrendChart';
import { PredictionCard } from '../components/PredictionCard';
import { AlertFeed } from '../components/AlertFeed';
import { CorrectionPanel } from '../components/CorrectionPanel';
import CameraTest from '../components/CameraTest';

export default function Dashboard() {
  // VERSION: 2026-04-25-dexie-single-source
  const [isDemoData, setIsDemoData] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);

  // Dexie-based real-time data (single source of truth)
  const liveStats = useLiveQuery(
    () => db.table('live_stats').get(1),
    [],
    null
  );
  
  const sessionData = useLiveQuery(
    () => db.table('session_data').get(1),
    [],
    null
  );
  
  const [sessionTimeMs, setSessionTimeMs] = useState(0);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Update session time from Dexie data
  useEffect(() => {
    if (sessionData?.durationMs !== undefined) {
      setSessionTimeMs(sessionData.durationMs);
    }
  }, [sessionData]);

  // Remove all chrome.runtime.onMessage listeners - use Dexie only
  // No more message handling for stats


  // Prediction load (not reactive as it changes slowly)
  useEffect(() => {
    db.predictions.orderBy('generatedAt').reverse().first().then(p => {
      if (p) setPrediction(p);
    });
  }, []);

  // Reactive Data Queries
  const scores = useLiveQuery(() => db.scores.orderBy('date').reverse().toArray(), []);
  const alerts = useLiveQuery(() => db.alerts.orderBy('triggeredAt').reverse().limit(10).toArray(), []);
  const activeSession = useLiveQuery(
    () => db.sessions.orderBy('startTime').reverse().first().then(s => (s && s.endTime === null) ? s : null),
    []
  );

  // Sync Logic Derived from Live Queries
  const todayScore = (scores && scores.length > 0) ? scores[0] : null;
  const history = (scores && scores.length > 0) ? [...scores].reverse().slice(-30) : [];

  const displayHistory = history.length > 0 ? history : generateDemoHistory();
  const displayScore = todayScore || displayHistory[displayHistory.length - 1];
  const displayAlerts = (alerts && alerts.length > 0) ? alerts : (isDemoData ? generateDemoAlerts() : []);

  useEffect(() => {
    if (scores && scores.length > 0) {
      if (isDemoData) setIsDemoData(false);
    } else if (scores && scores.length === 0) {
      if (!isDemoData) setIsDemoData(true);
    }
  }, [scores, isDemoData]);

  // Log dashboard mount
  useEffect(() => {
    console.log('[EyeGuard] Dashboard mounted');
  }, []);

  function generateDemoHistory() {
    return Array.from({ length: 30 }).map((_, i) => {
      const totalScreenMinutes = 400;
      return {
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
        score: Math.floor(Math.random() * 40 + 40),
        breakdown: { screenTimeScore: 10, distanceScore: 10, blinkScore: 10, lightingScore: 10 },
        riskLevel: "moderate" as const,
        myopiaRiskFlag: false,
        totalScreenMinutes,
        avgDistanceCm: 50 + Math.random() * 20,      // 50–70 cm
        avgBlinkRate: 12 + Math.random() * 6,        // 12–18 blinks/min
        avgLux: 100 + Math.random() * 200,           // 100–300 lux
        totalDurationMs: totalScreenMinutes * 60000
      };
    });
  }

  function generateDemoAlerts(): AlertEvent[] {
    return [{
      alertId: "demo-1",
      type: "distance",
      severity: "warning",
      triggeredAt: Date.now() - 3600000,
      dismissed: false,
      snoozedUntil: null,
      message: "Demo: Distance tracking example message",
      actionTaken: null
    }];
  }

  const liveDistance = (liveStats && liveStats.faceDetected && (Date.now() - liveStats.updatedAt < 10000))
    ? `${Math.round(liveStats.distanceCm)}cm` 
    : "Searching...";

  if (scores === undefined) {
    return <div className="min-h-screen flex items-center justify-center font-bold text-white/50 animate-pulse">Connecting to EyeGuard Engine...</div>;
  }

  return (
    <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '16px 32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Original Header */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.025em' }}>EyeGuard Dashboard</h1>
          <p style={{ color: '#ffffff', fontSize: '14px', marginTop: '4px' }}>
            Holistic tracking map for optical longevity. 
            (Distance: <span style={{ color: '#fcd34d', fontFamily: 'monospace' }}>{liveDistance}</span>
            {activeSession && <> | Session: <span style={{ color: '#fcd34d', fontFamily: 'monospace' }}>{formatTime(sessionTimeMs)}</span></>})
          </p>
          <span style={{ fontSize: '12px', color: '#fcd34d', fontFamily: 'monospace' }}>Build: 2026-04-19</span>
        </div>
      </header>
      {/* Diagnostics Panel - Always Visible */}
      <section style={{ marginBottom: '16px' }}>
        <CameraTest />
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '32px' }}>
        {/* Left Column: Immediate status & Predictions */}
        <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div style={{ height: 'auto' }}>
             <ScoreCard scoreData={displayScore} />
          </div>
          
          {/* Unified Health Insights Component - Vertical Layout */}
          <div style={{ 
            background: '#ffffff', 
            border: '1px solid #e5e7eb', 
            borderRadius: '12px', 
            padding: '20px'
          }}>
            <div style={{ 
              fontSize: '11px', 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em', 
              color: '#6b7280', 
              fontWeight: 600, 
              marginBottom: '16px' 
            }}>
              Health Insights & Achievements
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Weekly Insight */}
              <div style={{ 
                background: '#fffbeb', 
                border: '1px solid #fcd34d', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#92400e', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  💡 Weekly Insight
                </div>
                <p style={{ 
                  fontSize: '12px', 
                  color: '#78350f', 
                  lineHeight: '1.4',
                  margin: 0 
                }}>
                  {displayScore?.score >= 80 
                    ? "Excellent eye health this week! Keep maintaining your healthy screen habits."
                    : displayScore?.score >= 60
                    ? "Your screen distance has improved by 15% this week! Keep maintaining the 50-70cm optimal range."
                    : "Let's focus on improving your eye health this week. Try taking more breaks and maintaining better screen distance."
                  }
                </p>
                <div style={{ 
                  fontSize: '10px', 
                  color: '#92400e', 
                  marginTop: '6px',
                  fontStyle: 'italic'
                }}>
                  Based on your last 7 days of data
                </div>
              </div>

              {/* Achievements */}
              <div style={{ 
                background: '#f0fdf4', 
                border: '1px solid #86efac', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#166534', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  🏆 Achievements
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {history.length >= 7 && (
                    <span style={{
                      background: '#dcfce7',
                      color: '#166534',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      ✅ 7-Day Streak
                    </span>
                  )}
                  {displayScore?.score >= 80 && (
                    <span style={{
                      background: '#dbeafe',
                      color: '#1e40af',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      👁️ Eye Health Pro
                    </span>
                  )}
                  {history.length >= 30 && (
                    <span style={{
                      background: '#f3e8ff',
                      color: '#6b21a8',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      📊 Data Lover
                    </span>
                  )}
                  {activeSession && (
                    <span style={{
                      background: '#fee2e2',
                      color: '#991b1b',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      🔥 Active Monitor
                    </span>
                  )}
                </div>
              </div>

              {/* Health Tip */}
              <div style={{ 
                background: '#f0f9ff', 
                border: '1px solid #7dd3fc', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#1e40af', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  💬 Health Tip
                </div>
                <p style={{ 
                  fontSize: '12px', 
                  color: '#1e3a8a', 
                  lineHeight: '1.4',
                  margin: 0 
                }}>
                  Did you know? The 20-20-20 rule: Every 20 minutes, look at something 20 feet away for 20 seconds to reduce eye strain.
                </p>
              </div>
            </div>
          </div>
          
          <div style={{ height: 'auto' }}>
             {prediction && <PredictionCard prediction={prediction} />}
          </div>
        </div>
        {/* Center / Right Column: Deep data & Overrides */}
        <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Top Section: Charts */}
          <div style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600 }}>30-day eye score history</h3>
              <span style={{ padding: '4px 8px', background: '#fef3c7', color: '#92400e', fontSize: '12px', borderRadius: '6px' }}>Avg: {Math.round(displayHistory.reduce((a,b)=>a+b.score,0)/displayHistory.length)}</span>
            </div>
            <div style={{ height: '240px' }}>
              <TrendChart scores={displayHistory} />
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginTop: '12px', fontStyle: 'italic' }}>Connect extension to see real-time data flow</div>
          </div>
          
          {/* Enhanced Metrics Grid 2x2 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                📏
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Live Distance</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.distanceCm ? `${Math.round(liveStats.distanceCm)} cm` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.distanceCm && liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.distanceCm && liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? '✓' : '⚠️'}
                </span>
                {liveStats?.distanceCm ? (liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? 'Optimal range' : 'Aim for 50-70cm') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                👁️
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Live Blink Rate</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.blinkRate ? `${Math.round(liveStats.blinkRate)}/min` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.blinkRate && liveStats.blinkRate >= 15 ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.blinkRate && liveStats.blinkRate >= 15 ? '✓' : '⚠️'}
                </span>
                {liveStats?.blinkRate ? (liveStats.blinkRate >= 15 ? 'Healthy rate' : 'Aim for 15+/min') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                💡
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Ambient Light</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.lux ? `${Math.round(liveStats.lux)} lux` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.lux && liveStats.lux >= 200 ? '#22c55e' : liveStats?.lux && liveStats.lux < 50 ? '#ef4444' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.lux && liveStats.lux >= 200 ? '✓' : liveStats?.lux && liveStats.lux < 50 ? '⚠️' : '⚠️'}
                </span>
                {liveStats?.lux ? (liveStats.lux >= 200 ? 'Good lighting' : liveStats.lux < 50 ? 'Too dim' : 'Aim for 200+ lux') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                🎭
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Face Detection</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.faceDetected ? 'Yes' : liveStats ? 'No' : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.faceDetected ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.faceDetected ? '✓' : liveStats ? '⚠️' : '⚠️'}
                </span>
                {liveStats?.faceDetected ? 'Tracking active' : liveStats ? 'Move into view' : 'No data'}
              </div>
            </div>
          </div>

          {/* Bottom Section: Feed and Controls split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '32px', height: 'auto' }}>
            <AlertFeed alerts={displayAlerts} />
            <CorrectionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
