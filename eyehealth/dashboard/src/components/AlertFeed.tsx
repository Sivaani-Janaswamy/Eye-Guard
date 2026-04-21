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
    <div style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)' }} className="p-6 rounded-2xl flex flex-col h-full max-h-[400px]">
      <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
        Recent Alerts
      </h3>
      
      <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
        {alerts.length === 0 ? (
          <div className="text-white/40 text-sm text-center mt-10">
            No recent alerts. Keep up the good work!
          </div>
        ) : (
          alerts.map(alert => (
            <div key={alert.alertId} style={{ background: 'var(--bg-secondary)', border: '0.5px solid var(--border)' }} className="p-3 rounded-xl flex items-start justify-between gap-3 transition hover:opacity-80">
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: alert.severity === 'critical' ? 'var(--red-text)' : alert.severity === 'warning' ? 'var(--amber-text)' : 'var(--blue-text)' }}></span>
                  <span style={{ color: 'var(--text-tertiary)' }} className="text-[10px] uppercase font-bold tracking-tight">{new Date(alert.triggeredAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div style={{ color: 'var(--text-primary)' }} className="text-sm font-medium leading-snug">
                  {alert.message}
                </div>
              </div>
              {!alert.dismissed && (
                <button 
                  onClick={() => handleDismiss(alert.alertId)}
                  style={{ background: 'var(--bg-primary)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  className="shrink-0 text-[10px] px-2 py-1 rounded-md transition font-bold uppercase"
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
