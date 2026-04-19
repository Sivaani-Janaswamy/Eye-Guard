import React from 'react';
import type { PredictionResult } from '@extension/db/schema';

export function PredictionCard({ prediction }: { prediction: PredictionResult }) {
  
  const getRiskGradient = (risk: string) => {
    if (risk === "low") return "from-green-500/20 to-transparent border-green-500/30 text-green-400";
    if (risk === "moderate") return "from-amber-500/20 to-transparent border-amber-500/30 text-amber-400";
    return "from-red-500/20 to-transparent border-red-500/30 text-red-500";
  };

  if (!prediction) {
    return (
      <div className="glassmorphism p-6 rounded-2xl flex flex-col items-center justify-center text-white/40 h-full">
        Predictive Engine Offline or Initializing...
      </div>
    );
  }

  const gradientClass = getRiskGradient(prediction.predictedRiskLevel);

  return (
    <div className={`glassmorphism p-6 rounded-2xl flex flex-col h-full bg-gradient-to-br ${gradientClass} border-t`}>
      <div className="flex justify-between items-start mb-6">
        <h3 className="text-white text-xs font-semibold uppercase tracking-wider">
          {prediction.horizon} Risk Forecast
        </h3>
        <span className="text-[10px] bg-white/10 px-2 py-1 rounded font-medium text-white/70">
          {prediction.confidence as unknown as string}
        </span>
      </div>

      <div className="flex-1">
        <div className="text-sm font-semibold mb-3 text-white/90">Key Factors:</div>
        <ul className="space-y-2 mb-6">
          {prediction.keyFactors.map((factor: string, idx: number) => (
            <li key={idx} className="text-xs text-white/70 flex items-start gap-2">
              <span className="text-indigo-400 mt-0.5">•</span>
              <span className="leading-snug">{factor}</span>
            </li>
          ))}
        </ul>

        <div className="bg-black/20 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
          <div className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-1">Recommendation</div>
          <div className="text-sm text-white/90 font-medium leading-relaxed">
            {prediction.recommendation}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-white/10 text-[9px] text-white/40 font-mono text-center leading-tight">
        {prediction.disclaimer}
      </div>
    </div>
  );
}
