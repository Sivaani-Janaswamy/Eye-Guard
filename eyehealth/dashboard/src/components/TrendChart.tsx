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
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="flex flex-col h-full relative">
      {isInsufficientData ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px', padding: '32px', textAlign: 'center' }}>
          <div style={{ marginBottom: '8px' }}>Keep using EyeGuard to build your trend</div>
          <div style={{ color: '#d1d5db', fontSize: '12px' }}>Check back in {3 - data.length} day{3 - data.length !== 1 ? 's' : ''}</div>
        </div>
      ) : (
        <div style={{ height: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 0, left: -10, bottom: 20 }}>
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} tickMargin={10} axisLine={false} tickLine={false}>
                <Label value="Date" offset={-10} position="insideBottom" style={{ fill: '#9ca3af', fontSize: 10 }} />
              </XAxis>
              <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={11} axisLine={false} tickLine={false}>
                <Label value="Score" angle={-90} position="insideLeft" offset={10} style={{ fill: '#9ca3af', fontSize: 10 }} />
              </YAxis>
              <Tooltip 
                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                itemStyle={{ color: '#374151', fontWeight: 600 }}
              />
              <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.3} />
              <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
              <Area type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} fillOpacity={0} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
