// V1 status lifecycle per spec §2:
//   Assigned → In Progress → Review → Done → Archive
// Status IDs ported verbatim from pm.Statuses in the legacy SQL schema so
// migration is a direct numeric copy. On Hold (3), Pending (6), and AI Gen
// (8) exist in SQL but are intentionally NOT part of V1's board lifecycle:
//   - On Hold → represented as a separate `onHold: boolean` flag on the item.
//   - Pending / AI Gen → dropped from V1 surface.

export const STATUS = {
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  REVIEW: 4,
  DONE: 5,
  ARCHIVE: 7,
};

export const BOARD_COLUMNS = [
  { id: STATUS.ASSIGNED, label: "Assigned", color: "#7b61ff" },
  { id: STATUS.IN_PROGRESS, label: "In Progress", color: "#2196f3" },
  { id: STATUS.REVIEW, label: "Review", color: "#9c6ade" },
  { id: STATUS.DONE, label: "Done", color: "#4caf50" },
];

export const STATUS_LABEL = {
  [STATUS.ASSIGNED]: "Assigned",
  [STATUS.IN_PROGRESS]: "In Progress",
  [STATUS.REVIEW]: "Review",
  [STATUS.DONE]: "Done",
  [STATUS.ARCHIVE]: "Archive",
};
