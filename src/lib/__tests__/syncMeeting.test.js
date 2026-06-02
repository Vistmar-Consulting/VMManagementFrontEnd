import { describe, it, expect } from "vitest";
import { mintTopicIds, validateProposal, inheritKeysForCreate } from "../syncMeeting.js";

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

  it("rejects a create whose topic has no category to inherit", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "NoCat", topicId: "t2", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates.map((c) => c.title)).toEqual(["NoCat"]);
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
