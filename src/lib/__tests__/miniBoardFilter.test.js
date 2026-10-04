import { describe, expect, it } from "vitest";
import { filterMiniBoard } from "../miniBoardFilter.js";

const parents = [
  { id: "p1", assigneeIds: [] },
  { id: "p2", assigneeIds: ["u1"] },
  { id: "p3", assigneeIds: ["u2"] },
];
const subs = {
  p1: [{ id: "s1", assigneeIds: ["u1"] }, { id: "s2", assigneeIds: ["u2"] }],
  p2: [{ id: "s3", assigneeIds: [] }],
  p3: [{ id: "s4", assigneeIds: ["u2"] }],
};

describe("filterMiniBoard — attendee", () => {
  it("passes everything through when no assignee is selected", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: null });
    expect(out.parents).toBe(parents);
    expect(out.subitemsByParent).toBe(subs);
    expect(out.dimmedIds.size).toBe(0);
    expect(out.forceExpandedIds.size).toBe(0);
  });

  it("keeps parents that match themselves or through a subitem", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: ["u1"] });
    expect(out.parents.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("narrows subitems to the selected assignee", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: ["u1"] });
    expect(out.subitemsByParent.p1.map((s) => s.id)).toEqual(["s1"]);
    expect(out.subitemsByParent.p2).toEqual([]);
  });

  it("dims a parent kept only for a matching subitem", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: ["u1"] });
    expect([...out.dimmedIds]).toEqual(["p1"]);
  });

  it("expands every parent with a matching subitem", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: ["u2"] });
    expect([...out.forceExpandedIds].sort()).toEqual(["p1", "p3"]);
  });
});

describe("filterMiniBoard — attendee without an account", () => {
  it("shows no items", () => {
    const out = filterMiniBoard(parents, subs, { assigneeIds: [] });
    expect(out.parents).toEqual([]);
  });
});

describe("filterMiniBoard — Meeting Focus scorecard", () => {
  const sParents = [
    { id: "p1", statusId: 1, assigneeIds: ["u1"] },
    { id: "p2", statusId: 5, assigneeIds: ["u2"] },
    { id: "p3", statusId: 2, assigneeIds: [] },
  ];
  const sSubs = {
    p1: [{ id: "s1", statusId: 5, assigneeIds: ["u1"] }, { id: "s2", statusId: 2, assigneeIds: ["u1"] }],
    p3: [{ id: "s3", statusId: 5, assigneeIds: ["u2"] }],
  };

  it("keeps only items in the selected status, opening parents for matching subitems", () => {
    const out = filterMiniBoard(sParents, sSubs, { scorecardKey: "status-5" });
    expect(out.parents.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(out.subitemsByParent.p1.map((s) => s.id)).toEqual(["s1"]);
    expect([...out.dimmedIds].sort()).toEqual(["p1", "p3"]);
    expect([...out.forceExpandedIds].sort()).toEqual(["p1", "p3"]);
  });

  it("requires both the attendee and the status when both are selected", () => {
    const out = filterMiniBoard(sParents, sSubs, { assigneeIds: ["u1"], scorecardKey: "status-5" });
    expect(out.parents.map((p) => p.id)).toEqual(["p1"]);
    expect(out.subitemsByParent.p1.map((s) => s.id)).toEqual(["s1"]);
  });

  it("keeps items created under the filter even when they don't match", () => {
    const out = filterMiniBoard(sParents, sSubs, { scorecardKey: "status-5", keepIds: new Set(["s2"]) });
    expect(out.subitemsByParent.p1.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});
