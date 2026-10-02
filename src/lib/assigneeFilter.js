import { buildItemMatcher } from "./boardFilters.js";

// Mini Project Board attendee filter — the Task Board's Assigned column
// behavior for one person. A parent stays when it or any subitem is assigned
// to them; its subitems narrow to theirs; a parent kept only for a subitem is
// dimmed; every parent with a matching subitem opens.
export function filterByAssignee(parents, subitemsByParent, assigneeId) {
  if (!assigneeId) {
    return { parents, subitemsByParent, dimmedIds: new Set(), forceExpandedIds: new Set() };
  }
  const matches = buildItemMatcher({ columnFilters: { assigneeIds: [assigneeId] } });
  const visibleSubs = {};
  const dimmedIds = new Set();
  const forceExpandedIds = new Set();
  const kept = [];
  for (const parent of parents) {
    const subs = (subitemsByParent[parent.id] || []).filter(matches);
    const selfMatch = matches(parent);
    if (!selfMatch && subs.length === 0) continue;
    kept.push(parent);
    visibleSubs[parent.id] = subs;
    if (!selfMatch) dimmedIds.add(parent.id);
    if (subs.length > 0) forceExpandedIds.add(parent.id);
  }
  return { parents: kept, subitemsByParent: visibleSubs, dimmedIds, forceExpandedIds };
}
