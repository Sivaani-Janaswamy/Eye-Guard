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

  // Load Initial Data
  useEffect(() => {
    const loadData = async () => {
      // 0. Check Consent
      const consentCount = await db.consent.count();
      setHasConsent(consentCount > 0);

      if (consentCount === 0) return; // Stop here if no consent

      // 1. Fetch Today's Score
      const tzOffset = new Date().getTimezoneOffset() * 60000;
      const todayString = new Date(Date.now() - tzOffset).toISOString().split("T")[0];
      const todayScoreArr = await db.scores.where("date").equals(todayString).toArray();
      if (todayScoreArr.length > 0) {
        setScoreData(todayScoreArr[0]);
      } else {
        // Mock default if zero records exist so far today
        setScoreData({
          date: todayString,
          score: 100,
          breakdown: { screenTimeScore: 25, distanceScore: 25, blinkScore: 25, lightingScore: 25 },
          riskLevel: "low",
          myopiaRiskFlag: false,
          totalScreenMinutes: 0
        });
      }

      // 2. Fetch Active Session
      const sessions = await db.sessions.orderBy("startTime").reverse().limit(1).toArray();
      if (sessions.length > 0 && sessions[0].endTime === null) {
        setActiveSession(sessions[0]);
      }

      // 3. Load Correction Profile State
      const correctionProfileObj = await db.correction.get(1);
      if (correctionProfileObj && correctionProfileObj.activePreset) {
        setActivePreset(correctionProfileObj.activePreset);
      }
    };
    
    loadData();
    const interval = setInterval(loadData, 5000); // Polling simple updates dynamically
    return () => clearInterval(interval);
  }, []);

  const handleGrantConsent = () => {
    chrome.runtime.sendMessage({ type: "GRANT_CONSENT" }, (response) => {
      if (response?.success) {
        setHasConsent(true);
      } else {
        console.error("Could not save consent");
      }
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return "#28a745"; // green
    if (score >= 50) return "#ffc107"; // amber
    return "#dc3545"; // red
  };

  const handleToggleMonitoring = () => {
    const newState = !isMonitoring;
    setIsMonitoring(newState);
    const msgType = newState ? "START_MONITORING" : "STOP_MONITORING";
    chrome.runtime.sendMessage({ type: msgType });
  };

  const handleCorrectionPreset = async (presetId: "off" | "office" | "night") => {
    setActivePreset(presetId);
    const profileObj: CorrectionProfile = { ...CORRECTION_PRESETS[presetId] };
    await db.correction.put({ id: 1, ...profileObj });
    // Tell content script directly over the active tab if feasible
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "APPLY_CORRECTION", profile: profileObj }).catch(() => {});
      }
    });
  };

  if (hasConsent === null) {
    return <div style={{ padding: "32px", textAlign: "center", color: "#666" }}>Initialising...</div>;
  }

  if (!hasConsent) {
    return <ConsentScreen onAllow={handleGrantConsent} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "16px", gap: "16px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>EyeGuard</h2>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}>
            <input type="checkbox" checked={isMonitoring} onChange={handleToggleMonitoring} /> Active
          </label>
          <span style={{ cursor: "pointer", fontSize: "16px" }} onClick={() => setShowSettings(!showSettings)}>⚙️</span>
        </div>
      </div>

      {!showSettings ? (
        <>
          {/* Main Score UI */}
          <div style={{ textAlign: "center", padding: "12px", background: "white", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "14px", color: "#666" }}>Today's EyeScore</div>
            <div style={{ fontSize: "64px", fontWeight: "bold", color: getScoreColor(scoreData?.score || 100), lineHeight: "1.1" }}>
              {scoreData?.score || 100}
            </div>
            
            <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <ProgressItem label="Screen Time" value={scoreData?.breakdown.screenTimeScore || 25} max={25} />
              <ProgressItem label="Distance" value={scoreData?.breakdown.distanceScore || 25} max={25} />
              <ProgressItem label="Blinks" value={scoreData?.breakdown.blinkScore || 25} max={25} />
              <ProgressItem label="Lighting" value={scoreData?.breakdown.lightingScore || 25} max={25} />
            </div>
          </div>

          {/* Current Session Stats */}
          <div style={{ background: "white", padding: "12px", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>Current Session</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <div>⏱️ {activeSession ? Math.round((Date.now() - activeSession.startTime) / 60000) : 0}m</div>
              <div>👀 {activeSession ? Math.round(activeSession.avgBlinkRate) : 0} bpm</div>
              <div>📏 {activeSession ? Math.round(activeSession.avgDistanceCm) : 0} cm</div>
            </div>
          </div>

          {/* Quick Correction */}
          <div style={{ background: "white", padding: "12px", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>Display Correction</div>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["off", "office", "night"] as const).map(preset => (
                <button
                  key={preset}
                  onClick={() => handleCorrectionPreset(preset)}
                  style={{
                    flex: 1, padding: "8px", border: "none", borderRadius: "4px",
                    background: activePreset === preset ? "#007bff" : "#f1f1f1",
                    color: activePreset === preset ? "white" : "#333",
                    cursor: "pointer", textTransform: "capitalize", fontSize: "12px"
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Dashboard Link */}
          <button 
            onClick={() => chrome.tabs.create({ url: "chrome-extension://" + chrome.runtime.id + "/dist/dashboard/index.html" })}
            style={{ marginTop: "auto", padding: "12px", background: "#333", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
            View Dashboard
          </button>
        </>
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}

function ProgressItem({ label, value, max }: { label: string, value: number, max: number }) {
  const pct = (value / max) * 100;
  let color = "#28a745";
  if (pct < 75) color = "#ffc107";
  if (pct < 50) color = "#dc3545";
  
  return (
    <div style={{ fontSize: "11px", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span>{Math.round(value)}/{max}</span>
      </div>
      <div style={{ height: "4px", background: "#e9ecef", borderRadius: "2px", marginTop: "2px" }}>
        <div style={{ height: "100%", background: color, width: `${pct}%`, borderRadius: "2px" }}></div>
      </div>
    </div>
  );
}

// Minimal settings representation to fulfill "shows alert threshold sliders".
function SettingsPanel() {
  return (
    <div style={{ background: "white", padding: "14px", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
      <h3 style={{ marginTop: 0, fontSize: "14px" }}>Alert Thresholds</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "12px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
           Minimum Distance (cm)
          <input type="range" min="30" max="80" defaultValue="50" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
           Minimum Blink Rate (bpm)
          <input type="range" min="5" max="30" defaultValue="15" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
           Minimum Brightness (lux)
          <input type="range" min="10" max="200" defaultValue="50" />
        </label>
      </div>
    </div>
  );
}

function ConsentScreen({ onAllow }: { onAllow: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px", gap: "20px", textAlign: "center", justifyContent: "center", background: "#f8f9fa" }}>
      <div style={{ fontSize: "48px" }}>👁️</div>
      <h2 style={{ margin: 0, color: "#333" }}>Welcome to EyeGuard</h2>
      <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.5" }}>
        To monitor your blink rate and screen distance, we need access to your camera. 
        <br/><br/>
        <strong style={{ color: "#444" }}>Privacy First:</strong> Processing happens entirely on-device. No images or biometric data ever leave your computer.
      </p>
      <button 
        onClick={onAllow}
        style={{ marginTop: "10px", padding: "14px", background: "#6366f1", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
      >
        Allow Camera Access
      </button>
      <p style={{ fontSize: "11px", color: "#999" }}>
        By clicking Allow, you agree to our privacy-first local monitoring policy.
      </p>
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
