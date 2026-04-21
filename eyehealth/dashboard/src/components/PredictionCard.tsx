import React, { useState } from 'react';
import type { PredictionResult } from '@extension/db/schema';

export function PredictionCard({ prediction }: { prediction: PredictionResult }) {
  const [horizon, setHorizon] = useState<string>("14d");

  const getRiskColor = (risk: string) => {
    if (risk === "low") return "var(--green-text)";
    if (risk === "moderate") return "var(--amber-text)";
    return "var(--red-text)";
  };

  const getRiskBadge = (risk: string) => {
    if (risk === "low") return "badge-green";
    if (risk === "moderate") return "badge-amber";
    return "badge-red";
  };

  if (!prediction) {
    return (
      <div className="glassmorphism p-6 flex flex-col items-center justify-center text-white/40 h-full">
        Predictive Engine Offline...
      </div>
    );
  }

  const confidencePct = Math.round(prediction.confidence * 100);

  return (
    <div className="glassmorphism p-6 flex flex-col h-full gap-6">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">
        {prediction.horizon} Risk Forecast
      </h3>

      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <div style={{ flexShrink: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Predicted risk</div>
          <span className={`badge ${getRiskBadge(prediction.predictedRiskLevel)}`} style={{ fontSize: '14px', padding: '5px 14px' }}>
            {prediction.predictedRiskLevel.charAt(0).toUpperCase() + prediction.predictedRiskLevel.slice(1)}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Confidence</div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '6px' }}>
            {confidencePct > 70 ? 'High certainty' : confidencePct > 40 ? 'Early estimate' : 'Developing'}
          </div>
          <div style={{ height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '3px', width: `${confidencePct}%`, background: confidencePct > 70 ? 'var(--green-text)' : 'var(--amber-text)' }}></div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="text-[13px] font-semibold mb-3 text-white/90">Key factors driving this prediction</div>
        <ul className="space-y-2 mb-6">
          {prediction.keyFactors.map((factor: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2 text-[12px] text-white/70 leading-snug">
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: idx === 2 ? 'var(--green-text)' : 'var(--amber-text)' }}></span>
              <span>{factor}</span>
            </li>
          ))}
        </ul>

        <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '3px' }}>Recommendation</div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {prediction.recommendation}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Prediction Horizon (Demo)</div>
        <div className="flex gap-2">
          {(["7d", "14d", "30d"] as const).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`text-[11px] px-3 py-1.5 rounded-full border transition font-medium ${
                horizon === h 
                ? 'bg-white text-black border-white' 
                : 'text-white/40 border-white/10 hover:border-white/20'
              }`}
            >
              {h.replace('d', ' days')}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t border-white/10 text-[9px] text-white/30 font-mono text-center italic">
        {prediction.disclaimer}
      </div>
    </div>
  );
}
