import type { CorrectionProfile } from "../db/schema";

export const CORRECTION_PRESETS: Record<string, CorrectionProfile> = {
  off:    { contrastBoost: 0,   sharpnessLevel: 0,   fontScaleFactor: 1.0, blueLightFilter: 0,   autoAdjust: false, activePreset: "off" },
  office: { contrastBoost: 0.3, sharpnessLevel: 0.2, fontScaleFactor: 1.1, blueLightFilter: 0.2, autoAdjust: false, activePreset: "office" },
  night:  { contrastBoost: 0.2, sharpnessLevel: 0.1, fontScaleFactor: 1.2, blueLightFilter: 0.8, autoAdjust: false, activePreset: "night" },
};

/**
 * Builds the CSS filter string based on contrast and blue light settings.
 */
function buildFilterString(profile: CorrectionProfile): string {
  const contrast  = 1 + profile.contrastBoost * 0.4;        // 1.0–1.4
  const brightness = 1 - profile.blueLightFilter * 0.15;    // 0.85–1.0
  const saturate  = 1 - profile.blueLightFilter * 0.3;      // 0.7–1.0

  return `contrast(${contrast}) brightness(${brightness}) saturate(${saturate})`;
}

/**
 * Injects or updates an SVG feConvolveMatrix filter to apply sharpening.
 * @param level A float between 0.0 to 1.0
 */
export function applySharpness(level: number): void {
  let svg = document.getElementById("eyeguard-svg-filter");
  if (!svg) {
    svg = document.createElement("div");
    svg.id = "eyeguard-svg-filter";
    // Make sure SVG takes no layout space
    svg.style.height = "0";
    svg.style.width = "0";
    svg.style.position = "absolute";
    svg.style.pointerEvents = "none";
    document.body.appendChild(svg);
  }

  // Identity matrix: 0 0 0, 0 1 0, 0 0 0
  // Sharpen matrix: 0 -1 0, -1 9 -1, 0 -1 0
  // We linearly interpolate between them based on 'level'
  const centerValue = 1 + (8 * level);
  const edgeValue = -1 * level;

  const matrixValues = `
    0 ${edgeValue} 0 
    ${edgeValue} ${centerValue} ${edgeValue} 
    0 ${edgeValue} 0
  `;

  svg.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <filter id="eyeguard-sharpen">
        <feConvolveMatrix order="3 3" preserveAlpha="true" kernelMatrix="${matrixValues}" />
      </filter>
    </svg>
  `;
}

/**
 * Applies a font-scaling target exclusively to rem-based websites via document element scaling.
 * @param factor Float modifier typically 1.0 - 2.0
 */
export function applyFontScale(factor: number): void {
  document.documentElement.style.fontSize = `${factor * 16}px`;
}

/**
 * Main orchestrator: Sets all corrections onto the web page payload iteratively.
 * @param profile The current correction profile targeting the active tab via content script
 */
export function applyCorrection(profile: CorrectionProfile): void {
  // Always regenerate or update the SVG matrix
  applySharpness(profile.sharpnessLevel);

  // Set sizing
  applyFontScale(profile.fontScaleFactor);

  // Combine CSS primitive filters with our injected SVG URL
  const cssFilter = buildFilterString(profile);
  const sharpnessFilter = profile.sharpnessLevel > 0 ? " url(#eyeguard-sharpen)" : "";
  
  document.documentElement.style.filter = `${cssFilter}${sharpnessFilter}`;
}

/**
 * Disables and completely un-binds DOM manipulation from EyeGuard.
 */
export function removeCorrection(): void {
  // Clear style overrides
  document.documentElement.style.filter = "";
  document.documentElement.style.fontSize = "";

  // Remove the SVG DOM element entirely
  const svg = document.getElementById("eyeguard-svg-filter");
  if (svg && svg.parentNode) {
    svg.parentNode.removeChild(svg);
  }
}
