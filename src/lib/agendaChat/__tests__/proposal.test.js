// src/lib/agendaChat/__tests__/proposal.test.js
import { describe, expect, it } from "vitest";
import { buildReviewRows, planAgendaWrites, restale } from "../proposal.js";

const topics = [
  { id: "a", name: "Alpha", bodyHtml: "<p>a</p>", sortOrder: 1, updatedAt: new Date(100) },
  { id: "b", name: "Beta", bodyHtml: "<p>b</p>", sortOrder: 2, updatedAt: new Date(500) },
  { id: "c", name: "Gamma", bodyHtml: "", sortOrder: 3, updatedAt: new Date(100) },
];
const agenda = { openFloorHtml: "<ul><li>x</li></ul>", updatedAt: new Date(100) };
const ctx = { topics, agenda, isMaster: false, orgIds: new Set(), seen: { a: 100, b: 100, c: 100, openFloor: "<ul><li>x</li></ul>" } };
const all = (rows) => new Set(rows.map((r) => r.index));
const plan = (ops, c = ctx) => {
  const rows = buildReviewRows(ops, c);
  return planAgendaWrites(rows, all(rows), c);
};

describe("buildReviewRows", () => {
  it("validates ops and flags topics changed since the model read them", () => {
    const rows = buildReviewRows([
      { op: "update_topic", topicId: "b", bodyHtml: "<p>new</p>", reason: "r" },
      { op: "update_topic", topicId: "zz", name: "X", reason: "r" },
      { op: "create_topic", name: "  ", reason: "r" },
      { op: "delete_topic", topicId: "c", reason: "r" },
      { op: "move_topic", topicId: "c", afterTopicId: "start", reason: "r" },
      { op: "update_topic", topicId: "a", reason: "r" },
      { op: "set_open_floor", bodyHtml: "<p>of</p>", reason: "r" },
      { op: "set_open_floor", bodyHtml: "<p>again</p>", reason: "r" },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([true, false, false, true, false, false, true, false]);
    expect(rows[0]).toMatchObject({ stale: true, beforeHtml: "<p>b</p>", afterHtml: "<p>new</p>" });
    expect(rows[4].error).toMatch(/deleted by change 4/);
    expect(rows[6].beforeHtml).toBe("<ul><li>x</li></ul>");
  });

  it("sanitizes bodies", () => {
    const [row] = buildReviewRows([{ op: "update_topic", topicId: "a", bodyHtml: "<h1>T</h1><script>x</script><p>ok</p>", reason: "r" }], ctx);
    expect(row.afterHtml).toBe("T<p>ok</p>");
  });

  it("on a master agenda, needs an org for a new topic and keeps topics in their org group", () => {
    const m = { ...ctx, isMaster: true, orgIds: new Set(["o1", "o2"]), topics: topics.map((tp, i) => ({ ...tp, organizationId: i < 2 ? "o1" : "o2" })) };
    const rows = buildReviewRows([
      { op: "create_topic", name: "N", reason: "r" },
      { op: "create_topic", name: "N", orgId: "o2", afterTopicId: "a", reason: "r" },
      { op: "move_topic", topicId: "c", afterTopicId: "a", reason: "r" },
      { op: "create_topic", name: "N", orgId: "o1", reason: "r" },
    ], m);
    expect(rows.map((r) => r.ok)).toEqual([false, false, false, true]);
  });
});

describe("restale", () => {
  it("flags a row whose topic changed after the review opened", () => {
    const rows = buildReviewRows([
      { op: "update_topic", topicId: "a", name: "A2", reason: "r" },
      { op: "set_open_floor", bodyHtml: "<p>x</p>", reason: "r" },
    ], ctx);
    expect(rows.map((r) => r.stale)).toEqual([false, false]);
    const later = restale(rows, { ...ctx, topics: topics.map((tp) => (tp.id === "a" ? { ...tp, updatedAt: new Date(900) } : tp)) });
    expect(later.map((r) => r.stale)).toEqual([true, false]);
  });

  it("the Open Floor is stale only when its content changed, not when the agenda doc was touched", () => {
    const rows = buildReviewRows([{ op: "set_open_floor", bodyHtml: "<p>x</p>", reason: "r" }], ctx);
    const renamed = restale(rows, { ...ctx, agenda: { ...agenda, title: "New title", updatedAt: new Date(900) } });
    expect(renamed[0].stale).toBe(false);
    const edited = restale(rows, { ...ctx, agenda: { ...agenda, openFloorHtml: "<ul><li>y</li></ul>" } });
    expect(edited[0].stale).toBe(true);
  });
});

describe("planAgendaWrites", () => {
  it("updates, deletes and rewrites the Open Floor; live bodies cover existing fragments only", () => {
    const p = plan([
      { op: "update_topic", topicId: "a", name: "Alpha 2", bodyHtml: "<p>A</p>", reason: "r" },
      { op: "delete_topic", topicId: "b", reason: "r" },
      { op: "set_open_floor", bodyHtml: "<p>of</p>", reason: "r" },
      { op: "create_topic", name: "New", bodyHtml: "<p>n</p>", reason: "r" },
    ]);
    expect(p.updates).toEqual([{ id: "a", patch: { name: "Alpha 2", bodyHtml: "<p>A</p>" } }]);
    expect(p.deletes).toEqual(["b"]);
    expect(p.openFloorHtml).toBe("<p>of</p>");
    expect(p.creates).toEqual([{ name: "New", bodyHtml: "<p>n</p>", organizationId: null, sortOrder: 4 }]);
    expect(p.liveBodies).toEqual({ a: "<p>A</p>", openFloor: "<p>of</p>" });
  });

  it("places creates and moves between their neighbours without touching other topics", () => {
    const p = plan([
      { op: "create_topic", name: "First", afterTopicId: "start", reason: "r" },
      { op: "create_topic", name: "Mid1", afterTopicId: "a", reason: "r" },
      { op: "move_topic", topicId: "c", afterTopicId: "a", reason: "r" },
    ]);
    // Order: First, a(1), c, Mid1, b(2) — c was moved after a, after Mid1 was inserted after a.
    expect(p.creates.map((c) => [c.name, c.sortOrder])).toEqual([["First", 0], ["Mid1", 1 + 2 / 3]]);
    expect(p.updates).toEqual([{ id: "c", patch: { sortOrder: 1 + 1 / 3 } }]);
  });

  it("refuses when a topic in the change was deleted while the review was open", () => {
    const rows = buildReviewRows([{ op: "update_topic", topicId: "b", name: "B2", reason: "r" }], ctx);
    expect(() => planAgendaWrites(rows, all(rows), { ...ctx, topics: topics.filter((tp) => tp.id !== "b") }))
      .toThrow("“Beta” was deleted after Claude read the agenda");
  });

  it("an unticked op is not written", () => {
    const rows = buildReviewRows([
      { op: "delete_topic", topicId: "a", reason: "r" },
      { op: "update_topic", topicId: "b", name: "B2", reason: "r" },
    ], ctx);
    const p = planAgendaWrites(rows, new Set([1]), ctx);
    expect(p.deletes).toEqual([]);
    expect(p.updates).toEqual([{ id: "b", patch: { name: "B2" } }]);
  });

  it("on a master agenda a topic alone in its org stays in place when moved to the start; a new org's group opens in org order", () => {
    const orgs = [
      { id: "o1", sortOrder: 1 }, { id: "o2", sortOrder: 2 }, { id: "o3", sortOrder: 3 },
      { id: "vistamar", type: "internal", sortOrder: 0 },
    ];
    const mt = [
      { id: "a", organizationId: "o1", sortOrder: 1 },
      { id: "c", organizationId: "o3", sortOrder: 3 },
      { id: "v", organizationId: "vistamar", sortOrder: 4 },
    ];
    const m = { ...ctx, isMaster: true, orgs, orgIds: new Set(orgs.map((o) => o.id)), topics: mt, seen: {} };
    const moved = plan([{ op: "move_topic", topicId: "c", afterTopicId: "start", reason: "r" }], m);
    // Back between o1 (1) and Vistamar (4) — not to the top of the agenda.
    expect(moved.updates).toEqual([{ id: "c", patch: { sortOrder: 2.5 } }]);
    const created = plan([{ op: "create_topic", name: "N", orgId: "o2", reason: "r" }], m);
    expect(created.creates[0].sortOrder).toBe(2);
    const startNew = plan([{ op: "create_topic", name: "N", orgId: "o2", afterTopicId: "start", reason: "r" }], m);
    expect(startNew.creates[0].sortOrder).toBe(2);
  });

  it("on a master agenda a new topic with no anchor goes to the end of its org's group", () => {
    const m = { ...ctx, isMaster: true, orgIds: new Set(["o1", "o2"]), topics: topics.map((tp, i) => ({ ...tp, organizationId: i < 2 ? "o1" : "o2" })) };
    const p = plan([{ op: "create_topic", name: "N", orgId: "o1", reason: "r" }], m);
    expect(p.creates[0]).toMatchObject({ organizationId: "o1", sortOrder: 2.5 });
  });
});

describe("topic cards and their tasks", () => {
  const cardTopics = [
    { ...topics[0], categoryIds: ["web"], tagIds: [], organizationId: null, excludedItemIds: ["i9"] },
    topics[1],
  ];
  const items = [
    { id: "i1", organizationId: "bmd", categoryId: "web" },
    { id: "i9", organizationId: "bmd", categoryId: "web" },
    { id: "i5", organizationId: "bmd", categoryId: "seo" },
  ];
  const board = {
    items,
    agendaOrgId: "bmd",
    categoryIds: new Set(["web", "seo", "newCat"]),
    tagsFor: (org) => new Set(org === "bmd" ? ["shared", "bmdTag", "newTag"] : ["shared"]),
  };
  const bctx = { ...ctx, topics: cardTopics, board };

  it("changes a topic's categories and tags, checking each id and its organization", () => {
    const rows = buildReviewRows([
      { op: "update_topic", topicId: "a", categoryIds: ["web", "newCat"], tagIds: ["newTag"], reason: "r" },
      { op: "update_topic", topicId: "b", tagIds: ["otherOrg"], reason: "r" },
      { op: "update_topic", topicId: "c", categoryIds: ["nope"], reason: "r" },
    ], { ...bctx, topics: [...cardTopics, topics[2]] });
    expect(rows[0].keys).toEqual({ categoryIds: { before: ["web"], after: ["web", "newCat"] }, tagIds: { before: [], after: ["newTag"] } });
    expect(rows[1].error).toMatch(/not a shared tag or this topic's organization's own/);
    expect(rows[2].error).toMatch(/Unknown category nope/);
    const p = planAgendaWrites(rows, new Set([0]), { ...bctx, newIds: { newCat: "realCat", newTag: "realTag" } });
    expect(p.updates).toEqual([{ id: "a", patch: { categoryIds: ["web", "realCat"], tagIds: ["realTag"] } }]);
    expect(p.liveBodies).toEqual({});
  });

  it("removes a task shown on the card and restores one removed by hand, in one patch", () => {
    const rows = buildReviewRows([
      { op: "remove_task", topicId: "a", itemId: "i1", reason: "r" },
      { op: "restore_task", topicId: "a", itemId: "i9", reason: "r" },
      { op: "remove_task", topicId: "a", itemId: "i5", reason: "r" },
      { op: "restore_task", topicId: "a", itemId: "i1", reason: "r" },
      { op: "update_topic", topicId: "a", name: "Web", reason: "r" },
    ], bctx);
    expect(rows.map((r) => r.ok)).toEqual([true, true, false, false, true]);
    expect(rows[2].error).toBe("That task isn't on this topic card");
    expect(rows[3].error).toMatch(/already has a change on this topic in change 1/);
    const p = planAgendaWrites(rows, all(rows), bctx);
    expect(p.updates).toEqual([{ id: "a", patch: { excludedItemIds: ["i1"], name: "Web" } }]);
  });

  it("a topic whose card tasks change can't be deleted in the same proposal; without the board, card ops are refused", () => {
    const rows = buildReviewRows([
      { op: "remove_task", topicId: "a", itemId: "i1", reason: "r" },
      { op: "delete_topic", topicId: "a", reason: "r" },
    ], bctx);
    expect(rows[1].error).toMatch(/changed by change 1/);
    const [noBoard] = buildReviewRows([{ op: "remove_task", topicId: "a", itemId: "i1", reason: "r" }], ctx);
    expect(noBoard.error).toBe("Topic cards' tasks can't be changed here");
  });
});
