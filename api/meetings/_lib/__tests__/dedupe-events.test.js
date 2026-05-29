import { describe, it, expect } from "vitest";
import { dedupeEventsAcrossSubjects } from "../dedupe-events.js";

const ORGANIZER = "meetings@vistamarconsulting.com";
const OTHER = "ctucksherman@vistamarconsulting.com";

// A weekly series expands to multiple instances that ALL share one iCalUID
// (Google's behavior with singleEvents:true). The same instances appear on
// every attendee's calendar.
function weeklyInstances(subject) {
  return [
    { event_id: "vm_20260530", series_id: "vm", iCalUID: "uid-vm", title: "VM - Weekly Business Dev", date: "2026-05-30T18:30:00Z", organizer_email: ORGANIZER, source_calendar: subject },
    { event_id: "vm_20260606", series_id: "vm", iCalUID: "uid-vm", title: "VM - Weekly Business Dev", date: "2026-06-06T18:30:00Z", organizer_email: ORGANIZER, source_calendar: subject },
    { event_id: "vm_20260613", series_id: "vm", iCalUID: "uid-vm", title: "VM - Weekly Business Dev", date: "2026-06-13T18:30:00Z", organizer_email: ORGANIZER, source_calendar: subject },
  ];
}

describe("dedupeEventsAcrossSubjects", () => {
  it("keeps every recurring instance (they share one iCalUID) while deduping the same instance across subjects", () => {
    const subjects = [ORGANIZER, OTHER];
    const perSubject = [weeklyInstances(ORGANIZER), weeklyInstances(OTHER)];
    const out = dedupeEventsAcrossSubjects(perSubject, subjects);
    // All 3 distinct weekly instances must survive (the bug collapsed them to 1),
    // deduped across the 2 subjects' identical copies, sorted ascending by date.
    expect(out.map((e) => e.date)).toEqual([
      "2026-05-30T18:30:00Z",
      "2026-06-06T18:30:00Z",
      "2026-06-13T18:30:00Z",
    ]);
  });

  it("collapses a single event that appears on multiple calendars into one", () => {
    const subjects = [ORGANIZER, "trobinson@vistamarconsulting.com"];
    const ev = { event_id: "adhoc1", series_id: null, iCalUID: "uid-adhoc", title: "One-off", date: "2026-06-01T17:00:00Z", organizer_email: ORGANIZER };
    const out = dedupeEventsAcrossSubjects([[ev], [{ ...ev, source_calendar: subjects[1] }]], subjects);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("One-off");
  });

  it("prefers the organizer's copy of an instance over a non-organizer copy", () => {
    const subjects = [OTHER, ORGANIZER]; // non-organizer first, organizer second
    const base = { event_id: "vm_20260530", series_id: "vm", iCalUID: "uid-vm", title: "VM", date: "2026-05-30T18:30:00Z", organizer_email: ORGANIZER };
    const out = dedupeEventsAcrossSubjects(
      [[{ ...base, source_calendar: OTHER, teams_url: "stale" }], [{ ...base, source_calendar: ORGANIZER, teams_url: "fresh" }]],
      subjects
    );
    expect(out).toHaveLength(1);
    expect(out[0].source_calendar).toBe(ORGANIZER);
  });
});
