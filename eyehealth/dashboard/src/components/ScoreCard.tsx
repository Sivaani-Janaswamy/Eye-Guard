import React from 'react';
import type { DailyEyeScore } from '@extension/db/schema';

export function ScoreCard({ scoreData }: { scoreData: DailyEyeScore | null }) {
  const getBadgeStyle = (risk: string) => {
    if (risk === "low") return "bg-green-500/20 text-green-400 border-green-500/30";
    if (risk === "moderate") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-red-500/20 text-red-500 border-red-500/30";
  };

  const scoreText = getBadgeStyle(scoreData?.riskLevel || "low");

  return (
    <div className="glassmorphism p-6 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute top-4 left-4 text-white/50 text-xs font-semibold uppercase tracking-wider">
        Today's Overview
      </div>
      
      {scoreData?.myopiaRiskFlag && (
        <div className="absolute top-4 right-4 bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded border border-red-500/30 font-bold">
          ⚠️ HIGH RISK
        </div>
      )}

      <div className="mt-6 flex flex-col items-center">
        <span className="text-8xl font-extrabold tracking-tighter" style={{ textShadow: "0 4px 24px rgba(0,0,0,0.5)"}}>
          {scoreData?.score ?? 100}
        </span>
        <span className={`mt-4 px-4 py-1 rounded-full text-sm font-semibold border backdrop-blur-md ${scoreText}`}>
          {scoreData?.riskLevel ? scoreData.riskLevel.toUpperCase() + ' RISK' : 'LOW RISK'}
        </span>
      </div>
      
      <div className="w-full grid grid-cols-4 gap-4 mt-8">
        <BreakdownBar label="Screen Time" value={scoreData?.breakdown.screenTimeScore ?? 25} />
        <BreakdownBar label="Distance" value={scoreData?.breakdown.distanceScore ?? 25} />
        <BreakdownBar label="Blink Rate" value={scoreData?.breakdown.blinkScore ?? 25} />
        <BreakdownBar label="Lighting" value={scoreData?.breakdown.lightingScore ?? 25} />
      </div>
    </div>
  );
}

function BreakdownBar({ label, value }: { label: string, value: number }) {
  const pct = (value / 25) * 100;
  let color = "bg-green-500";
  if (pct < 75) color = "bg-amber-500";
  if (pct < 50) color = "bg-red-500";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-[10px] text-white/60 uppercase font-semibold text-center leading-tight h-6">
        {label}
      </div>
      <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: "width 1s ease-out" }} />
      </div>
      <div className="text-xs font-bold">{Math.round(value)}/25</div>
    </div>
  );
}
