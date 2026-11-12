import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const graphReschedule = vi.fn(async () => { calls.push("graph"); });
const googleReschedule = vi.fn(async () => { calls.push("google"); });

vi.mock("../_lib/graph-events.js", () => ({ rescheduleEvent: (a) => graphReschedule(a) }));
vi.mock("../_lib/google-calendar.js", () => ({
  rescheduleEvent: (a) => googleReschedule(a),
  getM365EventId: async () => "graph-master",
}));
vi.mock("../_lib/auth.js", () => ({ requireAuth: async () => true }));
vi.mock("../_lib/cors.js", () => ({ applyCors: () => false }));

const { default: handler } = await import("../reschedule.js");

function run(body) {
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return handler({ method: "PUT", body }, res).then(() => res);
}

const base = {
  org_id: "vistamar",
  event_id: "google-master",
  mode: "instance",
  original_start: "2026-11-12T22:00:00.000Z",
  new_date: "2026-11-12",
  new_time: "11:00",
  duration_minutes: 60,
};

beforeEach(() => {
  calls.length = 0;
  graphReschedule.mockReset().mockImplementation(async () => { calls.push("graph"); });
  googleReschedule.mockReset().mockImplementation(async () => { calls.push("google"); });
});

describe("PUT /api/meetings/reschedule", () => {
  it("moves Google (which emails attendees) before Graph, both by the exact start", async () => {
    const res = await run(base);
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(["google", "graph"]);
    expect(googleReschedule.mock.calls[0][0]).toMatchObject({
      eventId: "google-master",
      originalStart: "2026-11-12T22:00:00.000Z",
      newStartDateTime: "2026-11-12T11:00:00",
      newEndDateTime: "2026-11-12T12:00:00",
      timezone: "America/Los_Angeles",
    });
    expect(graphReschedule.mock.calls[0][0]).toMatchObject({ eventId: "graph-master", originalStart: base.original_start });
  });

  it("reports a Graph outage after Google moved, as a retryable partial failure", async () => {
    graphReschedule.mockImplementation(async () => { throw new Error("Outlook occurrence lookup failed: 502"); });
    const res = await run(base);
    expect(res.statusCode).toBe(502);
    expect(res.payload.partial).toBe(true);
    expect(res.payload.error).toMatch(/Attendees were sent the new time/);
    expect(res.payload.error).toMatch(/safe to retry/);
  });

  it("does not touch Graph when Google fails", async () => {
    googleReschedule.mockImplementation(async () => { throw new Error("google down"); });
    const res = await run(base);
    expect(res.statusCode).toBe(500);
    expect(graphReschedule).not.toHaveBeenCalled();
  });

  it("rejects instance mode without a start instant (stale bundle sending original_date)", async () => {
    const { original_start, ...old } = base;
    const res = await run({ ...old, original_date: "2026-11-12" });
    expect(res.statusCode).toBe(400);
    expect(googleReschedule).not.toHaveBeenCalled();
  });

  it("series mode needs no start instant", async () => {
    const { original_start, ...series } = base;
    const res = await run({ ...series, mode: "series" });
    expect(res.statusCode).toBe(200);
  });
});
