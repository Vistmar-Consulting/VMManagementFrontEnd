// src/lib/__tests__/itemWrites.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes = [];
let docsById = {};
let idSeq = 0;

vi.mock("../../firebase.js", () => ({ db: { name: "db" } }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ collection: name }),
  doc: (a, b, c) => {
    if (a && a.collection && b === undefined) return { id: `new${++idSeq}`, path: `${a.collection}/new${idSeq}` };
    return { id: c, path: `${b}/${c}` };
  },
  serverTimestamp: () => "TS",
  updateDoc: async (ref, data) => { writes.push(["update", ref.path, data]); },
  writeBatch: () => ({
    delete: (ref) => writes.push(["delete", ref.path]),
    commit: async () => {},
  }),
  runTransaction: async (_db, fn) => fn({
    get: async (ref) => ({ exists: () => ref.path in docsById, data: () => docsById[ref.path] }),
    set: (ref, data) => writes.push(["set", ref.path, data]),
    update: (ref, data) => writes.push(["update", ref.path, data]),
    delete: (ref) => writes.push(["delete", ref.path]),
  }),
}));

const W = await import("../itemWrites.js");

beforeEach(() => { writes.length = 0; docsById = {}; idSeq = 0; });

const BLANK = {
  hasChildren: false, type: "task", title: "", description: "", statusId: 1,
  priorityId: null, categoryId: null, tagIds: [], dueDate: null, completedAt: null,
  assigneeIds: [], createdBy: "u1", createdAt: "TS", updatedAt: "TS",
};

describe("itemWrites — today's board writes", () => {
  it("createTopLevelItem allocates the org counter and writes a blank task", async () => {
    docsById["organizations/unio"] = { nextItemNumber: 7 };
    const ref = W.newItemRef();
    await W.createTopLevelItem({ ref, orgId: "unio", uid: "u1", order: "a5" });
    expect(writes).toEqual([
      ["set", "items/new1", { ...BLANK, organizationId: "unio", parentId: null, itemNumber: 7, order: "a5" }],
      ["update", "organizations/unio", { nextItemNumber: 8 }],
    ]);
  });

  it("createSubitem allocates the parent counter and marks hasChildren", async () => {
    docsById["items/p1"] = { nextSubitemNumber: 3 };
    const ref = W.newItemRef();
    await W.createSubitem({ ref, parent: { id: "p1", organizationId: "unio" }, uid: "u1", order: "a1" });
    expect(writes).toEqual([
      ["set", "items/new1", { ...BLANK, organizationId: "unio", parentId: "p1", itemNumber: 3, order: "a1" }],
      ["update", "items/p1", { nextSubitemNumber: 4, hasChildren: true, updatedAt: "TS" }],
    ]);
  });

  it("counters default to 1 when missing", async () => {
    docsById["organizations/unio"] = {};
    await W.createTopLevelItem({ ref: W.newItemRef(), orgId: "unio", uid: "u1", order: "a0" });
    expect(writes[0][2].itemNumber).toBe(1);
    expect(writes[1][2]).toEqual({ nextItemNumber: 2 });
  });

  it("updateItem stamps updatedAt only", async () => {
    await W.updateItem("i1", { statusId: 5 });
    expect(writes).toEqual([["update", "items/i1", { statusId: 5, updatedAt: "TS" }]]);
  });

  it("deleteItemCascade deletes subitems then the item in one batch", async () => {
    await W.deleteItemCascade("p1", ["s1", "s2"]);
    expect(writes).toEqual([["delete", "items/s1"], ["delete", "items/s2"], ["delete", "items/p1"]]);
  });

  it("order helpers append after the last key", () => {
    const items = [
      { id: "a", parentId: null, order: "a0" },
      { id: "b", parentId: null, order: "a1" },
      { id: "c", parentId: "a", order: "a0" },
    ];
    expect(W.nextTopLevelOrder(items) > "a1").toBe(true);
    expect(W.nextSubitemOrder(items, "a") > "a0").toBe(true);
    expect(W.nextSubitemOrder(items, "b")).toBe("a0");
  });
});
