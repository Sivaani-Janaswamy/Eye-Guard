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
  // VERSION: 2026-04-19
  const [isDemoData, setIsDemoData] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);

  // Reactive Data Queries
  const scores = useLiveQuery(() => db.scores.orderBy('date').reverse().toArray(), []);
  const alerts = useLiveQuery(() => db.alerts.orderBy('triggeredAt').reverse().limit(10).toArray(), []);
  const liveStats = useLiveQuery(() => (db as any).live_stats.get(1), []);
  const activeSession = useLiveQuery(
    () => db.sessions.orderBy('startTime').reverse().first().then(s => (s && s.endTime === null) ? s : null),
    []
  );

  const [sessionTimeMs, setSessionTimeMs] = useState(0);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Initial session load (fallback)
  useEffect(() => {
    db.sessions.orderBy('startTime').reverse().first().then(s => {
      if (s && s.endTime === null) {
        setSessionTimeMs(Date.now() - s.startTime);
      }
    });
  }, []);

  // Sync session time from live stats stream
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'LIVE_STATS_UPDATE' && message.payload.durationMs !== undefined) {
        setSessionTimeMs(message.payload.durationMs);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);


  // Prediction load (not reactive as it changes slowly)
  useEffect(() => {
    db.predictions.orderBy('generatedAt').reverse().first().then(p => {
      if (p) setPrediction(p);
    });
  }, []);

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
    <div className="max-w-7xl mx-auto p-4 sm:p-8 flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EyeGuard Dashboard</h1>
          <p className="text-white/50 text-sm mt-1">
            Holistic tracking map for optical longevity. 
            (Distance: <span className="text-indigo-400 font-mono">{liveDistance}</span>
            {activeSession && <> | Session: <span className="text-indigo-400 font-mono">{formatTime(sessionTimeMs)}</span></>})
          </p>
          <span className="text-xs text-indigo-400 font-mono">Build: 2026-04-19</span>
        </div>
        {isDemoData && (
          <div className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-semibold text-xs px-4 py-2 rounded-full flex items-center gap-2">
             <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Demo data — Tracking loop is currently inactive
          </div>
        )}
      </header>
      {/* Diagnostics Panel - Always Visible */}
      <section className="mb-4">
        <CameraTest />
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Immediate status & Predictions */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          <div className="h-auto">
             <ScoreCard scoreData={displayScore} />
          </div>
          <div className="h-auto">
             {prediction && <PredictionCard prediction={prediction} />}
          </div>
        </div>
        {/* Center / Right Column: Deep data & Overrides */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Top Section: Charts */}
          <div className="flex flex-col glassmorphism p-6 h-[320px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">30-day eye score history</h3>
              <span className="badge badge-amber">Avg: {Math.round(displayHistory.reduce((a,b)=>a+b.score,0)/displayHistory.length)}</span>
            </div>
            <TrendChart scores={displayHistory} />
            <div className="text-[11px] text-white/30 text-center mt-4 italic">Connect extension to see real-time data flow</div>
          </div>
          
          {/* Metrics Grid 2x2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="metric-card">
              <div className="metric-label">Avg screen time</div>
              <div className="metric-value">{(displayHistory.reduce((a,b)=>a+b.totalScreenMinutes,0)/displayHistory.length/60).toFixed(1)} hrs</div>
              <div className="text-[11px] mt-1 text-red-400 font-medium">Above 6hr target</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Avg blink rate</div>
              <div className="metric-value">{(displayHistory.reduce((a,b)=>a+b.breakdown.blinkScore,0)/displayHistory.length).toFixed(1)}/min</div>
              <div className="text-[11px] mt-1 text-red-400 font-medium">Below 15/min target</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Avg distance</div>
              <div className="metric-value">{Math.round(displayHistory.reduce((a,b)=>a+b.breakdown.distanceScore,0)/displayHistory.length + 30)} cm</div>
              <div className="text-[11px] mt-1 text-green-400 font-medium">Within safe range</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Breaks taken</div>
              <div className="metric-value">14 / 22</div>
              <div className="text-[11px] mt-1 text-amber-400 font-medium">64% compliance</div>
            </div>
          </div>

          {/* Bottom Section: Feed and Controls split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-auto">
            <AlertFeed alerts={displayAlerts} />
            <CorrectionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
