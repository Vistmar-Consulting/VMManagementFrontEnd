import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const graphCancel = vi.fn();
const googleCancel = vi.fn();

vi.mock("../_lib/graph-events.js", () => ({ cancelEvent: (a) => graphCancel(a) }));
vi.mock("../_lib/google-calendar.js", () => ({
  cancelEvent: (a) => googleCancel(a),
  getM365EventId: async () => "graph-master",
}));
vi.mock("../_lib/auth.js", () => ({ requireAuth: async () => true, requireV2_2Enabled: () => true }));
vi.mock("../_lib/cors.js", () => ({ applyCors: () => false }));

const { default: handler } = await import("../cancel.js");

function run(body) {
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return handler({ method: "DELETE", body }, res).then(() => res);
}

const base = {
  org_id: "vistamar",
  event_id: "google-master",
  mode: "instance",
  original_start: "2026-11-13T01:00:00.000Z", // 5pm PT — the next UTC day
  notify: true,
};

beforeEach(() => {
  calls.length = 0;
  graphCancel.mockReset().mockImplementation(async () => { calls.push("graph"); });
  googleCancel.mockReset().mockImplementation(async () => { calls.push("google"); return { seriesSlot: "2026-11-13T01:00:00.000Z" }; });
});

describe("DELETE /api/meetings/cancel", () => {
  it("cancels Google (which emails attendees) before Graph, both by the exact start", async () => {
    const res = await run(base);
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(["google", "graph"]);
    expect(googleCancel.mock.calls[0][0]).toMatchObject({ originalStart: base.original_start, sendUpdates: "all" });
    expect(graphCancel.mock.calls[0][0]).toMatchObject({
      eventId: "graph-master",
      originalStart: base.original_start,
      seriesSlot: "2026-11-13T01:00:00.000Z",
    });
  });

  it("silent cancel passes sendUpdates none to Google", async () => {
    await run({ ...base, notify: false });
    expect(googleCancel.mock.calls[0][0].sendUpdates).toBe("none");
  });

  it("reports a Graph outage after Google cancelled, as a retryable partial failure", async () => {
    graphCancel.mockImplementation(async () => { throw new Error("Outlook occurrence lookup failed: 502"); });
    const res = await run(base);
    expect(res.statusCode).toBe(502);
    expect(res.payload.partial).toBe(true);
    expect(res.payload.error).toMatch(/safe to retry/);
  });

  it("does not touch Graph when Google fails", async () => {
    googleCancel.mockImplementation(async () => { throw new Error("google down"); });
    const res = await run(base);
    expect(res.statusCode).toBe(500);
    expect(graphCancel).not.toHaveBeenCalled();
  });

  it("rejects instance mode without a start instant (stale bundle sending date)", async () => {
    const { original_start, ...old } = base;
    const res = await run({ ...old, date: "2026-11-12" });
    expect(res.statusCode).toBe(400);
    expect(googleCancel).not.toHaveBeenCalled();
  });
});
