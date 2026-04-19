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
    <div className="glassmorphism p-6 rounded-2xl flex flex-col h-full max-h-[400px]">
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
            <div key={alert.alertId} className="bg-white/5 border border-white/10 p-3 rounded-xl flex items-start justify-between gap-3 transition hover:bg-white/10">
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${alert.severity === 'critical' ? 'bg-red-500' : alert.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`}></span>
                  <span className="text-xs text-white/50">{new Date(alert.triggeredAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div className="text-sm font-medium leading-snug">
                  {alert.message}
                </div>
              </div>
              {!alert.dismissed && (
                <button 
                  onClick={() => handleDismiss(alert.alertId)}
                  className="shrink-0 text-xs px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition font-semibold"
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
