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
    return Array.from({ length: 30 }).map((_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
      score: Math.floor(Math.random() * 40 + 40),
      breakdown: { screenTimeScore: 10, distanceScore: 10, blinkScore: 10, lightingScore: 10 },
      riskLevel: "moderate" as const,
      myopiaRiskFlag: false,
      totalScreenMinutes: 400
    }));
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
          <p className="text-white/50 text-sm mt-1">Holistic tracking map for optical longevity. (Distance: <span className="text-indigo-400 font-mono">{liveDistance}</span>)</p>
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
      <section className="mb-8">
        <CameraTest />
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Immediate status & Predictions */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          <div className="h-[380px]">
             <ScoreCard scoreData={displayScore} />
          </div>
          <div className="h-[280px]">
             {prediction && <PredictionCard prediction={prediction} />}
          </div>
        </div>
        {/* Center / Right Column: Deep data & Overrides */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          {/* Top Section: Charts */}
          <div className="flex flex-col h-[380px] min-h-[300px]">
            <TrendChart scores={displayHistory} />
          </div>
          {/* Bottom Section: Feed and Controls split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[380px]">
            <AlertFeed alerts={displayAlerts} />
            <CorrectionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
