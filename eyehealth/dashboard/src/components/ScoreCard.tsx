import React from 'react';
import type { DailyEyeScore } from '@extension/db/schema';

export function ScoreCard({ scoreData }: { scoreData: DailyEyeScore | null }) {
  const getBadgeStyle = (risk: string) => {
    if (risk === "low") return "badge-green";
    if (risk === "moderate") return "badge-amber";
    return "badge-red";
  };

  const score = scoreData?.score ?? 100;
  const riskLabel = scoreData?.riskLevel ?? "low";

  return (
    <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)' }} className="p-6 rounded-2xl flex flex-col items-center gap-4 h-full justify-center">
      <h3 className="text-white/40 text-[10px] font-bold uppercase tracking-[0.2em]">Today's eye score</h3>
      
      <div className="flex flex-col items-center gap-2">
        <div style={{ 
          fontSize: '64px', fontWeight: 700, lineHeight: 1,
          color: score >= 75 ? 'var(--green-text)' : score >= 50 ? 'var(--amber-text)' : 'var(--red-text)'
        }}>
          {score}
        </div>
        <span className={`badge ${getBadgeStyle(riskLabel)}`} style={{ fontSize: '12px', padding: '4px 12px' }}>
          {riskLabel.charAt(0).toUpperCase() + riskLabel.slice(1)} Risk
        </span>
      </div>

      <div className="w-full grid grid-cols-2 gap-4 mt-4">
        <MiniMetric label="Screen" value={scoreData?.breakdown.screenTimeScore ?? 25} color="var(--amber-text)" />
        <MiniMetric label="Distance" value={scoreData?.breakdown.distanceScore ?? 25} color="var(--green-text)" />
        <MiniMetric label="Blinks" value={scoreData?.breakdown.blinkScore ?? 25} color="var(--red-text)" />
        <MiniMetric label="Lighting" value={scoreData?.breakdown.lightingScore ?? 25} color="var(--green-text)" />
      </div>
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string, value: number, color: string }) {
  const pct = (value / 25) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/30">
        <span>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{Math.round(value)}</span>
      </div>
      <div style={{ background: 'var(--border)' }} className="h-1 rounded-full overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: color, transition: "width 1s ease-out" }} />
      </div>
    </div>
  );
}
