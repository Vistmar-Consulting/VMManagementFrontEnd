import { describe, it, expect, vi } from "vitest";
import {
  BOARD_SYNC_EMAIL,
  canBoardSync,
  tagSlug,
  bucketTranscripts,
  splitBucket,
  syncMeetingStamps,
  groupStamps,
  fetchTranscriptsSince,
  boardContextForOrg,
  initPromotion,
} from "../boardSyncCore.js";

const DAY = 86400000;
const NOW = Date.parse("2026-10-26T12:00:00Z");
const resolveOrg = (att) => att?.[0]?.org || null; // test double: org carried on the attendee row
const tr = (id, title, org, daysAgo) => ({
  id, title, date: new Date(NOW - daysAgo * DAY).toISOString(), meeting_attendees: org ? [{ org }] : [],
});
const opts = (extra = {}) => ({
  orgSlugs: ["unio", "id-care", "vistamar"],
  masterTitles: new Set(["vm weekly touch base"]),
  vistamarTitles: new Set(["platform dev"]),
  resolveOrg,
  sinceMs: NOW - 30 * DAY,
  ...extra,
});

describe("access", () => {
  it("allows only Andy, case-insensitive", () => {
    expect(BOARD_SYNC_EMAIL).toBe("adeemer@vistamarconsulting.com");
    expect(canBoardSync("ADeemer@VistamarConsulting.com")).toBe(true);
    expect(canBoardSync("hugo@vistamarconsulting.com")).toBe(false);
    expect(canBoardSync(null)).toBe(false);
  });
});

describe("tagSlug", () => {
  it("slugifies", () => expect(tagSlug("  Laser Launch Q4! ")).toBe("laser-launch-q4"));
});

describe("bucketTranscripts — spec table 3.2 scopes", () => {
  it("this-org: attendee-classified client meeting goes only to that client", () => {
    const { buckets } = bucketTranscripts([tr("a", "Unio weekly", "unio", 2)], opts());
    expect(buckets.unio.map((t) => [t.id, t.scope])).toEqual([["a", "this-org"]]);
    expect(buckets["id-care"]).toEqual([]);
    expect(buckets.vistamar).toEqual([]);
  });
  it("cross-org: master-mapped title fans into every org", () => {
    const { buckets } = bucketTranscripts([tr("m", "VM Weekly Touch Base", "vistamar", 1)], opts());
    for (const o of ["unio", "id-care", "vistamar"]) expect(buckets[o][0].scope).toBe("cross-org");
  });
  it("vistamar-internal: Vistamar meeting is this-org for vistamar, context for clients", () => {
    const { buckets } = bucketTranscripts([tr("v", "Platform dev", null, 3)], opts());
    expect(buckets.vistamar[0].scope).toBe("this-org");
    expect(buckets.unio[0].scope).toBe("vistamar-internal");
  });
  it("drops out-of-window and counts unclassified", () => {
    const { buckets, unclassified } = bucketTranscripts(
      [tr("old", "Unio weekly", "unio", 40), tr("x", "Random", null, 1)],
      opts(),
    );
    expect(buckets.unio).toEqual([]);
    expect(unclassified).toBe(1);
  });
});

describe("splitBucket — ledger + backfill", () => {
  // Epoch after NOW so backfill applies to these fixtures unless a test overrides it.
  const ctxBase = { ledger: new Map(), thresholds: {}, masterThreshold: 0, epochMs: NOW + DAY };
  const bucketOf = (list, org) => bucketTranscripts(list, opts()).buckets[org];

  it("unstamped this-org is new", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", ctxBase);
    expect(s.fresh.map((t) => t.id)).toEqual(["a"]);
  });
  it("stamped for this org → already-synced context", () => {
    const ledger = new Map([["a", { orgs: { unio: { by: "agenda" } } }]]);
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.fresh).toEqual([]);
    expect(s.context[0].scope).toBe("already-synced");
  });
  it("cross-org stamped for another org is still new for this one", () => {
    const ledger = new Map([["m", { orgs: { vistamar: { by: "board" } } }]]);
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 1)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.fresh.map((t) => t.id)).toEqual(["m"]);
  });
  it("vistamar-internal never counts as new for a client", () => {
    const s = splitBucket(bucketOf([tr("v", "Platform dev", null, 3)], "unio"), "unio", ctxBase);
    expect(s.fresh).toEqual([]);
    expect(s.context[0].scope).toBe("vistamar-internal");
  });
  it("backfill: transcript before the org's last Sync Meeting counts as synced", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 5)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - 2 * DAY },
    });
    expect(s.fresh).toEqual([]);
  });
  it("backfill: cross-org uses the master agenda's last sync", () => {
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 5)], "unio"), "unio", {
      ...ctxBase, masterThreshold: NOW - 2 * DAY,
    });
    expect(s.fresh).toEqual([]);
  });
  it("backfill: a client's own later Sync Meeting does NOT hide a cross-org transcript", () => {
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 5)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - DAY },
    });
    expect(s.fresh.map((t) => t.id)).toEqual(["m"]);
  });
  it("after the ledger epoch, only the ledger counts (no backfill)", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - DAY }, epochMs: NOW - 3 * DAY,
    });
    expect(s.fresh.map((t) => t.id)).toEqual(["a"]);
  });
  it("caps new at maxNew and reports the overflow", () => {
    const list = Array.from({ length: 4 }, (_, i) => tr(`t${i}`, "Unio weekly", "unio", i + 1));
    const s = splitBucket(bucketOf(list, "unio"), "unio", ctxBase, { maxNew: 3 });
    expect(s.fresh.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
    expect(s.droppedNew).toBe(1);
  });
});

describe("syncMeetingStamps — Sync Meeting writer rule", () => {
  const t = (id, scope, extra = {}) => ({ id, scope, org: extra.org || null, mapped: !!extra.mapped });
  it("per-org stamps this-org only, never vistamar-internal", () => {
    const out = syncMeetingStamps([t("a", "this-org"), t("v", "vistamar-internal", { org: "vistamar" })], {
      targetOrg: "unio", master: false, orgSlugs: [],
    });
    expect(out).toEqual([{ id: "a", org: "unio" }]);
  });
  it("master stamps mapped transcripts for every org, others for their own org", () => {
    const out = syncMeetingStamps([t("m", "vistamar-internal", { org: "vistamar", mapped: true }), t("c", "this-org", { org: "unio" })], {
      targetOrg: null, master: true, orgSlugs: ["unio", "vistamar"],
    });
    expect(out).toEqual([
      { id: "m", org: "unio" }, { id: "m", org: "vistamar" }, { id: "c", org: "unio" },
    ]);
  });
  it("skips transcripts without an id", () => {
    expect(syncMeetingStamps([{ scope: "this-org" }], { targetOrg: "unio", master: false, orgSlugs: [] })).toEqual([]);
  });
  it("groupStamps merges orgs per transcript id", () => {
    expect(groupStamps([{ id: "m", org: "unio" }, { id: "m", org: "vistamar" }, { id: "m", org: "unio" }]))
      .toEqual({ m: ["unio", "vistamar"] });
  });
});

describe("fetchTranscriptsSince", () => {
  const page = (startDay, n) => ({
    transcripts: Array.from({ length: n }, (_, i) => ({ id: `${startDay + i}`, date: new Date(NOW - (startDay + i) * DAY).toISOString() })),
  });
  it("stops at a short page", async () => {
    const q = vi.fn().mockResolvedValueOnce(page(0, 10));
    const rows = await fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 50 });
    expect(rows).toHaveLength(10);
    expect(q).toHaveBeenCalledWith("Q", { limit: 50, skip: 0 });
  });
  it("pages until the oldest row passes the cutoff", async () => {
    const q = vi.fn().mockResolvedValueOnce(page(0, 2)).mockResolvedValueOnce(page(2, 2)).mockResolvedValueOnce(page(40, 2));
    const rows = await fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 2 });
    expect(rows).toHaveLength(6);
    expect(q).toHaveBeenCalledTimes(3);
  });
  it("throws if it never reaches the cutoff", async () => {
    const q = vi.fn().mockResolvedValue(page(0, 2));
    await expect(fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 2, maxPages: 2 })).rejects.toThrow(/did not reach/);
  });
});

describe("boardContextForOrg", () => {
  const items = [
    { id: "p", title: "Parent", name: "Parent", organizationId: "unio", statusId: 2, updatedAt: NOW - DAY, createdAt: NOW - 60 * DAY },
    { id: "c", title: "Child", name: "Child", organizationId: "unio", parentId: "p", statusId: 1, updatedAt: NOW - DAY, createdAt: NOW - DAY },
    { id: "o", title: "Other org", organizationId: "id-care", statusId: 1, updatedAt: NOW, createdAt: NOW },
  ];
  it("existingTasks = this org's top-level items; projectBoard = recent activity", () => {
    const { existingTasks, projectBoard } = boardContextForOrg(items, "unio", NOW - 30 * DAY);
    expect(existingTasks.map((t) => t.id)).toEqual(["p"]);
    expect(projectBoard.map((b) => [b.name, b.isNew, b.project])).toEqual([["Parent", false, null], ["Child", true, "Parent"]]);
  });
});

describe("initPromotion", () => {
  const categories = [{ id: "website", name: "Website" }, { id: "seo", name: "SEO" }];
  const tags = [{ id: "hipaa", name: "hipaa" }, { id: "gbp", name: "GBP" }];
  it("first resolvable category; known tags resolved; unknown tags kept as new", () => {
    const p = initPromotion({ categories: ["nope", "SEO", "website"], tags: ["GBP", "laser launch", "hipaa"], note: "" }, { categories, tags, users: [] });
    expect(p).toEqual({ statusId: 8, categoryId: "seo", tagIds: ["gbp", "hipaa"], newTags: ["laser launch"] });
  });
  it("no category → null; infers assignee from the note", () => {
    const p = initPromotion({ categories: [], tags: [], note: "Owner: Bill" }, { categories, tags, users: [{ id: "u2", displayName: "Bill Jones" }] });
    expect(p.categoryId).toBeNull();
    expect(p.assigneeIds).toEqual(["u2"]);
  });
});
