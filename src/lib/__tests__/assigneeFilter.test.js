import { describe, expect, it } from "vitest";
import { filterByAssignee } from "../assigneeFilter.js";

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

describe("filterByAssignee", () => {
  it("passes everything through when no assignee is selected", () => {
    const out = filterByAssignee(parents, subs, null);
    expect(out.parents).toBe(parents);
    expect(out.subitemsByParent).toBe(subs);
    expect(out.dimmedIds.size).toBe(0);
    expect(out.forceExpandedIds.size).toBe(0);
  });

  it("keeps parents that match themselves or through a subitem", () => {
    const out = filterByAssignee(parents, subs, "u1");
    expect(out.parents.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("narrows subitems to the selected assignee", () => {
    const out = filterByAssignee(parents, subs, "u1");
    expect(out.subitemsByParent.p1.map((s) => s.id)).toEqual(["s1"]);
    expect(out.subitemsByParent.p2).toEqual([]);
  });

  it("dims a parent kept only for a matching subitem", () => {
    const out = filterByAssignee(parents, subs, "u1");
    expect([...out.dimmedIds]).toEqual(["p1"]);
  });

  it("expands every parent with a matching subitem", () => {
    const out = filterByAssignee(parents, subs, "u2");
    expect([...out.forceExpandedIds].sort()).toEqual(["p1", "p3"]);
  });
});
