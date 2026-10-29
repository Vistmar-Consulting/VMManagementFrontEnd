import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { tsToDate } from "../utils/firestoreTime.js";

const DONE = 5;
const ARCHIVE = 7;

// Status scorecards shared by the Task Board and the agenda's Meeting Focus.
// One status card per dropdown status, in dropdown order. Archive has no card:
// archived items are excluded from the counts.
export const SCORECARDS = [
  ...STATUS_OPTIONS.filter((s) => s.id !== ARCHIVE).map((s) => ({
    key: `status-${s.id}`,
    label: s.name,
    color: s.color,
    match: (i) => i.statusId === s.id,
  })),
  // Date cards — a separate group (divider before it) that overlaps the status
  // cards by design. They don't overlap each other: overdue items are only in
  // Overdue. Both compare against the start of today, because due dates are
  // stored at midnight — an item due today is not yet overdue.
  { key: "overdue",    label: "Overdue",      color: "#d32f2f", dateCard: true, match: (i) => hasOpenDueDate(i) && tsToDate(i.dueDate) < startOfToday() },
  { key: "dueThisWk",  label: "Due This Wk",  color: "#ef6c00", dateCard: true, match: (i) => hasOpenDueDate(i) && tsToDate(i.dueDate) >= startOfToday() && isDueThisWeek(tsToDate(i.dueDate)) },
];

export const SCORECARD_BY_KEY = Object.fromEntries(SCORECARDS.map((c) => [c.key, c]));

function hasOpenDueDate(i) {
  return Boolean(i.dueDate) && i.statusId !== DONE && i.statusId !== ARCHIVE;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// "Due This Wk" = dueDate falls within the CURRENT business week,
// Monday 00:00 → Friday 23:59:59 (local time). Weekend due dates and
// next-week dates are excluded.
function isDueThisWeek(date) {
  if (!date) return false;
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // Step back to Monday: Sunday → -6, Mon → 0, Tue → -1, …, Sat → -5.
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  const t = date.getTime();
  return t >= monday.getTime() && t <= friday.getTime();
}

// Scorecard counts are over tasks: a parent with subitems contributes its
// subitems, not itself. Archived items (and everything under an archived
// parent) are excluded. `matches` narrows the tasks further (e.g. an assignee).
export function countScorecards(parents, subitemsByParent, matches = () => true) {
  const tasks = scorecardTasks(parents, subitemsByParent).filter(matches);
  return Object.fromEntries(SCORECARDS.map((c) => [c.key, tasks.filter(c.match).length]));
}

// Per-assignee task counts over the same tasks the scorecards count, narrowed
// to the selected scorecard — so an assignee's count under a card equals that
// card's count with the assignee selected. Returns { uid: count }.
export function countTasksByAssignee(parents, subitemsByParent, scorecardKey = null) {
  const card = scorecardKey ? SCORECARD_BY_KEY[scorecardKey] : null;
  const counts = {};
  for (const task of scorecardTasks(parents, subitemsByParent)) {
    if (card && !card.match(task)) continue;
    for (const uid of new Set(task.assigneeIds || [])) counts[uid] = (counts[uid] || 0) + 1;
  }
  return counts;
}

function scorecardTasks(parents, subitemsByParent) {
  const tasks = [];
  for (const parent of parents) {
    if (parent.statusId === ARCHIVE) continue;
    const subs = subitemsByParent[parent.id];
    for (const task of subs?.length ? subs : [parent]) {
      if (task.statusId !== ARCHIVE) tasks.push(task);
    }
  }
  return tasks;
}
