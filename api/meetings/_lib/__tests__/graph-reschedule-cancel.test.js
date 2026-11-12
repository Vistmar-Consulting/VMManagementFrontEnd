import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../keyvault.js", () => ({
  getTeamsCredentials: async () => ({ clientId: "c", clientSecret: "s", tenantId: "t", hostUserId: "u" }),
}));

const { rescheduleEvent, cancelEvent } = await import("../graph-events.js");

const PT = "America/Los_Angeles";
// Outlook occurrences of one series, start/end/originalStart in UTC as Graph
// returns them under Prefer: outlook.timezone="UTC".
let instances;
let writes;
const occ = (id, start, { originalStart, type = "occurrence" } = {}) => ({
  id, type, isCancelled: false,
  start: { dateTime: `${start}.0000000`, timeZone: "UTC" },
  end: { dateTime: `${new Date(Date.parse(`${start}Z`) + 3600_000).toISOString().slice(0, 19)}.0000000`, timeZone: "UTC" },
  ...(originalStart ? { originalStart } : {}),
});

function json(body, status = 200) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  writes = [];
  instances = [occ("o_1112", "2026-11-12T22:00:00", { originalStart: "2026-11-12T22:00:00Z" })];
  vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("login.microsoftonline.com")) return json({ access_token: "tok", expires_in: 3600 });
    if (u.includes("/instances?")) {
      const q = new URL(u).searchParams;
      const from = Date.parse(q.get("startDateTime"));
      const to = Date.parse(q.get("endDateTime"));
      return json({ value: instances.filter((i) => {
        const s = Date.parse(`${i.start.dateTime.slice(0, 19)}Z`);
        return s < to && s + 3600_000 > from;
      }) });
    }
    writes.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    return json({}, 202);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const base = {
  eventId: "master",
  mode: "instance",
  originalStart: "2026-11-12T22:00:00.000Z",
  seriesSlot: "2026-11-12T22:00:00.000Z",
  newStartDateTime: "2026-11-12T11:00:00",
  newEndDateTime: "2026-11-12T12:00:00",
  timezone: PT,
};

describe("graph rescheduleEvent — instance", () => {
  it("patches the occurrence in the slot Google reported", async () => {
    await rescheduleEvent(base);
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toContain("/calendar/events/o_1112");
    expect(writes[0].body.start).toEqual({ dateTime: "2026-11-12T11:00:00", timeZone: PT });
  });

  it("finds it when the user's dialog shows Google's new time but Outlook is still at the old one", async () => {
    await rescheduleEvent({ ...base, originalStart: "2026-11-12T19:00:00.000Z" });
    expect(writes[0].url).toContain("/calendar/events/o_1112");
  });

  it("an occurrence with no originalStart field matches by its start when unmoved", async () => {
    instances = [occ("o_1112", "2026-11-12T22:00:00")];
    await rescheduleEvent(base);
    expect(writes[0].url).toContain("/calendar/events/o_1112");
  });

  it("retry after Outlook already moved it: no write", async () => {
    instances = [occ("o_1112", "2026-11-12T19:00:00", { originalStart: "2026-11-12T22:00:00Z", type: "exception" })];
    expect(await rescheduleEvent(base)).toEqual({ alreadyApplied: true });
    expect(writes).toHaveLength(0);
  });

  it("does not treat another occurrence that sits at the new time as already moved", async () => {
    instances = [
      occ("o_1112", "2026-11-12T22:00:00", { originalStart: "2026-11-12T22:00:00Z" }),
      occ("o_other", "2026-11-12T19:00:00", { originalStart: "2026-11-10T19:00:00Z", type: "exception" }),
    ];
    await rescheduleEvent(base);
    expect(writes[0].url).toContain("/calendar/events/o_1112");
  });

  it("fails loudly when no occurrence has that slot", async () => {
    instances = [];
    await expect(rescheduleEvent(base)).rejects.toThrow(/no live occurrence/);
  });
});

describe("graph cancelEvent — instance", () => {
  it("cancels the occurrence in the slot", async () => {
    await cancelEvent({ eventId: "master", mode: "instance", originalStart: base.originalStart, seriesSlot: base.seriesSlot });
    expect(writes[0].url).toContain("/calendar/events/o_1112/cancel");
  });

  it("retry after Outlook applied the cancel but reported failure: nothing left, no error", async () => {
    instances = [];
    expect(await cancelEvent({ eventId: "master", mode: "instance", originalStart: base.originalStart, seriesSlot: base.seriesSlot }))
      .toEqual({ alreadyApplied: true });
    expect(writes).toHaveLength(0);
  });
});
