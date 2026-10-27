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
    commit: async () => { writes.push(["commit"]); },
  }),
  runTransaction: async (_db, fn) => fn({
    get: async (ref) => ({ exists: () => ref.path in docsById, data: () => docsById[ref.path] }),
    set: (ref, data) => writes.push(["tx:set", ref.path, data]),
    update: (ref, data) => writes.push(["tx:update", ref.path, data]),
    delete: (ref) => writes.push(["tx:delete", ref.path]),
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
      ["tx:set", "items/new1", { ...BLANK, organizationId: "unio", parentId: null, itemNumber: 7, order: "a5" }],
      ["tx:update", "organizations/unio", { nextItemNumber: 8 }],
    ]);
  });

  it("createSubitem allocates the parent counter and marks hasChildren", async () => {
    docsById["items/p1"] = { nextSubitemNumber: 3 };
    const ref = W.newItemRef();
    await W.createSubitem({ ref, parent: { id: "p1", organizationId: "unio" }, uid: "u1", order: "a1" });
    expect(writes).toEqual([
      ["tx:set", "items/new1", { ...BLANK, organizationId: "unio", parentId: "p1", itemNumber: 3, order: "a1" }],
      ["tx:update", "items/p1", { nextSubitemNumber: 4, hasChildren: true, updatedAt: "TS" }],
    ]);
  });

  it("counters default to 1 when missing", async () => {
    docsById["organizations/unio"] = {};
    await W.createTopLevelItem({ ref: W.newItemRef(), orgId: "unio", uid: "u1", order: "a0" });
    expect(writes[0][2].itemNumber).toBe(1);
    expect(writes[1]).toEqual(["tx:update", "organizations/unio", { nextItemNumber: 2 }]);
  });

  it("updateItem stamps updatedAt only", async () => {
    await W.updateItem("i1", { statusId: 5 });
    expect(writes).toEqual([["update", "items/i1", { statusId: 5, updatedAt: "TS" }]]);
  });

  it("deleteItemCascade deletes subitems then the item in one batch", async () => {
    await W.deleteItemCascade("p1", ["s1", "s2"]);
    expect(writes).toEqual([["delete", "items/s1"], ["delete", "items/s2"], ["delete", "items/p1"], ["commit"]]);
  });

  it("blankItem fields cannot override identity fields", () => {
    const item = W.blankItem({
      organizationId: "unio", parentId: null, itemNumber: 1, uid: "u1", order: "a0",
      fields: { title: "ok", organizationId: "x", order: "zz", itemNumber: 99, createdBy: "evil" },
    });
    expect(item).toMatchObject({ title: "ok", organizationId: "unio", order: "a0", itemNumber: 1, createdBy: "u1" });
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

describe("applyChangeSet", () => {
  const allItems = [
    { id: "p1", parentId: null, order: "a0", organizationId: "unio" },
    { id: "s1", parentId: "p1", order: "a0", organizationId: "unio" },
  ];

  it("creates a project with two subtasks, numbering each correctly", async () => {
    docsById["organizations/unio"] = { nextItemNumber: 4 };
    const results = await W.applyChangeSet([
      { kind: "create", tempId: "t1", orgId: "unio", parentId: null, parentTempId: null, fields: { title: "Appt data", createdVia: "board-chat" } },
      { kind: "create", tempId: "t2", orgId: "unio", parentId: null, parentTempId: "t1", fields: { title: "Schema", createdVia: "board-chat" } },
      { kind: "create", tempId: "t3", orgId: "unio", parentId: null, parentTempId: "t1", fields: { title: "Import", createdVia: "board-chat" } },
    ], { uid: "u1", allItems });

    const sets = writes.filter((w) => w[0] === "tx:set");
    expect(sets.map((s) => [s[1], s[2].title, s[2].itemNumber, s[2].parentId])).toEqual([
      ["items/new1", "Appt data", 4, null],
      ["items/new2", "Schema", 1, "new1"],
      ["items/new3", "Import", 2, "new1"],
    ]);
    expect(sets[0][2].hasChildren).toBe(true);
    expect(sets[0][2].nextSubitemNumber).toBe(3);
    expect(sets[1][2].order < sets[2][2].order).toBe(true);
    expect(writes).toContainEqual(["tx:update", "organizations/unio", { nextItemNumber: 5 }]);
    expect(results).toEqual([
      { tempId: "t1", itemId: "new1", ref: "I-4" },
      { tempId: "t2", itemId: "new2", ref: "SI-1" },
      { tempId: "t3", itemId: "new3", ref: "SI-2" },
    ]);
  });

  it("adds a subtask under an existing parent using its counter", async () => {
    docsById["items/p1"] = { nextSubitemNumber: 2 };
    const results = await W.applyChangeSet([
      { kind: "create", tempId: "t1", orgId: "unio", parentId: "p1", parentTempId: null, fields: { title: "New sub" } },
    ], { uid: "u1", allItems });
    expect(writes).toContainEqual(["tx:update", "items/p1", { nextSubitemNumber: 3, hasChildren: true, updatedAt: "TS" }]);
    expect(results[0].ref).toBe("SI-2");
  });

  it("applies updates and cascade deletes", async () => {
    docsById["items/p1"] = {};
    docsById["items/x9"] = {};
    await W.applyChangeSet([
      { kind: "update", itemId: "x9", patch: { statusId: 5, completedAt: "NOW" } },
      { kind: "delete", itemId: "p1", cascadeIds: ["s1"] },
    ], { uid: "u1", allItems });
    expect(writes).toEqual([
      ["tx:update", "items/x9", { statusId: 5, completedAt: "NOW", updatedAt: "TS" }],
      ["tx:delete", "items/s1"],
      ["tx:delete", "items/p1"],
    ]);
  });

  it("refuses the whole set when a target no longer exists", async () => {
    await expect(W.applyChangeSet([
      { kind: "update", itemId: "gone", patch: { title: "x" } },
    ], { uid: "u1", allItems })).rejects.toThrow("gone no longer exists");
    expect(writes).toEqual([]);
  });

  it("rejects an update patch key outside EDITABLE_FIELDS", async () => {
    docsById["items/x9"] = {};
    await expect(W.applyChangeSet([
      { kind: "update", itemId: "x9", patch: { organizationId: "other" } },
    ], { uid: "u1", allItems })).rejects.toThrow("Unsupported field organizationId on update x9");
    expect(writes).toEqual([]);
  });

  it("rejects a create fields key outside EDITABLE_FIELDS", async () => {
    docsById["organizations/unio"] = { nextItemNumber: 1 };
    await expect(W.applyChangeSet([
      { kind: "create", tempId: "t1", orgId: "unio", parentId: null, parentTempId: null, fields: { title: "x", itemNumber: 99 } },
    ], { uid: "u1", allItems })).rejects.toThrow("Unsupported field itemNumber on create t1");
    expect(writes).toEqual([]);
  });
});
