import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { db } from "../db/db";
import { DailyEyeScore, SessionRecord, CorrectionProfile } from "../db/schema";
import { CORRECTION_PRESETS } from "../correction/display-corrector";

function Popup() {
  const [scoreData, setScoreData] = useState<DailyEyeScore | null>(null);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [activePreset, setActivePreset] = useState("off");
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  
  // Real-time Live Stats
  const [liveStats, setLiveStats] = useState({
    distanceCm: 0, blinkRate: 0, lux: 0, faceDetected: false, durationMs: 0,
    alerts: [] as any[]
  });

  useEffect(() => {
    const loadData = async () => {
      const consentCount = await db.consent.count();
      setHasConsent(consentCount > 0);
      if (consentCount === 0) return;

      const tzOffset = new Date().getTimezoneOffset() * 60000;
      const todayString = new Date(Date.now() - tzOffset).toISOString().split("T")[0];
      const todayScoreArr = await db.scores.where("date").equals(todayString).toArray();
      
      // Initial Load
      if (todayScoreArr.length > 0) {
        setScoreData(todayScoreArr[0]);
      } else {
        setScoreData(null);
      }

      const sessions = await db.sessions.orderBy("startTime").reverse().limit(1).toArray();
      if (sessions.length > 0 && sessions[0].endTime === null) {
        setActiveSession(sessions[0]);
      }

      const correctionProfileObj = await db.correction.get(1);
      if (correctionProfileObj?.activePreset) {
        setActivePreset(correctionProfileObj.activePreset);
      }

      const settings = await chrome.storage.local.get(["theme", "isMonitoring"]);
      if (settings.theme && (settings.theme === "light" || settings.theme === "dark")) setTheme(settings.theme);
      if (typeof settings.isMonitoring === "boolean") setIsMonitoring(settings.isMonitoring);
      
      // Pre-load last live stats to avoid flicker
      const lastLive = await db.live_stats.get(1);
      if (lastLive) {
        setLiveStats(prev => ({
          ...prev,
          distanceCm: lastLive.distanceCm,
          blinkRate: lastLive.blinkRate,
          lux: lastLive.lux,
          faceDetected: lastLive.faceDetected
        }));
      }
    };
    loadData();
  }, []);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatHours = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h ${m}m`;
  };

  const getLuxLabel = (lux: number) => {
    if (lux < 50) return "Very Dim";
    if (lux < 150) return "Dim";
    if (lux < 300) return "Good";
    return "Bright";
  };

  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'LIVE_STATS_UPDATE') {
        const live = message.payload;
        setLiveStats({
          distanceCm: live.distanceCm,
          blinkRate: live.blinkRate,
          lux: live.lux,
          faceDetected: live.faceDetected,
          durationMs: live.durationMs || 0,
          alerts: live.alerts || []
        });
      }
      if (message.type === 'SCORE_UPDATE') {
        setScoreData(message.payload.scoreData);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleGrantConsent = () => {
    chrome.runtime.sendMessage({ type: "GRANT_CONSENT" }, (response) => {
      if (response?.success) setHasConsent(true);
    });
  };

  const toggleMon = () => {
    const newVal = !isMonitoring;
    setIsMonitoring(newVal);
    chrome.storage.local.set({ isMonitoring: newVal });
    chrome.runtime.sendMessage({ type: newVal ? "START_MONITORING" : "STOP_MONITORING" });
  };

  const setPreset = async (presetId: "off" | "office" | "night") => {
    setActivePreset(presetId);
    const profileObj: CorrectionProfile = { ...CORRECTION_PRESETS[presetId] };
    await db.correction.put({ id: 1, ...profileObj });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "APPLY_CORRECTION", profile: profileObj }).catch(() => {});
      }
    });
  };

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    chrome.storage.local.set({ theme: newTheme });
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "THEME_CHANGED", theme: newTheme }).catch(() => {});
      });
    });
  };

  if (hasConsent === null) return null;
  if (!hasConsent) return <ConsentScreen onAllow={handleGrantConsent} />;

  // Readiness Signal: use totalDurationMs directly from unrounded engine data
  const totalDurationMs = scoreData?.totalDurationMs || 0;
  const hasData = scoreData !== null && totalDurationMs > 5000;
  const score = scoreData?.score || 0;
  
  const riskClass = score >= 75 ? "score-green" : score >= 50 ? "score-amber" : "score-red";
  const badgeClass = score >= 75 ? "badge-green" : score >= 50 ? "badge-amber" : "badge-red";
  const riskLabel = score >= 75 ? "Low risk" : score >= 50 ? "Moderate risk" : "High risk";

  const bd = scoreData?.breakdown || { screenTimeScore: 0, distanceScore: 0, blinkScore: 0, lightingScore: 0 };

  return (
    <div className={`ext-popup ${theme === "dark" ? "dark-mode" : ""}`}>
      <div className="ext-header">
        <div className="ext-header-row">
          <div className="ext-title">EyeGuard</div>
          <div className="header-controls">
            <div className="theme-toggle" onClick={toggleTheme} title="Toggle Theme">
              {theme === "dark" ? "☀️" : "🌙"}
            </div>
            <div className="settings-toggle" onClick={() => setShowSettings(!showSettings)} title="Settings">⚙️</div>
            <div className={`mon-status ${isMonitoring ? "mon-on" : "mon-off"}`}>
              {isMonitoring ? "Monitoring on" : "Monitoring off"}
            </div>
            <div className={`toggle ${isMonitoring ? "on" : ""}`} onClick={toggleMon} title="Toggle Monitoring">
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>

        {!showSettings && (
          <div className="score-section">
            <div className="score-label">Today's eye score</div>
            {hasData ? (
              <>
                <div className={`big-score ${riskClass}`}>{score}</div>
                <div className="badge-container">
                  <span className={`badge ${badgeClass}`}>{riskLabel}</span>
                </div>
              </>
            ) : (
              <div className="no-data-msg">
                {!isMonitoring ? "Start monitoring to see your score." : 
                  totalDurationMs < 5000 ? "Collecting data..." : "Collecting reliable data..."}
              </div>
            )}
            {hasData && totalDurationMs < 120000 && (
              <div className="confidence-hint" style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Averages stabilizing...
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ext-body">
        {showSettings ? (
          <SettingsPanel onBack={() => setShowSettings(false)} />
        ) : (
          <>
            <div className="section-title">Today's Averages</div>
            <div className={!hasData ? "breakdown-disabled" : ""}>
              <ProgressItem 
                label="Avg. Screen time (today)" 
                score={bd.screenTimeScore} 
                rawValue={formatHours(scoreData?.totalScreenMinutes || 0)}
                ideal="Ideal: < 6h/day"
                color="var(--amber-text)" 
              />
              <ProgressItem 
                label="Avg. Distance (today)" 
                score={bd.distanceScore} 
                rawValue={`${Math.round(scoreData?.avgDistanceCm || 0)} cm`}
                ideal="Ideal: 50–70 cm"
                color="var(--green-text)" 
              />
              <ProgressItem 
                label="Avg. Blink rate (today)" 
                score={bd.blinkScore} 
                rawValue={`${(scoreData?.avgBlinkRate || 0).toFixed(1)}/min`}
                ideal="Ideal: 15–20 blinks/min"
                color="var(--red-text)" 
              />
              <ProgressItem 
                label="Avg. Lighting (today)" 
                score={bd.lightingScore} 
                rawValue={`${Math.round(scoreData?.avgLux || 0)} lux (${getLuxLabel(scoreData?.avgLux || 0)})`}
                ideal="Ideal: 200–500 lux"
                color="var(--green-text)" 
              />
            </div>

            <div className="section-title" style={{ marginTop: '20px', marginBottom: '8px' }}>Current Tracking (Live)</div>
            <div className="live-stats">
              <div className="stat-item">
                <span className="stat-icon">⏱️</span>
                <span className="stat-val">{formatTime(liveStats.durationMs)}</span>
              </div>
              
              <div className="stat-item">
                <span className="stat-icon">👀</span>
                <span className="stat-val">
                  {!isMonitoring ? "--" : !liveStats.faceDetected ? "Searching..." : `${Math.round(liveStats.blinkRate)}/min`}
                </span>
              </div>

              <div className="stat-item">
                <span className="stat-icon">📏</span>
                <span className="stat-val">
                  {!isMonitoring ? "--" : !liveStats.faceDetected ? "No face" : `${liveStats.distanceCm}cm`}
                </span>
              </div>

              <div className="stat-item">
                <span className="stat-icon">💡</span>
                <span className="stat-val">
                  {!isMonitoring ? "--" : `${liveStats.lux} lux`}
                </span>
              </div>
            </div>

            {!liveStats.faceDetected && isMonitoring && (
              <div className="face-warning">
                ⚠️ Move into camera view for accurate tracking
              </div>
            )}

            <div className="divider" style={{ margin: '16px 0', height: '1px', background: 'var(--border)' }}></div>
            <div className="section-title">Digital correction</div>
            <div className="preset-row">
              {(["off", "office", "night"] as const).map(p => (
                <div key={p} className={`preset-btn ${activePreset === p ? "on" : ""}`} onClick={() => setPreset(p)}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </div>
              ))}
            </div>
            <button className="view-btn" onClick={() => chrome.tabs.create({ url: "/dist/dashboard/index.html" })}>
              View full dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProgressItem({ label, score, rawValue, ideal, color }: { 
  label: string, score: number, rawValue: string, ideal: string, color: string 
}) {
  return (
    <div className="bar-row-complex">
      <div className="bar-header">
        <span className="bar-label">{label}</span>
        <span className="bar-raw-val">{rawValue}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${(score / 25) * 100}%`, background: color }}></div>
      </div>
      <div className="bar-footer">
        <span className="bar-ideal">{ideal}</span>
        <span className="bar-score-pts">Score: {Math.round(score)} / 25</span>
      </div>
    </div>
  );
}

function SettingsPanel({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="section-title" style={{ margin: 0 }}>Alert Thresholds</div>
        <button className="badge badge-blue" style={{ border: "none", cursor: "pointer" }} onClick={onBack}>Back</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "12px" }}>
        <div className="slider-row" style={{ margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Min Distance (cm)</span>
            <span style={{ fontWeight: 600 }}>50cm</span>
          </div>
          <input type="range" min="30" max="80" defaultValue="50" style={{ width: "100%" }} />
        </div>
        <div className="slider-row" style={{ margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Min Blink Rate (blinks/min)</span>
            <span style={{ fontWeight: 600 }}>15/min</span>
          </div>
          <input type="range" min="5" max="30" defaultValue="15" style={{ width: "100%" }} />
        </div>
        <div className="slider-row" style={{ margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span>Min Lighting (lux)</span>
            <span style={{ fontWeight: 600 }}>50 lux</span>
          </div>
          <input type="range" min="10" max="200" defaultValue="50" style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

function ConsentScreen({ onAllow }: { onAllow: () => void }) {
  return (
    <div className="ext-popup" style={{ border: "none" }}>
      <div className="ext-body" style={{ textAlign: "center", padding: "24px 20px" }}>
        <div className="onboard-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="#185FA5" stroke-width="1.5"/>
            <ellipse cx="12" cy="8" rx="2" ry="4" stroke="#185FA5" stroke-width="1"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#185FA5" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div className="onboard-title">EyeGuard needs camera access</div>
        <div className="onboard-sub">Used only to measure your blink rate and screen distance. No video is ever recorded or sent anywhere — all processing happens on your device.</div>
        
        <div className="privacy-card">
          <div className="privacy-title">What stays on your device</div>
          <div className="privacy-lines">
            Raw camera frames — never stored<br/>
            Face landmarks — used briefly, then discarded<br/>
            Blink rate, distance — stored locally only<br/>
            Daily eye score — yours alone
          </div>
        </div>

        <div className="onboard-btns">
          <button className="btn-secondary" onClick={() => window.close()}>Not now</button>
          <button className="btn-primary" onClick={onAllow}>Allow camera access</button>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
