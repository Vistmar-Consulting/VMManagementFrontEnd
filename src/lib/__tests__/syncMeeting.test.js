import { describe, it, expect } from "vitest";
import { mintTopicIds, validateProposal, inheritKeysForCreate, normalizeTopicRefs, classifyTopicChanges } from "../syncMeeting.js";

const topics = [
  { name: "Website", categoryIds: ["website"], tagIds: ["t-hours"] },
  { name: "GBP", categoryIds: ["gbp-directories"], tagIds: ["t-hours", "t-photos"] },
  { name: "Empty", categoryIds: [], tagIds: [] },
];

describe("mintTopicIds", () => {
  it("assigns stable t0..tN ids preserving order", () => {
    const out = mintTopicIds(topics);
    expect(out.map((t) => t.topicId)).toEqual(["t0", "t1", "t2"]);
    expect(out[0].name).toBe("Website");
  });
});

describe("validateProposal", () => {
  const existingTasks = [{ id: "item-1", title: "Old task" }];
  const withIds = mintTopicIds(topics);

  it("accepts a create whose topicId resolves to a topic with a category", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "New", topicId: "t0", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toEqual([]);
    expect(r.acceptedCreates.map((c) => c.title)).toEqual(["New"]);
  });

  it("rejects a create whose topicId is missing from the proposal", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "Orphan", topicId: "t9", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates.map((c) => c.title)).toEqual(["Orphan"]);
    expect(r.rejectedCreates[0].reason).toMatch(/topic/i);
  });

  it("accepts a create whose topic has no category (categoryId lands null)", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "NoCat", topicId: "t2", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(0);
    expect(r.acceptedCreates.map((c) => c.title)).toEqual(["NoCat"]);
  });

  it("drops moves/notes referencing unknown itemIds", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [],
        moves: [{ itemId: "item-1", title: "Old task", toStatus: "Done", reason: "shipped" },
                { itemId: "ghost", title: "x", toStatus: "Done", reason: "y" }],
        notes: [{ itemId: "ghost", title: "x", note: "n" }],
      },
      existingTasks,
    });
    expect(r.acceptedMoves.map((m) => m.itemId)).toEqual(["item-1"]);
    expect(r.droppedMoves.map((m) => m.itemId)).toEqual(["ghost"]);
    expect(r.droppedNotes.map((n) => n.itemId)).toEqual(["ghost"]);
  });

  it("drops moves with an unknown toStatus", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [], notes: [],
        moves: [{ itemId: "item-1", title: "Old task", toStatus: "Frozen", reason: "x" }],
      },
      existingTasks,
    });
    expect(r.acceptedMoves).toEqual([]);
    expect(r.droppedMoves.map((m) => m.itemId)).toEqual(["item-1"]);
  });
});

describe("inheritKeysForCreate", () => {
  it("inherits the owning topic's first category and all tags", () => {
    const withIds = mintTopicIds(topics);
    const byId = Object.fromEntries(withIds.map((t) => [t.topicId, t]));
    const keys = inheritKeysForCreate({ topicId: "t1" }, byId);
    expect(keys).toEqual({ categoryId: "gbp-directories", tagIds: ["t-hours", "t-photos"] });
  });
});

describe("normalizeTopicRefs", () => {
  const current = ["docA", "docB"];

  it("keeps a ref that matches a current topic id", () => {
    const out = normalizeTopicRefs([{ ref: "docA", name: "x" }], current);
    expect(out[0].ref).toBe("docA");
  });

  it("downgrades an unknown ref to empty string", () => {
    const out = normalizeTopicRefs([{ ref: "ghost", name: "x" }], current);
    expect(out[0].ref).toBe("");
  });

  it("treats empty/missing ref as new (empty string)", () => {
    const out = normalizeTopicRefs([{ name: "x" }, { ref: "", name: "y" }], current);
    expect(out[0].ref).toBe("");
    expect(out[1].ref).toBe("");
  });

  it("preserves other topic fields (e.g. topicId)", () => {
    const out = normalizeTopicRefs([{ ref: "docB", topicId: "t3", name: "z" }], current);
    expect(out[0]).toMatchObject({ ref: "docB", topicId: "t3", name: "z" });
  });

  it("returns [] for empty input", () => {
    expect(normalizeTopicRefs(undefined, current)).toEqual([]);
  });
});

describe("classifyTopicChanges", () => {
  const current = [
    { id: "docA", name: "Alpha" },
    { id: "docB", name: "Beta" },
  ];

  it("marks a ref'd proposal topic as retained and a ref-less one as new", () => {
    const { statuses } = classifyTopicChanges(current, [
      { ref: "docA", name: "Alpha" },
      { ref: "", name: "Gamma" },
    ]);
    expect(statuses).toEqual(["retained", "new"]);
  });

  it("lists current topics not referenced by any proposal topic as dropped", () => {
    const { dropped } = classifyTopicChanges(current, [{ ref: "docA", name: "Alpha" }]);
    expect(dropped).toEqual([{ id: "docB", name: "Beta" }]);
  });

  it("treats an unknown ref as new (not retained) and the real topic as dropped", () => {
    const { statuses, dropped } = classifyTopicChanges(current, [{ ref: "ghost", name: "X" }]);
    expect(statuses).toEqual(["new"]);
    expect(dropped.map((d) => d.id).sort()).toEqual(["docA", "docB"]);
  });

  it("handles empty inputs", () => {
    expect(classifyTopicChanges([], [])).toEqual({ statuses: [], dropped: [] });
  });
});
