// V1 status lifecycle per spec §2:
//   Assigned → In Progress → Blocked → Review → Done → Archive
// Status IDs 1-8 are ported verbatim from pm.Statuses in the legacy SQL schema
// so migration is a direct numeric copy. Blocked (9) has NO row in pm.Statuses —
// it was introduced by the Horizon Bridge (BRIDGE-TICKETS-DESIGN-2026-09-18) and
// lives only in Firestore. If pm.Statuses is ever migrated forward, add 9 there
// to keep the numbering aligned.
//
// Not part of the board lifecycle:
//   - On Hold (3) → represented as a separate `onHold: boolean` flag on the item.
//   - Pending (6) → legacy intake state for AI-created items (Sort_Order 0 in
//     SQL, so it sorted ahead of Assigned). Superseded by AI Gen (8). Kept in
//     STATUS_OPTIONS only so historical items still carrying it can be read and
//     moved off it.

export const STATUS = {
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  BLOCKED: 9,
  REVIEW: 4,
  DONE: 5,
  ARCHIVE: 7,
};

export const BOARD_COLUMNS = [
  { id: STATUS.ASSIGNED, label: "Assigned", color: "#7b61ff" },
  { id: STATUS.IN_PROGRESS, label: "In Progress", color: "#2196f3" },
  { id: STATUS.BLOCKED, label: "Blocked", color: "#e65100" },
  { id: STATUS.REVIEW, label: "Review", color: "#9c6ade" },
  { id: STATUS.DONE, label: "Done", color: "#4caf50" },
];

export const STATUS_LABEL = {
  [STATUS.ASSIGNED]: "Assigned",
  [STATUS.IN_PROGRESS]: "In Progress",
  [STATUS.BLOCKED]: "Blocked",
  [STATUS.REVIEW]: "Review",
  [STATUS.DONE]: "Done",
  [STATUS.ARCHIVE]: "Archive",
};

// Full dropdown order for the status pill on the board + row. Includes the
// statuses that aren't board columns (AI Gen, Pending, Archive) so users can
// move items in and out of those parking lots without leaving the row.
// AI Gen sits first because it's the triage starting point — items suggested
// by Fireflies / agenda automations land here for a human to confirm.
export const STATUS_OPTIONS = [
  { id: 8, name: "AI Gen",      color: "#00bcd4" },
  { id: 1, name: "Assigned",    color: "#7b61ff" },
  { id: 2, name: "In Progress", color: "#2196f3" },
  { id: 6, name: "Pending",     color: "#f5a623" },
  { id: 9, name: "Blocked",     color: "#e65100" },
  { id: 4, name: "Review",      color: "#9c6ade" },
  { id: 5, name: "Done",        color: "#4caf50" },
  { id: 7, name: "Archive",     color: "#9e9e9e" },
];

// Column-sort rank: position in the dropdown, so sorting by Status follows the
// lifecycle rather than raw ids (AI Gen is 8 and Blocked is 9, yet they sort
// before Assigned and after Pending respectively).
export const STATUS_SORT_RANK = Object.fromEntries(STATUS_OPTIONS.map((s, i) => [s.id, i]));
