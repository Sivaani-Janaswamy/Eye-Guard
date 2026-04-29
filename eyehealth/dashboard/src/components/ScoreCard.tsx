import React from 'react';
import type { DailyEyeScore } from '@extension/db/schema';

export function ScoreCard({ scoreData }: { scoreData: DailyEyeScore | null }) {
  const getBadgeStyle = (risk: string) => {
    if (risk === "low") return "badge-green";
    if (risk === "moderate") return "badge-amber";
    return "badge-red";
  };

  if (!scoreData) {
    return (
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col items-center gap-4 h-full justify-center">
        <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600 }}>Today's eye score</h3>
        
        <div className="flex flex-col items-center gap-2">
          <SkeletonBox width="80px" height="64px" />
          <SkeletonBox width="100px" height="24px" />
        </div>

        <div className="w-full grid grid-cols-2 gap-4 mt-4">
          <SkeletonMiniMetric />
          <SkeletonMiniMetric />
          <SkeletonMiniMetric />
          <SkeletonMiniMetric />
        </div>
      </div>
    );
  }

  const score = scoreData.score;
  const riskLabel = scoreData.riskLevel;

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col items-center gap-4 h-full justify-center">
      <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600 }}>Today's eye score</h3>
      
      {/* Enhanced Score Display with Circular Progress */}
      <div className="flex flex-col items-center gap-4">
        <div style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          background: `conic-gradient(${score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'} 0deg ${score * 3.6}deg, #e5e7eb ${score * 3.6}deg 360deg)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.3s ease'
        }}>
          <div style={{
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ 
              fontSize: '28px', 
              fontWeight: 'bold', 
              color: score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444',
              lineHeight: 1
            }}>
              {score}
            </div>
            <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: '500' }}>Score</div>
          </div>
        </div>
        <span style={{ 
          fontSize: '12px', 
          padding: '6px 16px', 
          borderRadius: '20px', 
          fontWeight: 600, 
          background: score >= 75 ? '#dcfce7' : score >= 50 ? '#fef3c7' : '#fee2e2', 
          color: score >= 75 ? '#166534' : score >= 50 ? '#92400e' : '#991b1b',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          {riskLabel.charAt(0).toUpperCase() + riskLabel.slice(1)} Risk
        </span>
      </div>

      <div className="w-full grid grid-cols-2 gap-4 mt-4">
        <MiniMetric label="Screen" value={scoreData.breakdown.screenTimeScore} color="var(--amber-text)" />
        <MiniMetric label="Distance" value={scoreData.breakdown.distanceScore} color="var(--green-text)" />
        <MiniMetric label="Blinks" value={scoreData.breakdown.blinkScore} color="var(--red-text)" />
        <MiniMetric label="Lighting" value={scoreData.breakdown.lightingScore} color="var(--green-text)" />
      </div>
    </div>
  );
}

function SkeletonBox({ width, height }: { width: string; height: string }) {
  return (
    <div 
      className="animate-pulse rounded-lg"
      style={{ 
        width, 
        height, 
        background: '#e5e7eb',
        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }} 
    />
  );
}

function SkeletonMiniMetric() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <SkeletonBox width="40px" height="10px" />
        <SkeletonBox width="20px" height="10px" />
      </div>
      <SkeletonBox width="100%" height="4px" />
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string, value: number, color: string }) {
  const pct = (value / 25) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500 }}>
        <span>{label}</span>
        <span style={{ color: '#374151', fontWeight: 600 }}>{Math.round(value)}</span>
      </div>
      <div style={{ background: '#e5e7eb', height: '4px', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: "width 0.3s ease-out" }} />
      </div>
    </div>
  );
}
