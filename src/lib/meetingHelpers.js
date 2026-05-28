// Ported from _PM_Archive_From_Console_2026-05-12/src/pages/pages/meetingHelpers.js
// Adapted to the snake_case field names used by /api/meetings/list
// (event_id, series_id, title, date, end_date, type, teams_url, attendees,
// m365EventId, org_id) rather than Console's normalized PascalCase mirror.

// Group recurring-meeting INSTANCES into series by title. Same-title meetings
// always belong to the same series (e.g., "Ops Sync" on Wed + Fri = one card
// surfaced as "2x/Week"). Returns array of:
//   { title, seriesKey, series_id, instances, attendees, nextDate,
//     nextEndDate, instanceCount }
export function groupRecurringMeetings(meetings) {
  const now = new Date();
  const recurring = meetings.filter((m) => m.type === "recurring");

  const groups = {};
  for (const m of recurring) {
    const key = m.title || "(untitled)";
    if (!groups[key]) {
      groups[key] = {
        title: m.title,
        seriesKey: key,
        series_id: m.series_id || null,
        instances: [],
        attendees: m.attendees || [],
      };
    }
    groups[key].instances.push(m);
  }

  return Object.values(groups)
    .map((g) => {
      g.instances.sort((a, b) => new Date(a.date) - new Date(b.date));
      const next = g.instances.find((i) => new Date(i.date) >= now) || g.instances[g.instances.length - 1];
      return {
        ...g,
        nextDate: next?.date || null,
        nextEndDate: next?.end_date || null,
        instanceCount: g.instances.length,
      };
    })
    .sort((a, b) => {
      if (!a.nextDate && !b.nextDate) return 0;
      if (!a.nextDate) return 1;
      if (!b.nextDate) return -1;
      return new Date(a.nextDate) - new Date(b.nextDate);
    });
}

// Heuristic cadence label based on instance density over the query window.
// Defaults assume a ~2-month window (matches V2.1 list query: now + 90 days
// which is ~3 months — adjust monthsInRange if the window changes).
export function detectCadence(instanceCount, monthsInRange = 3) {
  const perMonth = instanceCount / monthsInRange;
  if (perMonth >= 7) return "2x/Week";
  if (perMonth >= 3.5) return "Weekly";
  if (perMonth >= 1.5) return "Biweekly";
  if (perMonth >= 0.8) return "Monthly";
  return "";
}
