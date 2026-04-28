import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Label } from 'recharts';
import type { DailyEyeScore } from '@extension/db/schema';

export function TrendChart({ scores }: { scores: DailyEyeScore[] }) {
  // Format for Recharts
  const data = scores.map(s => ({
    date: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: s.score
  }));

  const isInsufficientData = data.length < 3;

  return (
    <div className="flex flex-col h-full relative">
      {isInsufficientData ? (
        <div className="h-full flex flex-col items-center justify-center text-white/40 text-sm px-8 text-center">
          <div className="mb-2">Keep using EyeGuard to build your trend</div>
          <div className="text-white/25 text-xs">Check back in {3 - data.length} day{3 - data.length !== 1 ? 's' : ''}</div>
        </div>
      ) : (
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 0, left: -10, bottom: 20 }}>
              <defs>
                <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" fontSize={11} tickMargin={10} axisLine={false} tickLine={false}>
                <Label value="Date" offset={-10} position="insideBottom" style={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              </XAxis>
              <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.2)" fontSize={11} axisLine={false} tickLine={false}>
                <Label value="Score" angle={-90} position="insideLeft" offset={10} style={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              </YAxis>
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
  );
}
