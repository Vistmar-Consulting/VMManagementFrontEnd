// src/lib/topicItems.js
//
// Which Task Board items an agenda topic card shows — one rule for the
// Working view's Mini Project Board, its KPI strip, the Meeting Focus and
// Attendees counts, and Agenda Chat.
//
// A topic shows every top-level item of its organization (the topic's own on
// the master agenda, else the agenda's) whose category is one of the topic's
// categories or which carries one of its tags, with that item's subtasks.
// topic.excludedItemIds lists items removed from the card by hand (row menu →
// Remove from topic): a removed task takes its subtasks off the card with it;
// a removed subtask leaves on its own. Removal holds until restored, whatever
// later happens to the item's category or tags.

export const topicOrgId = (topic, agendaOrgId) => topic?.organizationId || agendaOrgId || null;

const byOrder = (a, b) => (a.order || "").localeCompare(b.order || "");

// The items the topic's categories and tags reach, before removals.
function matchingParents(topic, items, orgId) {
  const cats = new Set(topic?.categoryIds || []);
  const tags = new Set(topic?.tagIds || []);
  if (!orgId || (cats.size === 0 && tags.size === 0)) return [];
  return (items || []).filter((it) => it.organizationId === orgId && !it.parentId
    && ((it.categoryId && cats.has(it.categoryId)) || (it.tagIds || []).some((t) => tags.has(t))));
}

// { parents, subitemsByParent } for the card, subtasks in board order.
export function topicTree(topic, items, agendaOrgId) {
  const orgId = topicOrgId(topic, agendaOrgId);
  const removed = new Set(topic?.excludedItemIds || []);
  const parents = matchingParents(topic, items, orgId).filter((it) => !removed.has(it.id));
  const ids = new Set(parents.map((p) => p.id));
  const subitemsByParent = {};
  for (const it of items || []) {
    if (!it.parentId || !ids.has(it.parentId) || removed.has(it.id)) continue;
    (subitemsByParent[it.parentId] ||= []).push(it);
  }
  for (const list of Object.values(subitemsByParent)) list.sort(byOrder);
  return { parents, subitemsByParent };
}

// The card's items as one list: each task, then its subtasks.
export function topicItems(topic, items, agendaOrgId) {
  const { parents, subitemsByParent } = topicTree(topic, items, agendaOrgId);
  return parents.flatMap((p) => [p, ...(subitemsByParent[p.id] || [])]);
}

// Every item any topic card shows, once each: the agenda-wide set the
// Meeting Focus and Attendees panels count.
export function agendaTree(topics, items, agendaOrgId) {
  const parents = new Map();
  const subs = new Map();
  for (const topic of topics || []) {
    const tree = topicTree(topic, items, agendaOrgId);
    for (const p of tree.parents) parents.set(p.id, p);
    for (const [pid, list] of Object.entries(tree.subitemsByParent)) {
      const m = subs.get(pid) || new Map();
      list.forEach((s) => m.set(s.id, s));
      subs.set(pid, m);
    }
  }
  const subitemsByParent = {};
  for (const [pid, m] of subs) subitemsByParent[pid] = [...m.values()].sort(byOrder);
  return { parents: [...parents.values()], subitemsByParent };
}

// Items removed from the card that its categories and tags would otherwise
// show (a removed subtask counts only while its task is on the card), for the
// card's "Removed" list. Ids of deleted items, or items that no longer match,
// are left out.
export function removedFromTopic(topic, items, agendaOrgId) {
  const removed = topic?.excludedItemIds || [];
  if (removed.length === 0) return [];
  const orgId = topicOrgId(topic, agendaOrgId);
  const removedSet = new Set(removed);
  const matched = matchingParents(topic, items, orgId);
  const shownParents = new Set(matched.filter((p) => !removedSet.has(p.id)).map((p) => p.id));
  const matchedIds = new Set(matched.map((p) => p.id));
  return (items || []).filter((it) => removedSet.has(it.id)
    && (it.parentId ? shownParents.has(it.parentId) : matchedIds.has(it.id)));
}
