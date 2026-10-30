import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every Firestore write so each edit can be checked for its stamp.
const writes = [];
vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  serverTimestamp: () => "TS",
  // doc(collection(...)) with no id is a new doc: give it the id "new".
  doc: (base, ...path) => (path.length ? { path: path.join("/"), id: path.at(-1) } : { path: `${base.path}/new`, id: "new" }),
  collection: (_db, ...path) => ({ path: path.join("/") }),
  updateDoc: async (ref, data) => { writes.push(["update", ref.path, data]); },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(["set", ref.path, data]),
      update: (ref, data) => ops.push(["update", ref.path, data]),
      delete: (ref) => ops.push(["delete", ref.path]),
      commit: async () => { writes.push(...ops); },
    };
  },
}));

const { addTopic, deleteTopic, editAgenda, editTopic } = await import("../agendaEdits.js");
const stamp = { lastEditedAt: "TS", lastEditedByUid: "u1" };

beforeEach(() => { writes.length = 0; });

describe("agenda edits stamp who edited the agenda last", () => {
  it("a topic edit updates the topic and stamps the agenda, in one batch", async () => {
    await editTopic("a1", "t1", { bodyHtml: "<p>x</p>" }, "u1");
    expect(writes).toEqual([
      ["update", "agendas/a1/topics/t1", { bodyHtml: "<p>x</p>", updatedAt: "TS", updatedByUid: "u1" }],
      ["update", "agendas/a1", stamp],
    ]);
  });

  it("adding and deleting a topic stamp the agenda", async () => {
    const id = await addTopic("a1", { name: "New Topic", sortOrder: 2 }, "u1");
    expect(id).toBe("new");
    expect(writes).toEqual([
      ["set", "agendas/a1/topics/new", { name: "New Topic", sortOrder: 2, createdAt: "TS", updatedAt: "TS", createdByUid: "u1" }],
      ["update", "agendas/a1", stamp],
    ]);

    writes.length = 0;
    await deleteTopic("a1", "t1", "u1");
    expect(writes).toEqual([["delete", "agendas/a1/topics/t1"], ["update", "agendas/a1", stamp]]);
  });

  it("an agenda field edit carries the stamp on the same write", async () => {
    await editAgenda("a1", { openFloorHtml: "<p>y</p>" }, "u1");
    expect(writes).toEqual([["update", "agendas/a1", { openFloorHtml: "<p>y</p>", updatedAt: "TS", updatedByUid: "u1", ...stamp }]]);
  });
});
