// Pure dedup for events aggregated across multiple Workspace calendars.
//
// The same meeting is typically on every attendee's calendar, so when we
// impersonate several subjects (meetings@, Tate, Cedric) we get duplicate
// copies of the same event/instance. This collapses them, preferring the
// organizer's copy (cleanest extendedProperties + freshest RSVPs).
//
// Extracted from google-calendar.js so the dedup key logic is unit-testable
// without the googleapis/keyvault imports.

// Build the dedup key for one event. Must be:
//   - the SAME for the same instance seen on different subjects' calendars, and
//   - DIFFERENT for distinct instances of the same recurring series.
// Google gives every expanded instance of a recurring series the SAME iCalUID,
// so the series-level id alone collapses all instances into one. Append the
// instance start so each occurrence stays distinct while same-instance copies
// across calendars still dedupe (start time is identical across calendars).
function dedupeKey(ev) {
  const base = ev.iCalUID || ev.series_id || ev.event_id;
  if (!base) return null;
  // Append the instance start. Same instance across calendars shares both the
  // base id and the start time (→ dedupes); distinct occurrences of a recurring
  // series share the iCalUID but differ in start (→ stay separate).
  return `${base}::${ev.date || ""}`;
}

export function dedupeEventsAcrossSubjects(perSubjectResults, subjects) {
  const seenByKey = new Map();
  for (let i = 0; i < perSubjectResults.length; i++) {
    const events = perSubjectResults[i];
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      const key = dedupeKey(ev);
      if (!key) continue;
      const incomingIsOrganizer =
        ev.organizer_email &&
        subjects[i] &&
        ev.organizer_email.toLowerCase() === subjects[i].toLowerCase();
      const existing = seenByKey.get(key);
      // Replace only if this subject is the organizer's calendar — its copy is
      // canonical. Otherwise keep the first one seen.
      if (!existing || incomingIsOrganizer) {
        seenByKey.set(key, ev);
      }
    }
  }
  return Array.from(seenByKey.values()).sort((a, b) => {
    const ad = a.date ? new Date(a.date).getTime() : 0;
    const bd = b.date ? new Date(b.date).getTime() : 0;
    return ad - bd;
  });
}
