import { SCORECARD_BY_KEY } from "./scorecards.js";

// Mini Project Board filter for the agenda sidebar's Attendees and Meeting
// Focus selections — the Task Board's behavior for an Assigned column filter
// and a scorecard. An item matches when it passes both. A parent stays when it
// or any subitem matches; its subitems narrow to the matches; a parent kept
// only for a subitem is dimmed; every parent with a matching subitem opens.
// `assigneeIds`: null = no attendee filter; [] = an attendee with no account,
// who has no items. `keepIds` always match: items created under the filter
// stay in view.
export function filterMiniBoard(parents, subitemsByParent, { assigneeIds = null, scorecardKey = null, keepIds } = {}) {
  const card = scorecardKey ? SCORECARD_BY_KEY[scorecardKey] : null;
  if (!assigneeIds && !card) {
    return { parents, subitemsByParent, dimmedIds: new Set(), forceExpandedIds: new Set() };
  }
  const matchesAssignee = assigneeIds
    ? (item) => (item.assigneeIds || []).some((id) => assigneeIds.includes(id))
    : () => true;
  const matches = (item) =>
    keepIds?.has(item.id) || (matchesAssignee(item) && (!card || card.match(item)));
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
