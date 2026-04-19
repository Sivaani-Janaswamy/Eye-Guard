import React, { useEffect, useState } from 'react';
import { db } from '../../../extension/db/db';
import { DailyEyeScore, AlertEvent, PredictionResult } from '../../../extension/db/schema';
import { ScoreCard } from '../components/ScoreCard';
import { TrendChart } from '../components/TrendChart';
import { AlertFeed } from '../components/AlertFeed';
import { CorrectionPanel } from '../components/CorrectionPanel';
import { PredictionCard } from '../components/PredictionCard';

export default function Dashboard() {
  const [isDemoData, setIsDemoData] = useState(false);
  const [todayScore, setTodayScore] = useState<DailyEyeScore | null>(null);
  const [history, setHistory] = useState<DailyEyeScore[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Load standard hook data
  useEffect(() => {
    const loadRealData = async () => {
      try {
        const scores = await db.scores.orderBy('date').reverse().toArray();
        const recentAlerts = await db.alerts.orderBy('triggeredAt').reverse().limit(10).toArray();
        const latestPrediction = await db.predictions.orderBy('generatedAt').reverse().first();

        if (scores.length > 0) {
          setIsDemoData(false);
          setTodayScore(scores[0]);
          setHistory([...scores].reverse().slice(-30)); // Ensure chronological limit
          setAlerts(recentAlerts);
          if (latestPrediction) setPrediction(latestPrediction);
          return true;
        }
      } catch (err) {
        console.warn("DB Access blocked or empty", err);
      }
      return false;
    };

    const injectDemoData = () => {
      setIsDemoData(true);
      const demoHistory: DailyEyeScore[] = Array.from({ length: 30 }).map((_, i) => ({
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
        score: Math.floor(Math.random() * 40 + 40), // Random 40-80
        breakdown: { screenTimeScore: 10, distanceScore: 10, blinkScore: 10, lightingScore: 10 },
        riskLevel: "moderate",
        myopiaRiskFlag: false,
        totalScreenMinutes: 400
      }));
      setHistory(demoHistory);
      setTodayScore(demoHistory[demoHistory.length - 1]);

      setAlerts([{
        alertId: "demo-1",
        type: "distance",
        severity: "warning",
        triggeredAt: Date.now() - 3600000,
        dismissed: false,
        snoozedUntil: null,
        message: "You're too close to the screen — try moving back a bit",
        actionTaken: null
      }]);

      setPrediction({
        generatedAt: Date.now(),
        horizon: "7d",
        predictedRiskLevel: "moderate",
        confidence: "Early estimate" as unknown as number,
        trendSlope: -1.2,
        keyFactors: [
          "Blink rate averaged 11 bpm this week (target: 15+)",
          "Screen distance below 45cm on 5 of the last 7 days",
          "Daily score dropped 8 points over the past week"
        ],
        recommendation: "Increase break frequency and maintain 50cm+ screen distance",
        disclaimer: "This is a habit trend indicator, not medical advice."
      });
    };

    loadRealData().then(hasData => {
      if (!hasData) injectDemoData();
      setLoading(false);
    });

    const poller = setInterval(() => {
      loadRealData();
    }, 10000); // Polling dynamically refreshes charts when DB changes

    return () => clearInterval(poller);
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center font-bold text-white/50">Waking up Engine...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-8 flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EyeGuard Dashboard</h1>
          <p className="text-white/50 text-sm mt-1">Holistic tracking map for optical longevity.</p>
        </div>
        
        {isDemoData && (
          <div className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-semibold text-xs px-4 py-2 rounded-full flex items-center gap-2">
             <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Demo data — connect the extension to see real stats
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Immediate status & Predictions */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          <div className="h-[380px]">
             <ScoreCard scoreData={todayScore} />
          </div>
          <div className="h-[280px]">
             {prediction && <PredictionCard prediction={prediction} />}
          </div>
        </div>

        {/* Center / Right Column: Deep data & Overrides */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          
          {/* Top Section: Charts */}
          <div className="h-[380px]">
            <TrendChart scores={history} />
          </div>

          {/* Bottom Section: Feed and Controls split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[380px]">
            <AlertFeed alerts={alerts} />
            <CorrectionPanel />
          </div>

        </div>
      </div>
    </div>
  );
}
