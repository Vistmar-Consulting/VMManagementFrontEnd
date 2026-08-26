import { describe, it, expect } from "vitest";
import { baseSeriesId, agendaIdForMeeting } from "../agendaIds.js";

// Google mints a NEW recurrence master every time a series is edited with
// "this and following": {originalEventId}_R{splitStartUTC}. Keying agendas by
// that id strands the previous agenda's content on every reschedule.
// These ids are verbatim from management-db9eb (2026-08-26 strand incident).
const GV_BASE = "ea74a0v5at8tqo46ka8mtth368";
const GV_SPLIT = "ea74a0v5at8tqo46ka8mtth368_R20260826T193000";
const BMD_BASE = "6295h9p4mu514u7fkqm0tgmr68";

describe("baseSeriesId", () => {
  it("strips a recurrence-split suffix back to the original master id", () => {
    expect(baseSeriesId(GV_SPLIT)).toBe(GV_BASE);
  });

  it("leaves an unsplit master id unchanged", () => {
    expect(baseSeriesId(GV_BASE)).toBe(GV_BASE);
  });

  it("maps every split of one series onto the same base", () => {
    // BMD split three times; all three must collapse to one agenda key.
    expect(baseSeriesId(`${BMD_BASE}_R20260521T183000`)).toBe(BMD_BASE);
    expect(baseSeriesId(`${BMD_BASE}_R20260702T183000`)).toBe(BMD_BASE);
    expect(baseSeriesId(`${BMD_BASE}_R20260827T183000`)).toBe(BMD_BASE);
  });

  it("does NOT strip an instance id (no _R, trailing Z)", () => {
    const instance = `${GV_BASE}_20260826T193000Z`;
    expect(baseSeriesId(instance)).toBe(instance);
  });

  it("collapses a hypothetical nested split rather than leaving a partial id", () => {
    expect(baseSeriesId(`${GV_BASE}_R20260826T193000_R20261118T203000`)).toBe(GV_BASE);
  });

  it("handles nullish/empty input without throwing", () => {
    expect(baseSeriesId(null)).toBe(null);
    expect(baseSeriesId(undefined)).toBe(null);
    expect(baseSeriesId("")).toBe(null);
  });

  it("preserves ids that merely contain _R elsewhere", () => {
    expect(baseSeriesId("abc_R123")).toBe("abc_R123");
    expect(baseSeriesId("_R20260826T193000abc")).toBe("_R20260826T193000abc");
  });
});

describe("agendaIdForMeeting", () => {
  it("uses the BASE series id for a recurring meeting, so splits share one agenda", () => {
    expect(agendaIdForMeeting({ series_id: GV_SPLIT, event_id: `${GV_BASE}_20260826T193000Z` }))
      .toBe(GV_BASE);
  });

  it("keeps every split of a series pointed at the same agenda doc", () => {
    const a = agendaIdForMeeting({ series_id: `${BMD_BASE}_R20260521T183000` });
    const b = agendaIdForMeeting({ series_id: `${BMD_BASE}_R20260827T183000` });
    expect(a).toBe(b);
    expect(a).toBe(BMD_BASE);
  });

  it("falls back to event_id verbatim for an ad-hoc (non-recurring) meeting", () => {
    expect(agendaIdForMeeting({ series_id: null, event_id: "04jeppnh4emc3ag209et0ca585" }))
      .toBe("04jeppnh4emc3ag209et0ca585");
  });

  it("does not strip from an ad-hoc event_id even if it looks suffixed", () => {
    expect(agendaIdForMeeting({ series_id: null, event_id: "weird_R20260826T193000" }))
      .toBe("weird_R20260826T193000");
  });

  it("returns null when the meeting carries no usable identifier", () => {
    expect(agendaIdForMeeting({})).toBe(null);
    expect(agendaIdForMeeting(null)).toBe(null);
  });
});
