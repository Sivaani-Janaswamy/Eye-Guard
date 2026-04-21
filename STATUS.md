## 2026-04-20

**Bug:** Popup failed to save consent ("Could not save consent") due to Dexie DB not being open before consent operations in the service worker.

**Root cause:** db.open() was not called before consent reads/writes in the service worker, causing race conditions and failures when the SW was cold or reloaded.

**Fix:** Explicit db.open() is now called before all consent DB reads and writes (GRANT_CONSENT, CHECK_CONSENT, checkConsentAndAct), and immediately after the DB singleton is created. All consent flows now robustly open the DB before proceeding.
# STATUS.md

## Module Completion

| Module | Status | Agent | Completed At | Notes |
|---|---|---|---|---|
| A — DB + Service Worker | complete | Antigravity | 2026-04-18 | DB schema, db singleton, SW skeleton created |
| B — Content Script Overlay | complete | Antigravity | 2026-04-19 | overlay.ts created |
| C — Popup UI | complete | Antigravity | 2026-04-19 | popup.html and popup.tsx created with React setup and one-time consent flow gating |
| D — CV Pipeline | complete | Antigravity | 2026-04-18 | face-mesh.ts and blink-detector.ts created |
| E — Session Tracker + Score Engine | complete | Antigravity | 2026-04-18 | session-tracker.ts and score-engine.ts created |
| F — Alert Engine | complete | Antigravity | 2026-04-19 | alert-engine.ts created |
| G — Digital Correction | complete | Antigravity | 2026-04-19 | display-corrector.ts created |
| H — Prediction Engine | complete | Antigravity | 2026-04-19 | risk-predictor.ts created with UI label mapping |
| I — Dashboard | complete | Antigravity | 2026-04-19 | Dashboard.tsx and component cards populated securely
| J — Backend (optional) | complete | Antigravity | 2026-04-19 | FastAPI backend fully structured without raw media processing. All endpoints untested.
| K — CV Benchmarks | complete | Antigravity | 2026-04-19 | Synthetic benchmark runners and reports generated

## DECISIONS
- **Module A**: For `chrome.action.openPopup()`, added a fallback using `chrome.tabs.create()` for Chrome versions that prevent opening popups programmatically without a user gesture.
- **Module A**: Set `COMPUTE_DAILY_SCORE` alarm to trigger at exactly 00:01 daily.
- **Module D**: Used standard Luma formula to estimate ambientLuxLevel from video feed canvas.
- **Module D**: Estimated focal length as 600px and IPD as 6.3cm for screenDistanceCm calculation.
- **Module J**: Implemented the standalone FastAPI architecture completely. Adhered precisely to all algorithms. `AlertConfig` table was missing from the prompt's `models.py` schema generation instruction but was inferred correctly based on the `alerts/config` PUT constraints. None of the backend APIs have been computationally tested or integration tested via active frontend clients yet (Untested).
- **Module B**: Architecture fix — content script DB isolation implemented via message passing to background script for consent verification.
- **General**: Fixed consent race condition — DB write now completes before broadcast, toArray() replaces orderBy().last().
- **Module D**: CSP Fix — MediaPipe assets (JS/WASM) are now bundled locally within the extension (`dist/cv/`) to bypass website security policies.
- **General**: Full end-to-end monitoring pipeline integrated (`overlay.ts` -> `service-worker.ts` -> `SessionTracker`/`AlertEngine`). Real-time UI feedback via snackbars added.
- **General**: Resolved persistent MediaPipe 404s by implementing a global Network Interceptor in `overlay.ts` that hijacks and redirects relative asset fetches to the extension origin.

## Final Fix Summary — 2026-04-21
| Bug | Status | Fix Applied |
|---|---|---|
| Tab visibility pausing loop | Fixed | Changed to skip processing instead of full pause |
| Distance wrong (370cm) | Fixed | New formula: (IPD×600)/pixelDist + smoothing |
| Blink rate always 0 | Fixed | EAR threshold 0.21, fixed formula + debouncing |
| Dashboard shows no live data | Fixed | IndexedDB polling via useLiveQuery |
| Excessive DB writes | Fixed | Throttled live_stats to ~3 FPS |
| Recharts -1 width | Fixed | Fixed-height parent div added to TrendChart |
| Infinite re-render | Fixed | useLiveQuery [] deps + conditional state updates |
| Score stuck at 25 | Fixed | Frames now reach score engine and session tracker |

## Final Audit Results
- **Architecture**: Validated as robust (Main-World Bridge + IndexedDB Reactive UI).
- **Performance**: Optimized via write throttling and smoothing.
- **Privacy**: Confirmed (Landmarks never persisted to DB).
- **Build**: Dashboard and Extension builds both PASS.
