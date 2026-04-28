import React from 'react';
import type { AlertEvent } from '@extension/db/schema';
import { db } from '@extension/db/db';

export function AlertFeed({ alerts }: { alerts: AlertEvent[] }) {
  
  const handleDismiss = async (alertId: string) => {
    try {
      const target = await db.alerts.get(alertId);
      if (target) {
        target.dismissed = true;
        target.actionTaken = "dismissed";
        await db.alerts.put(target);
      }
    } catch(e) {
      console.warn("Could not dismiss alert statically", e);
    }
  };

  return (
    <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' }} className="p-6 flex flex-col h-full max-h-[400px]">
      <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600, marginBottom: '16px' }}>
        Recent Alerts
      </h3>
      
      <div className="flex-1 overflow-y-auto pr-2 space-y-3">
        {alerts.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>
            No recent alerts. Keep up the good work!
          </div>
        ) : (
          alerts.map(alert => (
            <div key={alert.alertId} style={{ 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb', 
              borderLeft: `3px solid ${alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#f59e0b' : '#3b82f6'}`,
              borderRadius: '8px',
              padding: '12px'
            }} className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: alert.severity === 'critical' ? '#ef4444' : alert.severity === 'warning' ? '#f59e0b' : '#3b82f6' }}></span>
                  <span style={{ color: '#9ca3af', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>{new Date(alert.triggeredAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div style={{ color: '#374151', fontSize: '14px', fontWeight: 500, lineHeight: 1.4 }}>
                  {alert.message}
                </div>
              </div>
              {!alert.dismissed && (
                <button 
                  onClick={() => handleDismiss(alert.alertId)}
                  style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#6b7280', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', fontWeight: 500, textTransform: 'uppercase' }}
                  className="shrink-0 hover:bg-gray-200 transition"
                >
                  Dismiss
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
