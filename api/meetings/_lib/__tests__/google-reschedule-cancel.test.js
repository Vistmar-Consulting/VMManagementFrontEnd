import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for one weekly series on meetings@ (Thu 2pm PT, first
// occurrence 2026-10-08). `instances` holds the expanded occurrences.
const cal = {
  events: {
    instances: vi.fn(),
    patch: vi.fn(async () => ({ data: {} })),
    get: vi.fn(),
    delete: vi.fn(async () => ({})),
  },
};

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class { async authorize() {} } },
    calendar: () => cal,
  },
}));
vi.mock("../keyvault.js", () => ({ getGoogleCredentials: async () => ({ client_email: "x", private_key: "y" }) }));

const { rescheduleEvent, cancelEvent, changeSeriesPattern } = await import("../google-calendar.js");

const PT = "America/Los_Angeles";
let instances;
function serve() {
  cal.events.instances.mockImplementation(async ({ timeMin, timeMax, showDeleted }) => ({
    data: {
      items: instances.filter((i) => {
        const s = Date.parse((i.start || i.originalStartTime).dateTime);
        return s < Date.parse(timeMax) && s + 3600_000 > Date.parse(timeMin) && (showDeleted || i.status !== "cancelled");
      }),
    },
  }));
}
const hourAfter = (iso) => {
  const d = new Date(Date.parse(iso) + 3600_000);
  return `${new Date(d.getTime() - 8 * 3600_000).toISOString().slice(0, 19)}-08:00`;
};
const occ = (id, start, original = start, status = "confirmed") => ({
  id, status,
  start: { dateTime: start, timeZone: PT },
  end: { dateTime: hourAfter(start), timeZone: PT },
  originalStartTime: { dateTime: original, timeZone: PT },
});
// Google only guarantees id / recurringEventId / originalStartTime on a
// cancelled occurrence.
const cancelledOcc = (id, original) => ({ id, status: "cancelled", originalStartTime: { dateTime: original, timeZone: PT } });

beforeEach(() => {
  vi.clearAllMocks();
  instances = [
    occ("s_1112", "2026-11-12T14:00:00-08:00"),
    occ("s_1119", "2026-11-19T14:00:00-08:00"),
  ];
  serve();
});

describe("google rescheduleEvent — instance", () => {
  it("patches the occurrence that starts at originalStart", async () => {
    await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-12T22:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT });
    expect(cal.events.patch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "s_1112", sendUpdates: "all" }));
  });

  it("finds a 5pm PT occurrence (next UTC day)", async () => {
    instances = [occ("s_eve", "2026-11-12T17:00:00-08:00")];
    await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-13T01:00:00.000Z",
      newStartDateTime: "2026-11-12T16:00:00", newEndDateTime: "2026-11-12T17:00:00", timezone: PT });
    expect(cal.events.patch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "s_eve" }));
  });

  it("on retry, skips an occurrence already moved to the new time (no second email)", async () => {
    instances[0] = occ("s_1112", "2026-11-12T11:00:00-08:00", "2026-11-12T14:00:00-08:00");
    const r = await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-12T22:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT });
    expect(r).toEqual({ alreadyApplied: true, seriesSlot: "2026-11-12T22:00:00.000Z" });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("returns the slot so Outlook can find the same occurrence", async () => {
    const r = await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-12T22:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT });
    expect(r).toEqual({ seriesSlot: "2026-11-12T22:00:00.000Z" });
  });

  it("reopened after a partial failure (shows the new time): no second email, slot still returned", async () => {
    instances[0] = occ("s_1112", "2026-11-12T11:00:00-08:00", "2026-11-12T14:00:00-08:00");
    const r = await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-12T19:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT });
    expect(r).toEqual({ alreadyApplied: true, seriesSlot: "2026-11-12T22:00:00.000Z" });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("retry onto a slot another occurrence already uses: finds the moved one whichever comes first", async () => {
    // Tue 10am moved onto Wed 10am, where Wed's own occurrence sits; natural one listed first.
    instances = [
      occ("s_wed", "2026-11-18T10:00:00-08:00"),
      occ("s_tue", "2026-11-18T10:00:00-08:00", "2026-11-17T10:00:00-08:00"),
    ];
    const r = await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-17T18:00:00.000Z",
      newStartDateTime: "2026-11-18T10:00:00", newEndDateTime: "2026-11-18T11:00:00", timezone: PT });
    expect(r).toEqual({ alreadyApplied: true, seriesSlot: "2026-11-17T18:00:00.000Z" });
  });

  it("two live occurrences at originalStart: moves the one scheduled there, not the one moved onto it", async () => {
    instances = [
      occ("s_tue", "2026-11-18T10:00:00-08:00", "2026-11-17T10:00:00-08:00"),
      occ("s_wed", "2026-11-18T10:00:00-08:00"),
    ];
    await rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-18T18:00:00.000Z",
      newStartDateTime: "2026-11-18T09:00:00", newEndDateTime: "2026-11-18T10:00:00", timezone: PT });
    expect(cal.events.patch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "s_wed" }));
  });

  it("fails loudly when nothing starts at originalStart", async () => {
    await expect(rescheduleEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-12T20:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT }))
      .rejects.toThrow(/no live occurrence/);
    expect(cal.events.patch).not.toHaveBeenCalled();
  });
});

describe("google rescheduleEvent — series", () => {
  it("recurring: keeps the first date (weekday) and changes only the time", async () => {
    cal.events.get.mockResolvedValue({ data: {
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      start: { dateTime: "2026-10-08T14:00:00-07:00", timeZone: PT },
      end: { dateTime: "2026-10-08T15:00:00-07:00", timeZone: PT },
    } });
    await rescheduleEvent({ eventId: "s", mode: "series",
      newStartDateTime: "2026-11-13T11:00:00", newEndDateTime: "2026-11-13T12:00:00", timezone: PT });
    expect(cal.events.patch.mock.calls[0][0].requestBody).toEqual({
      start: { dateTime: "2026-10-08T11:00:00", timeZone: PT },
      end: { dateTime: "2026-10-08T12:00:00", timeZone: PT },
    });
  });

  it("recurring: a retry when the series is already at the new time sends nothing", async () => {
    cal.events.get.mockResolvedValue({ data: {
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
      start: { dateTime: "2026-10-08T11:00:00-07:00", timeZone: PT },
      end: { dateTime: "2026-10-08T12:00:00-07:00", timeZone: PT },
    } });
    const r = await rescheduleEvent({ eventId: "s", mode: "series",
      newStartDateTime: "2026-11-12T11:00:00", newEndDateTime: "2026-11-12T12:00:00", timezone: PT });
    expect(r).toEqual({ alreadyApplied: true });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("one-time event: moves to the new date", async () => {
    cal.events.get.mockResolvedValue({ data: {
      start: { dateTime: "2026-11-12T14:00:00-08:00", timeZone: PT },
      end: { dateTime: "2026-11-12T15:00:00-08:00", timeZone: PT },
    } });
    await rescheduleEvent({ eventId: "one", mode: "series",
      newStartDateTime: "2026-11-14T09:00:00", newEndDateTime: "2026-11-14T10:00:00", timezone: PT });
    expect(cal.events.patch.mock.calls[0][0].requestBody.start.dateTime).toBe("2026-11-14T09:00:00");
  });
});

describe("google changeSeriesPattern", () => {
  const biweeklyWed = {
    summary: "GV – Biweekly",
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"],
    start: { dateTime: "2026-08-26T12:30:00-07:00", timeZone: PT },
    end: { dateTime: "2026-08-26T13:30:00-07:00", timeZone: PT },
  };
  const toWeeklyMon = {
    eventId: "s", rrule: "FREQ=WEEKLY;BYDAY=MO", title: "GV - Weekly",
    newStartDateTime: "2026-11-23T10:00:00", newEndDateTime: "2026-11-23T11:00:00", timezone: PT,
  };

  it("patches start, end, recurrence and title on the master in one emailed update", async () => {
    cal.events.get.mockResolvedValue({ data: biweeklyWed });
    await changeSeriesPattern(toWeeklyMon);
    expect(cal.events.patch).toHaveBeenCalledTimes(1);
    expect(cal.events.patch.mock.calls[0][0]).toEqual({
      calendarId: "primary", eventId: "s", sendUpdates: "all",
      requestBody: {
        start: { dateTime: "2026-11-23T10:00:00", timeZone: PT },
        end: { dateTime: "2026-11-23T11:00:00", timeZone: PT },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        summary: "GV - Weekly",
      },
    });
  });

  it("leaves the title alone when none is given", async () => {
    cal.events.get.mockResolvedValue({ data: biweeklyWed });
    await changeSeriesPattern({ ...toWeeklyMon, title: undefined });
    expect(cal.events.patch.mock.calls[0][0].requestBody).not.toHaveProperty("summary");
  });

  it("a retry when the master already matches sends nothing", async () => {
    cal.events.get.mockResolvedValue({ data: {
      summary: "GV - Weekly",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-23T10:00:00-08:00", timeZone: PT },
      end: { dateTime: "2026-11-23T11:00:00-08:00", timeZone: PT },
    } });
    expect(await changeSeriesPattern(toWeeklyMon)).toEqual({ alreadyApplied: true });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("a split piece is changed through its original master, carrying the split's guests", async () => {
    const guests = [{ email: "a@x.com" }, { email: "carolina@x.com" }];
    cal.events.get.mockImplementation(async ({ eventId }) => ({ data: eventId === "orig_R20260826T193000"
      ? { ...biweeklyWed, status: "confirmed", attendees: guests }
      : { ...biweeklyWed, recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20260826T065959Z;INTERVAL=2;BYDAY=WE"], attendees: [{ email: "old@x.com" }] } }));
    await changeSeriesPattern({ ...toWeeklyMon, eventId: "orig_R20260826T193000" });
    expect(cal.events.patch).toHaveBeenCalledTimes(1);
    expect(cal.events.patch.mock.calls[0][0]).toMatchObject({
      eventId: "orig", sendUpdates: "all",
      requestBody: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"], summary: "GV - Weekly", attendees: guests },
    });
  });

  it("a retry after Google cancelled the split piece sends nothing when the original already matches", async () => {
    cal.events.get.mockImplementation(async ({ eventId }) => ({ data: eventId === "orig_R20260826T193000"
      ? { ...biweeklyWed, status: "cancelled" }
      : { summary: "GV - Weekly", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
          start: { dateTime: "2026-11-23T10:00:00-08:00", timeZone: PT }, end: { dateTime: "2026-11-23T11:00:00-08:00", timeZone: PT } } }));
    expect(await changeSeriesPattern({ ...toWeeklyMon, eventId: "orig_R20260826T193000" })).toEqual({ alreadyApplied: true });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("refuses a one-time event", async () => {
    cal.events.get.mockResolvedValue({ data: { start: biweeklyWed.start, end: biweeklyWed.end } });
    await expect(changeSeriesPattern(toWeeklyMon)).rejects.toThrow(/not a recurring series/);
    expect(cal.events.patch).not.toHaveBeenCalled();
  });
});

describe("google cancelEvent", () => {
  it("cancels the occurrence at originalStart", async () => {
    await cancelEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-19T22:00:00.000Z", sendUpdates: "all" });
    expect(cal.events.patch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "s_1119", requestBody: { status: "cancelled" } }));
  });

  it("on retry, an already-cancelled occurrence (no start field) is a no-op", async () => {
    instances[1] = cancelledOcc("s_1119", "2026-11-19T14:00:00-08:00");
    const r = await cancelEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-19T22:00:00.000Z" });
    expect(r).toEqual({ alreadyApplied: true, seriesSlot: "2026-11-19T22:00:00.000Z" });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it("an old cancellation at the same start does not mask the live occurrence moved there", async () => {
    instances = [
      cancelledOcc("s_1119", "2026-11-19T14:00:00-08:00"),
      occ("s_1112", "2026-11-19T14:00:00-08:00", "2026-11-12T14:00:00-08:00"),
    ];
    const r = await cancelEvent({ eventId: "s", mode: "instance", originalStart: "2026-11-19T22:00:00.000Z", sendUpdates: "all" });
    expect(cal.events.patch).toHaveBeenCalledWith(expect.objectContaining({ eventId: "s_1112" }));
    expect(r).toEqual({ seriesSlot: "2026-11-12T22:00:00.000Z" });
  });

  it("series delete that is already gone (410) is a no-op", async () => {
    cal.events.delete.mockRejectedValue(Object.assign(new Error("Resource has been deleted"), { code: 410 }));
    expect(await cancelEvent({ eventId: "s", mode: "series" })).toEqual({ alreadyApplied: true });
  });
});
