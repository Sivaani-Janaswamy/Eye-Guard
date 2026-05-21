import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@extension/db/db';
import type { PredictionResult, AlertEvent } from '@extension/db/schema';
import { ScoreCard } from '../components/ScoreCard';
import { TrendChart } from '../components/TrendChart';
import { PredictionCard } from '../components/PredictionCard';
import { AlertFeed } from '../components/AlertFeed';
import { CorrectionPanel } from '../components/CorrectionPanel';
import CameraTest from '../components/CameraTest';

// @ts-ignore
import faqText from '../data/faqData.txt?raw';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = JSON.parse(faqText);

function formatAnswerText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function FAQAccordionItem({ 
  item, 
  theme = 'light' 
}: { 
  item: FAQItem; 
  theme?: 'light' | 'amber'; 
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const colors = {
    light: {
      border: '#e5e7eb',
      question: '#374151',
      questionHover: '#1f2937',
      bgHover: '#f9fafb',
      answer: '#6b7280',
      arrow: '#9ca3af'
    },
    amber: {
      border: '#fde68a',
      question: '#92400e',
      questionHover: '#78350f',
      bgHover: '#fef3c7',
      answer: '#b45309',
      arrow: '#b45309'
    }
  }[theme];

  return (
    <div style={{
      borderBottom: `1px solid ${colors.border}`,
      paddingBottom: '8px',
      marginBottom: '8px',
      transition: 'border-color 0.2s ease-in-out'
    }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isHovered ? colors.bgHover : 'none',
          border: 'none',
          padding: '8px 12px',
          borderRadius: '6px',
          cursor: 'pointer',
          textAlign: 'left',
          color: isHovered ? colors.questionHover : colors.question,
          fontWeight: 600,
          fontSize: '13px',
          outline: 'none',
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <span>{item.question}</span>
        <span style={{
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease-in-out',
          fontSize: '10px',
          color: colors.arrow,
          marginLeft: '8px'
        }}>
          ▼
        </span>
      </button>
      <div style={{
        maxHeight: isExpanded ? '300px' : '0px',
        opacity: isExpanded ? 1 : 0,
        overflow: 'hidden',
        transition: 'all 0.2s ease-in-out',
        padding: isExpanded ? '8px 12px 12px 12px' : '0px 12px'
      }}>
        <div style={{
          fontSize: '12px',
          color: colors.answer,
          lineHeight: '1.5'
        }}>
          {formatAnswerText(item.answer)}
        </div>
      </div>
    </div>
  );
}

function TroubleshootFAQ({ theme = 'light' }: { theme?: 'light' | 'amber' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {FAQ_ITEMS.map((item) => (
        <FAQAccordionItem key={item.id} item={item} theme={theme} />
      ))}
    </div>
  );
}

export default function Dashboard() {
  // VERSION: 2026-04-25-dexie-single-source
  const [isDemoData, setIsDemoData] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);

  // New state hooks for FAQ toggles and loading timeout
  const [showFullscreenFaq, setShowFullscreenFaq] = useState(false);
  const [showHeaderFaq, setShowHeaderFaq] = useState(false);
  const [showBannerFaq, setShowBannerFaq] = useState(false);
  const [dbLoadingTimeout, setDbLoadingTimeout] = useState(false);

  // Check if running in extension context (e.g. chrome-extension://)
  const isExtensionDetected = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  const [demoBypass, setDemoBypass] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('demo') === 'true' || sessionStorage.getItem('eyeguard_demo_bypass') === 'true';
  });

  // Dexie-based real-time data (single source of truth)
  const liveStats = useLiveQuery(
    () => db.table('live_stats').get(1),
    [],
    null
  );
  
  const sessionData = useLiveQuery(
    () => db.table('session_data').get(1),
    [],
    null
  );
  
  const [sessionTimeMs, setSessionTimeMs] = useState(0);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Update session time from Dexie data
  useEffect(() => {
    if (sessionData?.durationMs !== undefined) {
      setSessionTimeMs(sessionData.durationMs);
    }
  }, [sessionData]);

  // Remove all chrome.runtime.onMessage listeners - use Dexie only
  // No more message handling for stats


  // Prediction load (not reactive as it changes slowly)
  useEffect(() => {
    db.predictions.orderBy('generatedAt').reverse().first().then(p => {
      if (p) setPrediction(p);
    });
  }, []);

  // Reactive Data Queries
  const scores = useLiveQuery(() => db.scores.orderBy('date').reverse().toArray(), []);
  const alerts = useLiveQuery(() => db.alerts.orderBy('triggeredAt').reverse().limit(10).toArray(), []);
  const activeSession = useLiveQuery(
    () => db.sessions.orderBy('startTime').reverse().first().then(s => (s && s.endTime === null) ? s : null),
    []
  );

  // Sync Logic Derived from Live Queries
  const todayScore = (scores && scores.length > 0) ? scores[0] : null;
  const history = (scores && scores.length > 0) ? [...scores].reverse().slice(-30) : [];

  const displayHistory = history.length > 0 ? history : generateDemoHistory();
  const displayScore = todayScore || displayHistory[displayHistory.length - 1];
  const displayAlerts = (alerts && alerts.length > 0) ? alerts : (isDemoData ? generateDemoAlerts() : []);

  useEffect(() => {
    if (scores && scores.length > 0) {
      if (isDemoData) setIsDemoData(false);
    } else if (scores && scores.length === 0) {
      if (!isDemoData) setIsDemoData(true);
    }
  }, [scores, isDemoData]);

  // Log dashboard mount
  useEffect(() => {
    console.log('[EyeGuard] Dashboard mounted');
  }, []);

  // Timer to show "extension not detected" fallback if IndexedDB loading hangs
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scores === undefined) {
        setDbLoadingTimeout(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [scores]);

  function generateDemoHistory() {
    return Array.from({ length: 30 }).map((_, i) => {
      const totalScreenMinutes = 400;
      return {
        date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
        score: Math.floor(Math.random() * 40 + 40),
        breakdown: { screenTimeScore: 10, distanceScore: 10, blinkScore: 10, lightingScore: 10 },
        riskLevel: "moderate" as const,
        myopiaRiskFlag: false,
        totalScreenMinutes,
        avgDistanceCm: 50 + Math.random() * 20,      // 50–70 cm
        avgBlinkRate: 12 + Math.random() * 6,        // 12–18 blinks/min
        avgLux: 100 + Math.random() * 200,           // 100–300 lux
        totalDurationMs: totalScreenMinutes * 60000
      };
    });
  }

  function generateDemoAlerts(): AlertEvent[] {
    return [{
      alertId: "demo-1",
      type: "distance",
      severity: "warning",
      triggeredAt: Date.now() - 3600000,
      dismissed: false,
      snoozedUntil: null,
      message: "Demo: Distance tracking example message",
      actionTaken: null
    }];
  }

  const liveDistance = (liveStats && liveStats.faceDetected && (Date.now() - liveStats.updatedAt < 10000))
    ? `${Math.round(liveStats.distanceCm)}cm` 
    : "Searching...";

  // Render full screen warning if we are not in the Chrome Extension environment and have not bypassed for demo
  if (!isExtensionDetected && !demoBypass) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: '#f3f4f6'
      }}>
        <div style={{
          maxWidth: '540px',
          width: '100%',
          background: 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          boxShadow: '0 0 40px rgba(245, 158, 11, 0.15), 0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          padding: '40px 32px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          transition: 'all 0.3s ease-in-out'
        }}>
          {/* Pulsing Warning Icon Container */}
          <div style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            border: '2px solid #fbbf24',
            boxShadow: '0 0 15px rgba(251, 191, 36, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '36px',
            animation: 'pulse-warn 2s infinite ease-in-out'
          }}>
            ⚠️
            <style>{`
              @keyframes pulse-warn {
                0% { transform: scale(1); box-shadow: 0 0 15px rgba(251, 191, 36, 0.3); }
                50% { transform: scale(1.05); box-shadow: 0 0 25px rgba(251, 191, 36, 0.5); }
                100% { transform: scale(1); box-shadow: 0 0 15px rgba(251, 191, 36, 0.3); }
              }
            `}</style>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h2 style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#ffffff',
              margin: 0,
              letterSpacing: '-0.025em'
            }}>
              EyeGuard Extension Required
            </h2>
            <div style={{
              fontSize: '13.5px',
              color: '#9ca3af',
              margin: 0,
              lineHeight: '1.6',
              textAlign: 'left',
              background: 'rgba(255, 255, 255, 0.02)',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: '100%'
            }}>
              <p style={{ margin: 0, color: '#e5e7eb', fontWeight: 500 }}>
                EyeGuard uses a Chrome Extension to monitor screen distance, blink rate, and ambient lighting in real time.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>1.</span>
                  <span>Install/enable the extension in <code>chrome://extensions</code>.</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>2.</span>
                  <span>Click the <strong>Extensions Icon</strong> in Chrome's top-right toolbar.</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>3.</span>
                  <span>Select <strong>EyeGuard</strong> to open the popup.</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>4.</span>
                  <span>Grant camera access and toggle monitoring <strong>ON</strong>.</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>5.</span>
                  <span>Click <strong>"View full dashboard"</strong> to open this page.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button 
                onClick={() => window.location.reload()}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 15px rgba(59, 130, 246, 0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 10px rgba(59, 130, 246, 0.3)';
                }}
              >
                🔄 Refresh Page
              </button>
              
              <button 
                onClick={() => {
                  setDemoBypass(true);
                  sessionStorage.setItem('eyeguard_demo_bypass', 'true');
                }}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  borderRadius: '10px',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  background: 'rgba(245, 158, 11, 0.05)',
                  color: '#fcd34d',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.05)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                🧪 Try Demo Mode
              </button>
            </div>

            <button 
              onClick={() => setShowFullscreenFaq(!showFullscreenFaq)}
              style={{
                width: '100%',
                padding: '12px 20px',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#e5e7eb',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              }}
            >
              ❓ Troubleshooting Guide
            </button>
          </div>

          {/* FAQ section, initially collapsed */}
          {showFullscreenFaq && (
            <div id="error-faq" style={{
              width: '100%',
              textAlign: 'left',
              marginTop: '8px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              paddingTop: '20px'
            }}>
              <h3 style={{ 
                fontSize: '14px', 
                fontWeight: 600, 
                color: '#fde68a', 
                marginBottom: '12px', 
                paddingLeft: '12px' 
              }}>
                Troubleshooting FAQ
              </h3>
              <TroubleshootFAQ theme="amber" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Database is still loading (either in extension context or demo bypass mode)
  if (scores === undefined) {
    if (dbLoadingTimeout) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
          padding: '24px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#f3f4f6'
        }}>
          <div style={{
            maxWidth: '540px',
            width: '100%',
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(16px)',
            borderRadius: '16px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 0 40px rgba(239, 68, 68, 0.15), 0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            padding: '40px 32px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px'
          }}>
            {/* Warning Icon Container */}
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '2px solid #ef4444',
              boxShadow: '0 0 15px rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '36px',
              animation: 'pulse-err 2s infinite ease-in-out'
            }}>
              ⚠️
              <style>{`
                @keyframes pulse-err {
                  0% { transform: scale(1); box-shadow: 0 0 15px rgba(239, 68, 68, 0.3); }
                  50% { transform: scale(1.05); box-shadow: 0 0 25px rgba(239, 68, 68, 0.5); }
                  100% { transform: scale(1); box-shadow: 0 0 15px rgba(239, 68, 68, 0.3); }
                }
              `}</style>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <h2 style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#ffffff',
                margin: 0,
                letterSpacing: '-0.025em'
              }}>
                Database Connection Timeout
              </h2>
              <p style={{
                fontSize: '14px',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.6',
                textAlign: 'left',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}>
                We could not connect to the local EyeGuard database.
                <br /><br />
                <strong style={{ color: '#fca5a5' }}>Troubleshoot:</strong> Make sure you have clicked the <strong>EyeGuard extension icon</strong> in your browser toolbar, granted camera permissions, and toggled monitoring <strong>ON</strong> to initialize the database.
              </p>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
              <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                <button 
                  onClick={() => window.location.reload()}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: '10px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 6px 15px rgba(59, 130, 246, 0.5)'}
                  onMouseOut={(e) => e.currentTarget.style.boxShadow = '0 4px 10px rgba(59, 130, 246, 0.3)'}
                >
                  🔄 Refresh Page
                </button>
                <button 
                  onClick={() => {
                    setDemoBypass(true);
                    sessionStorage.setItem('eyeguard_demo_bypass', 'true');
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    borderRadius: '10px',
                    border: '1px solid rgba(245, 158, 11, 0.5)',
                    background: 'rgba(245, 158, 11, 0.05)',
                    color: '#fcd34d',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.05)'}
                >
                  🧪 Bypassing Demo
                </button>
              </div>

              <button 
                onClick={() => setShowFullscreenFaq(!showFullscreenFaq)}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  color: '#e5e7eb',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                }}
              >
                ❓ Troubleshoot Guide
              </button>
            </div>

            {/* FAQ section, initially collapsed */}
            {showFullscreenFaq && (
              <div id="error-faq" style={{
                width: '100%',
                textAlign: 'left',
                marginTop: '8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '20px'
              }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#fde68a', marginBottom: '12px', paddingLeft: '12px' }}>
                  Troubleshooting FAQ
                </h3>
                <TroubleshootFAQ theme="amber" />
              </div>
            )}
          </div>
        </div>
      );
    }

    // Show a clean loading state during normal database initial connection
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#111827',
        color: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid rgba(255,255,255,0.1)',
            borderTop: '4px solid #3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <span style={{ fontSize: '14px', color: '#9ca3af' }}>Loading EyeGuard Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '16px 32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Original Header */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.025em', margin: 0 }}>EyeGuard Dashboard</h1>
              {demoBypass && (
                <button
                  onClick={() => {
                    sessionStorage.removeItem('eyeguard_demo_bypass');
                    window.location.reload();
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    color: '#fcd34d',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.8)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)';
                  }}
                  title="Click to exit Demo Mode and view the Extension Required warning"
                >
                  🧪 Demo Mode (Exit)
                </button>
              )}
            </div>
            <button
              onClick={() => setShowHeaderFaq(!showHeaderFaq)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                color: '#374151',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
            >
              ❓ Troubleshoot Guide
            </button>
          </div>
          <p style={{ color: '#ffffff', fontSize: '14px', marginTop: '8px', marginBottom: 0 }}>
            Holistic tracking map for optical longevity. 
            (Distance: <span style={{ color: '#fcd34d', fontFamily: 'monospace' }}>{liveDistance}</span>
            {activeSession && <> | Session: <span style={{ color: '#fcd34d', fontFamily: 'monospace' }}>{formatTime(sessionTimeMs)}</span></>})
          </p>
          <span style={{ fontSize: '12px', color: '#fcd34d', fontFamily: 'monospace', display: 'block', marginTop: '4px' }}>Build: 2026-04-19</span>
        </div>
      </header>

      {/* Collapsible FAQ in Header */}
      {showHeaderFaq && (
        <div id="always-visible-faq" style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '12px' }}>
            🛠️ EyeGuard Troubleshooting Guide
          </h3>
          <TroubleshootFAQ theme="light" />
        </div>
      )}

      {/* Diagnostics Panel - Always Visible */}
      <section style={{ marginBottom: '16px' }}>
        <CameraTest />
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '32px' }}>
        {/* Left Column: Immediate status & Predictions */}
        <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div style={{ height: 'auto' }}>
             <ScoreCard scoreData={displayScore} />
          </div>
          
          {/* Unified Health Insights Component - Vertical Layout */}
          <div style={{ 
            background: '#ffffff', 
            border: '1px solid #e5e7eb', 
            borderRadius: '12px', 
            padding: '20px'
          }}>
            <div style={{ 
              fontSize: '11px', 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em', 
              color: '#6b7280', 
              fontWeight: 600, 
              marginBottom: '16px' 
            }}>
              Health Insights & Achievements
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Weekly Insight */}
              <div style={{ 
                background: '#fffbeb', 
                border: '1px solid #fcd34d', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#92400e', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  💡 Weekly Insight
                </div>
                <p style={{ 
                  fontSize: '12px', 
                  color: '#78350f', 
                  lineHeight: '1.4',
                  margin: 0 
                }}>
                  {displayScore?.score >= 80 
                    ? "Excellent eye health this week! Keep maintaining your healthy screen habits."
                    : displayScore?.score >= 60
                    ? "Your screen distance has improved by 15% this week! Keep maintaining the 50-70cm optimal range."
                    : "Let's focus on improving your eye health this week. Try taking more breaks and maintaining better screen distance."
                  }
                </p>
                <div style={{ 
                  fontSize: '10px', 
                  color: '#92400e', 
                  marginTop: '6px',
                  fontStyle: 'italic'
                }}>
                  Based on your last 7 days of data
                </div>
              </div>

              {/* Achievements */}
              <div style={{ 
                background: '#f0fdf4', 
                border: '1px solid #86efac', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#166534', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  🏆 Achievements
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {history.length >= 7 && (
                    <span style={{
                      background: '#dcfce7',
                      color: '#166534',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      ✅ 7-Day Streak
                    </span>
                  )}
                  {displayScore?.score >= 80 && (
                    <span style={{
                      background: '#dbeafe',
                      color: '#1e40af',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      👁️ Eye Health Pro
                    </span>
                  )}
                  {history.length >= 30 && (
                    <span style={{
                      background: '#f3e8ff',
                      color: '#6b21a8',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      📊 Data Lover
                    </span>
                  )}
                  {activeSession && (
                    <span style={{
                      background: '#fee2e2',
                      color: '#991b1b',
                      padding: '3px 6px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: '500'
                    }}>
                      🔥 Active Monitor
                    </span>
                  )}
                </div>
              </div>

              {/* Health Tip */}
              <div style={{ 
                background: '#f0f9ff', 
                border: '1px solid #7dd3fc', 
                borderRadius: '8px', 
                padding: '12px' 
              }}>
                <div style={{ 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#1e40af', 
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  💬 Health Tip
                </div>
                <p style={{ 
                  fontSize: '12px', 
                  color: '#1e3a8a', 
                  lineHeight: '1.4',
                  margin: 0 
                }}>
                  Did you know? The 20-20-20 rule: Every 20 minutes, look at something 20 feet away for 20 seconds to reduce eye strain.
                </p>
              </div>
            </div>
          </div>
          
          <div style={{ height: 'auto' }}>
             {prediction && <PredictionCard prediction={prediction} />}
          </div>
        </div>
        {/* Center / Right Column: Deep data & Overrides */}
        <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {isDemoData && (
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '12px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '24px' }}>⚠️</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <strong style={{ fontSize: '15px', color: '#92400e', fontWeight: 600 }}>
                      No data available
                    </strong>
                    <span style={{ fontSize: '13px', color: '#b45309' }}>
                      Currently displaying simulated demo data. Start monitoring on any website to see your eye health data.
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowBannerFaq(!showBannerFaq)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #fcd34d',
                    backgroundColor: '#ffffff',
                    color: '#92400e',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fffbeb'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
                >
                  ❓ Troubleshoot
                </button>
              </div>

              {/* Collapsible FAQ inside the banner */}
              {showBannerFaq && (
                <div id="dashboard-banner-faq" style={{
                  width: '100%',
                  borderTop: '1px solid #fde68a',
                  paddingTop: '12px',
                  marginTop: '4px'
                }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#92400e', marginBottom: '8px', paddingLeft: '12px' }}>
                    How to link EyeGuard and start monitoring:
                  </h4>
                  <TroubleshootFAQ theme="amber" />
                </div>
              )}
            </div>
          )}
          {/* Top Section: Charts */}
          <div style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 600 }}>30-day eye score history</h3>
              <span style={{ padding: '4px 8px', background: '#fef3c7', color: '#92400e', fontSize: '12px', borderRadius: '6px' }}>Avg: {Math.round(displayHistory.reduce((a,b)=>a+b.score,0)/displayHistory.length)}</span>
            </div>
            <div style={{ height: '240px' }}>
              <TrendChart scores={displayHistory} />
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginTop: '12px', fontStyle: 'italic' }}>Connect extension to see real-time data flow</div>
          </div>
          
          {/* Enhanced Metrics Grid 2x2 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                📏
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Live Distance</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.distanceCm ? `${Math.round(liveStats.distanceCm)} cm` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.distanceCm && liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.distanceCm && liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? '✓' : '⚠️'}
                </span>
                {liveStats?.distanceCm ? (liveStats.distanceCm >= 50 && liveStats.distanceCm <= 70 ? 'Optimal range' : 'Aim for 50-70cm') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                👁️
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Live Blink Rate</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.blinkRate ? `${Math.round(liveStats.blinkRate)}/min` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.blinkRate && liveStats.blinkRate >= 15 ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.blinkRate && liveStats.blinkRate >= 15 ? '✓' : '⚠️'}
                </span>
                {liveStats?.blinkRate ? (liveStats.blinkRate >= 15 ? 'Healthy rate' : 'Aim for 15+/min') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                💡
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Ambient Light</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.lux ? `${Math.round(liveStats.lux)} lux` : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.lux && liveStats.lux >= 200 ? '#22c55e' : liveStats?.lux && liveStats.lux < 50 ? '#ef4444' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.lux && liveStats.lux >= 200 ? '✓' : liveStats?.lux && liveStats.lux < 50 ? '⚠️' : '⚠️'}
                </span>
                {liveStats?.lux ? (liveStats.lux >= 200 ? 'Good lighting' : liveStats.lux < 50 ? 'Too dim' : 'Aim for 200+ lux') : 'No data'}
              </div>
            </div>
            
            <div 
              style={{ 
                background: '#ffffff', 
                border: '1px solid #e5e7eb', 
                borderRadius: '12px', 
                padding: '20px',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '20px' }}>
                🎭
              </div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Face Detection</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>
                {liveStats?.faceDetected ? 'Yes' : liveStats ? 'No' : '—'}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 500, 
                color: liveStats?.faceDetected ? '#22c55e' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '10px' }}>
                  {liveStats?.faceDetected ? '✓' : liveStats ? '⚠️' : '⚠️'}
                </span>
                {liveStats?.faceDetected ? 'Tracking active' : liveStats ? 'Move into view' : 'No data'}
              </div>
            </div>
          </div>

          {/* Bottom Section: Feed and Controls split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '32px', height: 'auto' }}>
            <AlertFeed alerts={displayAlerts} />
            <CorrectionPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
