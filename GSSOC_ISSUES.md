# GSSoC Beginner-Friendly Issues for EyeGuard

## Issue 1: Improve Extension Popup Loading States

**Title:** `[GOOD FIRST ISSUE] Add loading skeleton to extension popup during data fetch`

**Problem Description:**
When users open the EyeGuard popup, there's a brief moment where the content appears empty while data is being fetched from IndexedDB. This creates a poor user experience as users see blank space before the metrics appear.

**Step-by-Step Tasks:**
1. Open `eyehealth/extension/popup/popup.tsx`
2. Add a loading state variable (e.g., `const [isLoading, setIsLoading] = useState(true)`)
3. Create a simple skeleton component that mimics the popup layout
4. Show skeleton while `isLoading` is true, hide when data loads
5. Set `isLoading` to false after data fetch completes

**Expected Outcome:**
- Users see a structured skeleton layout immediately when opening popup
- Smooth transition from skeleton to actual data
- No more blank/empty states during data loading

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `ui/ux`

---

## Issue 2: Add Keyboard Shortcuts Documentation

**Title:** `[GOOD FIRST ISSUE] Document keyboard shortcuts in popup interface`

**Problem Description:**
EyeGuard has keyboard shortcuts (like Ctrl+Shift+E to toggle monitoring), but users have no way to discover these shortcuts without reading the code. This reduces the power-user experience.

**Step-by-Step Tasks:**
1. Open `eyehealth/extension/popup/popup.tsx`
2. Add a "Keyboard Shortcuts" section in the settings area
3. Document existing shortcuts:
   - Ctrl+Shift+E: Toggle monitoring
   - Ctrl+Shift+D: Open dashboard
   - Ctrl+Shift+P: Pause/resume alerts
4. Add a small keyboard icon (⌨️) next to the section
5. Style it consistently with existing UI elements

**Expected Outcome:**
- Users can easily discover available keyboard shortcuts
- Improved accessibility and power-user experience
- Clean, professional documentation within the popup

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `documentation`

---

## Issue 3: Enhance Error Messages in Dashboard

**Title:** `[GOOD FIRST ISSUE] Make dashboard error messages more user-friendly`

**Problem Description:**
When the dashboard fails to connect to the EyeGuard engine, users see technical error messages like "Connection failed" or "No data available". These messages don't help users understand what to do next.

**Step-by-Step Tasks:**
1. Open `eyehealth/dashboard/src/pages/Dashboard.tsx`
2. Find the error handling section around line 121
3. Replace technical messages with helpful, actionable messages:
   - "EyeGuard extension not detected" → "Please install the EyeGuard extension and refresh this page"
   - "No data available" → "Start monitoring on any website to see your eye health data"
4. Add a "Troubleshoot" button that links to the FAQ section
5. Use consistent error styling with colors and icons

**Expected Outcome:**
- Users get clear, actionable error messages
- Reduced support requests and user frustration
- Professional error handling with helpful next steps

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `ui/ux`

---

## Issue 4: Add Tooltips to Dashboard Metrics

**Title:** `[GOOD FIRST ISSUE] Add helpful tooltips to dashboard metric cards`

**Problem Description:**
The dashboard shows metrics like "Blink Rate: 15/min" and "Distance: 55cm" but new users don't understand what these numbers mean or what the ideal ranges are.

**Step-by-Step Tasks:**
1. Open `eyehealth/dashboard/src/components/ScoreCard.tsx`
2. For each metric, add a tooltip icon (ℹ️) next to the label
3. Create tooltip content explaining:
   - **Blink Rate:** "Healthy range: 15-20 blinks per minute. Lower rates can cause eye strain."
   - **Distance:** "Optimal range: 50-70cm from screen. Too close increases eye strain."
   - **Lighting:** "Recommended: 200+ lux. Poor lighting causes eye fatigue."
   - **Screen Time:** "Healthy limit: 6 hours/day. Take breaks every 20 minutes."
4. Use CSS to position tooltips nicely (no external libraries needed)
5. Ensure tooltips work on both hover and focus for accessibility

**Expected Outcome:**
- Users understand what each metric means
- Clear guidance on healthy ranges
- Better onboarding experience for new users

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `ui/ux`

---

## Issue 5: Improve Extension Icon Visibility

**Title:** `[GOOD FIRST ISSUE] Create high-contrast extension icons for better visibility`

**Problem Description:**
The current EyeGuard extension icons may not be clearly visible in all browser themes, especially in dark mode or for users with visual impairments.

**Step-by-Step Tasks:**
1. Open `eyehealth/extension/icons/` directory
2. Review existing icons (icon16.png, icon48.png, icon128.png)
3. Create high-contrast versions with:
   - White background with dark eye symbol for dark themes
   - Dark background with white eye symbol for light themes
   - Ensure minimum 3:1 contrast ratio
4. Test icons in both Chrome light and dark themes
5. Update `manifest.json` if needed to reference new icons

**Expected Outcome:**
- Extension icon clearly visible in all browser themes
- Better accessibility for visually impaired users
- Professional appearance across different UI contexts

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `design`, `accessibility`

---

## Issue 6: Add Data Export Feature

**Title:** `[GOOD FIRST ISSUE] Add CSV export for eye health data in dashboard`

**Problem Description:**
Users may want to analyze their eye health data in external tools or share it with healthcare providers, but there's no way to export the data from the dashboard.

**Step-by-Step Tasks:**
1. Open `eyehealth/dashboard/src/pages/Dashboard.tsx`
2. Add an "Export Data" button in the header area
3. Create a function that:
   - Fetches all historical data from IndexedDB
   - Formats it as CSV with columns: Date, Score, BlinkRate, Distance, Lighting, ScreenTime
   - Creates a downloadable file using `Blob` and `URL.createObjectURL`
4. Add proper date formatting and file naming (e.g., `eyeguard-data-2024-04-29.csv`)
5. Style the button to match existing UI elements

**Expected Outcome:**
- Users can export their eye health data as CSV
- Data can be analyzed in Excel, Google Sheets, or other tools
- Professional data export functionality

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `feature`

---

## Issue 7: Refactor Magic Numbers in Scoring Algorithm

**Title:** `[GOOD FIRST ISSUE] Extract magic numbers into constants in score engine`

**Problem Description:**
The scoring algorithm in `eyehealth/extension/engine/score-engine.ts` contains hardcoded "magic numbers" like `25`, `4.17`, `30`, etc. These make the code hard to understand and maintain.

**Step-by-Step Tasks:**
1. Open `eyehealth/extension/engine/score-engine.ts`
2. Create a constants object at the top of the file:
   ```typescript
   const SCORING_CONSTANTS = {
     MAX_SCORE_PER_COMPONENT: 25,
     SCREEN_TIME_PENALTY_RATE: 4.17,
     MIN_DISTANCE_CM: 30,
     MAX_DISTANCE_CM: 60,
     MIN_BLINK_RATE: 5,
     TARGET_BLINK_RATE: 15,
     MIN_LUX: 20,
     TARGET_LUX: 200
   };
   ```
3. Replace all hardcoded numbers with references to these constants
4. Add JSDoc comments explaining what each constant represents
5. Ensure the scoring logic remains exactly the same

**Expected Outcome:**
- Code becomes more readable and maintainable
- Easy to adjust scoring parameters without hunting through code
- Better documentation of scoring algorithm logic

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `refactoring`

---

## Issue 8: Add Progress Indicators to Setup Process

**Title:** `[GOOD FIRST ISSUE] Add step-by-step progress indicator for first-time setup`

**Problem Description:**
New users installing EyeGuard don't know what steps are involved in the setup process, which can lead to confusion and abandoned installations.

**Step-by-Step Tasks:**
1. Open `eyehealth/extension/popup/popup.tsx`
2. Create a setup progress component that shows:
   - Step 1: Install extension ✅
   - Step 2: Allow camera access ⏳
   - Step 3: Start monitoring ⏳
   - Step 4: View dashboard ⏳
3. Track setup progress in IndexedDB or localStorage
4. Show progress bar with completion percentage
5. Hide the progress indicator after setup is complete

**Expected Outcome:**
- Clear guidance for new users during setup
- Reduced abandonment rate during first-time installation
- Professional onboarding experience

**Difficulty Level:** Easy
**Labels:** `good first issue`, `help wanted`, `ui/ux`, `onboarding`

---

## Instructions for Creating These Issues on GitHub

1. Go to your EyeGuard repository on GitHub
2. Click "Issues" → "New issue"
3. Select "Good First Issue" template
4. Copy and paste the content from each issue above
5. Add appropriate labels: `good first issue`, `help wanted`
6. Set assignee to yourself or leave unassigned
7. Submit the issue

**Project Link:** https://github.com/Sivaani-Janaswamy/Eye-Guard

These issues are designed to be completed in 2-4 hours each and provide excellent learning opportunities for first-time contributors while adding real value to the EyeGuard project.
