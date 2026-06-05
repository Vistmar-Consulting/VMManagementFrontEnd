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

describe("validateProposal — parentRef", () => {
  const existingTasks = [
    { id: "item-A", title: "Existing top-level" },
    { id: "item-B", title: "Another existing" },
  ];
  const withIds = mintTopicIds([{ name: "Topic", categoryIds: ["web"], tagIds: [] }]);

  function mkCreate(title, parentRef = "") {
    return { title, topicId: "t0", note: "", ...(parentRef ? { parentRef } : {}) };
  }

  it("accepts a create with no parentRef (top-level)", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [mkCreate("Task A")], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(0);
    expect(r.acceptedCreates).toHaveLength(1);
  });

  it("accepts a create whose parentRef is an existing board item", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [mkCreate("Sub", "item-A")], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(0);
    expect(r.acceptedCreates).toHaveLength(1);
  });

  it("rejects a create whose parentRef itemId is not on the board", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [mkCreate("Sub", "item-ghost")], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(1);
    expect(r.rejectedCreates[0].reason).toMatch(/parentRef itemId not found/i);
  });

  it("accepts a create with parentRef new:0 pointing to a valid top-level create", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [mkCreate("Parent task"), mkCreate("Child task", "new:0")],
        moves: [], notes: [],
      },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(0);
    expect(r.acceptedCreates).toHaveLength(2);
  });

  it("rejects parentRef new:N when N is out of range", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [mkCreate("Only", "new:5")], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(1);
    expect(r.rejectedCreates[0].reason).toMatch(/out of range/i);
  });

  it("rejects parentRef self-reference (new:N where N = own index)", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [mkCreate("Self", "new:0")], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(1);
    expect(r.rejectedCreates[0].reason).toMatch(/self-reference/i);
  });

  it("rejects parentRef that would exceed single nesting depth", () => {
    // creates[1] has parentRef "new:0", so creates[2] cannot use "new:1"
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [
          mkCreate("Top"),
          mkCreate("Mid", "new:0"),
          mkCreate("Bottom", "new:1"),   // parent (creates[1]) has a parentRef → reject
        ],
        moves: [], notes: [],
      },
      existingTasks,
    });
    expect(r.rejectedCreates).toHaveLength(1);
    expect(r.rejectedCreates[0].title).toBe("Bottom");
    expect(r.rejectedCreates[0].reason).toMatch(/nesting depth/i);
  });

  it("second-pass rejects a subitem whose intra-run parent was itself rejected (forward ref)", () => {
    // creates[0] references creates[1] as parent (forward ref)
    // creates[1] has an invalid topicId → rejected in main pass
    // creates[0] should be rejected in second pass
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [
          mkCreate("Child forward", "new:1"),   // forward ref to creates[1]
          { title: "Parent bad topic", topicId: "t-gone", note: "" },  // will be rejected (bad topicId)
        ],
        moves: [], notes: [],
      },
      existingTasks,
    });
    // creates[1] rejected (bad topic), creates[0] rejected (target rejected)
    expect(r.rejectedCreates).toHaveLength(2);
    const childRejection = r.rejectedCreates.find((c) => c.title === "Child forward");
    expect(childRejection?.reason).toMatch(/target was rejected/i);
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
