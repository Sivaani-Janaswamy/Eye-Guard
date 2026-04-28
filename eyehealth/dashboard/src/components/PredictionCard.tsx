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
      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col items-center justify-center h-full">
        <div style={{ color: '#9ca3af', fontSize: '13px' }}>Predictive Engine Offline...</div>
      </div>
    );
  }

  // confidence is a string label from confidenceLabel() function
  const confidenceLabel = prediction.confidence as unknown as string;

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col h-full gap-6">
      <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600 }}>
        {prediction.horizon} Risk Forecast
      </h3>

      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        <div style={{ flexShrink: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', fontWeight: 500 }}>Predicted risk</div>
          <span style={{ fontSize: '14px', padding: '5px 14px', borderRadius: '9999px', fontWeight: 500, background: prediction.predictedRiskLevel === 'low' ? '#dcfce7' : prediction.predictedRiskLevel === 'moderate' ? '#fef3c7' : '#fee2e2', color: prediction.predictedRiskLevel === 'low' ? '#166534' : prediction.predictedRiskLevel === 'moderate' ? '#92400e' : '#991b1b' }}>
            {prediction.predictedRiskLevel.charAt(0).toUpperCase() + prediction.predictedRiskLevel.slice(1)}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px', fontWeight: 500 }}>Confidence</div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
            {confidenceLabel}
          </div>
          <div style={{ height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '2px', width: '100%', background: '#f59e0b' }}></div>
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div style={{ color: '#374151', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>Key factors driving this prediction</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
          {prediction.keyFactors.map((factor: string, idx: number) => (
            <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', lineHeight: 1.5, color: '#6b7280', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', marginTop: '6px', flexShrink: 0, background: idx === 2 ? '#22c55e' : '#f59e0b' }}></span>
              <span>{factor}</span>
            </li>
          ))}
        </ul>

        <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Recommendation</div>
          <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
            {prediction.recommendation}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div style={{ color: '#9ca3af', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Prediction Horizon (Demo-only)</div>
        <div className="flex gap-2">
          {(["7d", "14d", "30d"] as const).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', fontWeight: 500, transition: 'all 0.2s' }}
              className={horizon === h ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 hover:bg-gray-50'}
            >
              {h.replace('d', ' days')}
            </button>
          ))}
        </div>
      </div>

      <div style={{ color: '#9ca3af', fontSize: '10px', paddingTop: '16px', borderTop: '1px solid #e5e7eb', textAlign: 'center', fontStyle: 'italic' }}>
        {prediction.disclaimer}
      </div>
    </div>
  );
}
