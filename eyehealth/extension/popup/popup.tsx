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
    distanceCm: 0, blinkRate: 0, faceDetected: false
  });

  useEffect(() => {
    const loadData = async () => {
      const consentCount = await db.consent.count();
      setHasConsent(consentCount > 0);
      if (consentCount === 0) return;

      const tzOffset = new Date().getTimezoneOffset() * 60000;
      const todayString = new Date(Date.now() - tzOffset).toISOString().split("T")[0];
      const todayScoreArr = await db.scores.where("date").equals(todayString).toArray();
      if (todayScoreArr.length > 0) {
        setScoreData(todayScoreArr[0]);
      } else {
        setScoreData({
          date: todayString, score: 100,
          breakdown: { screenTimeScore: 25, distanceScore: 25, blinkScore: 25, lightingScore: 25 },
          riskLevel: "low", myopiaRiskFlag: false, totalScreenMinutes: 0
        });
      }

      const sessions = await db.sessions.orderBy("startTime").reverse().limit(1).toArray();
      if (sessions.length > 0 && sessions[0].endTime === null) {
        setActiveSession(sessions[0]);
      }

      const correctionProfileObj = await db.correction.get(1);
      if (correctionProfileObj?.activePreset) {
        setActivePreset(correctionProfileObj.activePreset);
      }

      const settings = await chrome.storage.local.get("theme");
      if (settings.theme) setTheme(settings.theme);
    };
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const live = await (db as any).live_stats.get(1);
        if (live && Date.now() - live.updatedAt < 8000) {
          setLiveStats({
            distanceCm: live.distanceCm,
            blinkRate:  live.blinkRate,
            faceDetected: live.faceDetected
          });
        } else {
          setLiveStats({ distanceCm: 0, blinkRate: 0, faceDetected: false });
        }
      } catch (e) {}
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  const handleGrantConsent = () => {
    chrome.runtime.sendMessage({ type: "GRANT_CONSENT" }, (response) => {
      if (response?.success) setHasConsent(true);
    });
  };

  const toggleMon = () => {
    const newVal = !isMonitoring;
    setIsMonitoring(newVal);
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

  const score = scoreData?.score || 100;
  const riskClass = score >= 75 ? "score-green" : score >= 50 ? "score-amber" : "score-red";
  const badgeClass = score >= 75 ? "badge-green" : score >= 50 ? "badge-amber" : "badge-red";
  const riskLabel = score >= 75 ? "Low risk" : score >= 50 ? "Moderate risk" : "High risk";

  return (
    <div className="ext-popup">
      <div className="ext-header">
        <div className="ext-header-row">
          <div className="ext-title">EyeGuard</div>
          <div className="header-controls">
            <span className="theme-toggle" onClick={toggleTheme}>
              {theme === "dark" ? "☀️" : "🌙"}
            </span>
            <span className="settings-toggle" onClick={() => setShowSettings(!showSettings)}>⚙️</span>
            <span className={`mon-status ${isMonitoring ? "mon-on" : "mon-off"}`}>
              {isMonitoring ? "Monitoring on" : "Monitoring off"}
            </span>
            <div className={`toggle ${isMonitoring ? "on" : ""}`} onClick={toggleMon}>
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>

        {!showSettings && (
          <div className="score-section">
            <div className="score-label">Today's eye score</div>
            <div className={`big-score ${riskClass}`}>{score}</div>
            <div className="badge-container">
              <span className={`badge ${badgeClass}`}>{riskLabel}</span>
            </div>
          </div>
        )}
      </div>

      <div className="ext-body">
        {showSettings ? (
          <SettingsPanel onBack={() => setShowSettings(false)} />
        ) : (
          <>
            <div className="section-title">Score breakdown</div>
            <ProgressItem label="Screen time" value={scoreData?.breakdown.screenTimeScore || 0} color="var(--amber-text)" />
            <ProgressItem label="Distance" value={scoreData?.breakdown.distanceScore || 0} color="var(--green-text)" />
            <ProgressItem label="Blink rate" value={scoreData?.breakdown.blinkScore || 0} color="var(--red-text)" />
            <ProgressItem label="Lighting" value={scoreData?.breakdown.lightingScore || 0} color="var(--green-text)" />

            <div className="live-stats">
              <span>⏱️ {activeSession ? Math.round((Date.now() - activeSession.startTime) / 60000) : 0}m</span>
              <span>👀 {liveStats.blinkRate} bpm</span>
              <span>📏 {liveStats.distanceCm}cm</span>
            </div>

            <div className="divider"></div>
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

function ProgressItem({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${(value / 25) * 100}%`, background: color }}></div>
      </div>
      <span className="bar-pts">{Math.round(value)}</span>
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
            <span>Min Blink Rate (bpm)</span>
            <span style={{ fontWeight: 600 }}>15bpm</span>
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
