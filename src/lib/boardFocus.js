// src/lib/boardFocus.js
//
// "Open in Task Board" (agenda mini boards): /board?item=<id> opens the Task
// Board with that item or subtask brought into view. Pure: planBoardFocus
// says what the board must change so the row is rendered; the board applies it.
import { groupKeyOf } from "./boardGroups.js";

export const BOARD_FOCUS_PARAM = "item";

export const boardItemPath = (itemId) => `/board?${BOARD_FOCUS_PARAM}=${encodeURIComponent(itemId)}`;

// null when the item no longer exists. Otherwise:
//   orgFilter  the org to switch to, or null to leave the org filter alone
//              ("All" already shows it)
//   groupKey   the group (active / completed / archive) its row is in
//   parentRow  for a subtask: the parent row to expand, { id, ghost }
// The item itself is kept in view through the board's own search / column /
// scorecard / view filters, the way a just-created item is.
export function planBoardFocus(items, itemId, orgFilter) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const parent = item.parentId ? items.find((i) => i.id === item.parentId) : null;
  const orgId = (parent || item).organizationId;
  const groupKey = groupKeyOf(item.statusId);
  return {
    orgFilter: orgFilter === "all" || orgFilter === orgId ? null : orgId,
    groupKey,
    // A subtask in another group than its parent sits under the parent's ghost copy.
    parentRow: parent ? { id: parent.id, ghost: groupKeyOf(parent.statusId) !== groupKey } : null,
  };
}
