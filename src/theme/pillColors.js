// Ported verbatim from _PM_Archive_From_Console_2026-05-12/src/pages/pages/pmPillColors.js
// getPillBg(hex)   → pastel background (lightens by 72% toward white)
// getTextColor(hex) → readable text on the pastel (darkens by 55%)
// Used everywhere a status / priority / category pill renders.

export function getPillBg(hexColor) {
  if (!hexColor) return "#eee";
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * 0.72);
  const lg = Math.round(g + (255 - g) * 0.72);
  const lb = Math.round(b + (255 - b) * 0.72);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

// hexToRgba(hex, a) → "rgba(r, g, b, a)" — for accent-tinted backgrounds and
// shadows (faint org-color fills on cards / calendar chips).
export function hexToRgba(hexColor, alpha = 1) {
  if (!hexColor) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// getContrastText(hex) → "#fff" or dark ink, whichever is readable ON a
// full-strength fill of `hex`. Use for filled pills/chips (solid accentColor
// background); getTextColor is for text on the *pastel* (getPillBg) instead.
export function getContrastText(hexColor) {
  if (!hexColor) return "#fff";
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#1a1a2e" : "#fff";
}

export function getTextColor(hexColor) {
  if (!hexColor) return "#333";
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const dr = Math.round(r * 0.45);
  const dg = Math.round(g * 0.45);
  const db = Math.round(b * 0.45);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}
