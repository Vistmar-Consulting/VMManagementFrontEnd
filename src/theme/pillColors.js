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
