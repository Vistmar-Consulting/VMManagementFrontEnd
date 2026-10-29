import { describe, expect, it } from "vitest";
import { countScorecards, countTasksByAssignee } from "../scorecards.js";

describe("countScorecards", () => {
  const parents = [
    { id: "p1", statusId: 2 },
    { id: "p2", statusId: 5 },
    { id: "p3", statusId: 7 },
  ];
  const subs = {
    p1: [{ id: "s1", statusId: 9, assigneeIds: ["u1"] }, { id: "s2", statusId: 7 }],
    p3: [{ id: "s3", statusId: 1 }],
  };

  it("counts subitems in place of their parent and skips archived work", () => {
    const counts = countScorecards(parents, subs);
    expect(counts["status-2"]).toBe(0);
    expect(counts["status-9"]).toBe(1);
    expect(counts["status-5"]).toBe(1);
    expect(counts["status-1"]).toBe(0);
  });

  it("narrows the tasks with the matcher", () => {
    const counts = countScorecards(parents, subs, (t) => (t.assigneeIds || []).includes("u1"));
    expect(counts["status-9"]).toBe(1);
    expect(counts["status-5"]).toBe(0);
  });
});

describe("countTasksByAssignee", () => {
  const parents = [
    { id: "p1", statusId: 2, assigneeIds: ["u1"] },
    { id: "p2", statusId: 2, assigneeIds: ["u1", "u2"] },
    { id: "p3", statusId: 7, assigneeIds: ["u1"] },
  ];
  const subs = {
    p1: [
      { id: "s1", statusId: 9, assigneeIds: ["u2"] },
      { id: "s2", statusId: 2, assigneeIds: ["u1"] },
      { id: "s3", statusId: 7, assigneeIds: ["u1"] },
    ],
    p3: [{ id: "s4", statusId: 2, assigneeIds: ["u1"] }],
  };

  it("counts the same tasks the scorecards count", () => {
    expect(countTasksByAssignee(parents, subs)).toEqual({ u1: 2, u2: 2 });
  });

  it("narrows to the selected scorecard, matching that card's count for the assignee", () => {
    expect(countTasksByAssignee(parents, subs, "status-2")).toEqual({ u1: 2, u2: 1 });
    expect(countTasksByAssignee(parents, subs, "status-9")).toEqual({ u2: 1 });
    const u2 = countScorecards(parents, subs, (t) => (t.assigneeIds || []).includes("u2"));
    expect(u2["status-2"]).toBe(1);
    expect(u2["status-9"]).toBe(1);
  });
});
