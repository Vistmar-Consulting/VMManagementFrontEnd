// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/pmItems.js PM_PRIORITIES.
// Numeric IDs match Console's pm.Priorities SQL table for trivial future migration.

export const PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

export const PRIORITY_LIST = [
  { id: PRIORITY.CRITICAL, label: "Critical", color: "#f44336", sortOrder: 1 },
  { id: PRIORITY.HIGH,     label: "High",     color: "#ff9800", sortOrder: 2 },
  { id: PRIORITY.MEDIUM,   label: "Medium",   color: "#fdd835", sortOrder: 3 },
  { id: PRIORITY.LOW,      label: "Low",      color: "#4caf50", sortOrder: 4 },
];

export const PRIORITY_BY_ID = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p]));

export const PRIORITY_LABEL = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p.label]));
export const PRIORITY_COLOR = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p.color]));
