import { STATUS } from "../constants/itemStatuses.js";

export function groupKeyOf(statusId) {
  if (statusId === STATUS.DONE) return "completed";
  if (statusId === STATUS.ARCHIVE) return "archive";
  return "active";
}

// Splits top-level items and their subitems into the Active / Completed /
// Archive groups by each row's OWN status. A subitem whose group differs from
// its parent's is rendered under a read-only "ghost" copy of the parent in the
// subitem's group, so status changes move rows immediately.
export function buildBoardGroups(topLevelItems, subitemsByParent) {
  const groups = { active: [], completed: [], archive: [] };
  for (const item of topLevelItems) {
    const ownKey = groupKeyOf(item.statusId);
    const subsByKey = { active: [], completed: [], archive: [] };
    for (const sub of subitemsByParent[item.id] || []) {
      subsByKey[groupKeyOf(sub.statusId)].push(sub);
    }
    for (const key of Object.keys(groups)) {
      if (key === ownKey) {
        groups[key].push({ item, subitems: subsByKey[key], ghost: false });
      } else if (subsByKey[key].length > 0) {
        groups[key].push({ item, subitems: subsByKey[key], ghost: true });
      }
    }
  }
  return groups;
}
