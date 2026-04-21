import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { DailyEyeScore } from '@extension/db/schema';

export function TrendChart({ scores }: { scores: DailyEyeScore[] }) {
  // Format for Recharts
  const data = scores.map(s => ({
    date: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: s.score
  }));

  return (
    <div className="glassmorphism p-6 rounded-2xl flex flex-col h-full relative">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-6">
        30-Day Score Trend
      </h3>
      
      <div style={{ width: '100%', height: 220 }}>
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/40 text-sm">
            Insufficient data for chart
          </div>
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.2)" fontSize={11} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                itemStyle={{ color: '#fff', fontWeight: 'bold' }}
              />
              <ReferenceLine y={75} stroke="rgba(40, 167, 69, 0.3)" strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke="rgba(220, 53, 69, 0.3)" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={3} fillOpacity={1} fill="url(#scoreGradient)" />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
