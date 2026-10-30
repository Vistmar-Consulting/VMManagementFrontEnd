// src/lib/boardChat/__tests__/proposal.test.js
import { describe, it, expect, vi } from "vitest";
import { buildReviewRows, toChangeSet } from "../proposal.js";
import { EDITABLE_FIELDS } from "../../itemWrites.js";

vi.mock("../../../firebase.js", () => ({ db: { name: "db" } }));

const NOW = "NOW";
const items = [
  { id: "p1", parentId: null, organizationId: "unio", title: "Appt data", statusId: 2, updatedAt: new Date(1000), assigneeIds: [] },
  { id: "s1", parentId: "p1", organizationId: "unio", title: "Import", statusId: 5, updatedAt: new Date(2000), assigneeIds: [] },
  { id: "s2", parentId: "p1", organizationId: "unio", title: "Schema", statusId: 1, updatedAt: new Date(9000), assigneeIds: [] },
];
const ctx = {
  items,
  orgIds: new Set(["unio"]),
  memberIds: new Set(["u1"]),
  categoryIds: new Set(["c1"]),
  tagIds: new Set(["t1"]),
  seen: { p1: 1000, s1: 2000, s2: 5000 },
  now: NOW,
};

describe("buildReviewRows", () => {
  it("a new assignee must be offered for the task's org; one already on it may stay", () => {
    const withPeople = {
      ...ctx,
      items: [{ ...items[0], assigneeIds: ["seo"] }, ...items.slice(1)],
      memberIds: new Set(["u1", "seo", "unio-contact", "bmd-contact"]),
      assignableIn: (org) => new Set(org === "unio" ? ["u1", "unio-contact"] : ["u1", "bmd-contact"]),
    };
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { assigneeIds: ["seo", "unio-contact"] } },
      { op: "update", itemId: "s1", reason: "r", fields: { assigneeIds: ["bmd-contact"] } },
      { op: "update", itemId: "s2", reason: "r", fields: { assigneeIds: ["seo"] } },
    ], withPeople);
    expect(rows[0].ok).toBe(true);
    expect(rows[1].ok).toBe(false);
    expect(rows[1].error).toMatch(/Can't assign bmd-contact/);
    expect(rows[2].ok).toBe(false);
  });

  it("moving to Done stamps completedAt; leaving Done clears it", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { statusId: 5 } },
      { op: "update", itemId: "s1", reason: "r", fields: { statusId: 2 } },
    ], ctx);
    expect(rows[0].patch).toEqual({ statusId: 5, completedAt: NOW });
    expect(rows[1].patch).toEqual({ statusId: 2, completedAt: null });
    expect(rows[0].diffs).toEqual([{ field: "statusId", before: 2, after: 5 }]);
  });

  it("flags an item changed since the model last saw it", () => {
    const rows = buildReviewRows([{ op: "update", itemId: "s2", reason: "r", fields: { title: "Schema v2" } }], ctx);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].stale).toBe(true);
  });

  it("rejects unknown ids, statuses and members", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "nope", reason: "r", fields: { title: "x" } },
      { op: "update", itemId: "p1", reason: "r", fields: { statusId: 8 } },
      { op: "update", itemId: "p1", reason: "r", fields: { assigneeIds: ["ghost"] } },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, false, false]);
    expect(rows[0].error).toMatch(/not found/);
  });

  it("rejects fields and clears outside the tool schema", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { organizationId: "other" } },
      { op: "update", itemId: "p1", reason: "r", clear: ["title"] },
      { op: "update", itemId: "p1", reason: "r", fields: { dueDate: "2026-10-30" }, clear: ["dueDate"] },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, false, false]);
    expect(rows[0].error).toMatch(/Unknown field organizationId/);
    expect(rows[1].error).toMatch(/Cannot clear title/);
    expect(rows[2].error).toMatch(/both set and cleared/);
  });

  it("rejects a second update on the same item", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "p1", reason: "r", fields: { title: "x" } },
      { op: "update", itemId: "p1", reason: "r", fields: { title: "y" } },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
    expect(rows[1].error).toMatch(/already has a change/);
  });

  it("rejects a second delete of the same item", () => {
    const rows = buildReviewRows([
      { op: "delete", itemId: "s1", reason: "r" },
      { op: "delete", itemId: "s1", reason: "r" },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
  });

  it("delete carries the cascade", () => {
    const [row] = buildReviewRows([{ op: "delete", itemId: "p1", reason: "r" }], ctx);
    expect(row.cascadeIds).toEqual(["s1", "s2"]);
  });

  it("creates: top-level needs orgId; subtask inherits parent org; tempId parents resolve", () => {
    const rows = buildReviewRows([
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Proj", dueDate: "2026-10-30" } },
      { op: "create", tempId: "b", parentRef: "a", reason: "r", fields: { title: "Step 1" } },
      { op: "create", tempId: "c", parentRef: "s1", reason: "r", fields: { title: "Nested" } },
      { op: "create", tempId: "d", reason: "r", fields: { title: "No org" } },
    ], ctx);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].fields.dueDate).toEqual(new Date(2026, 9, 30));
    expect(rows[0].fields.createdVia).toBe("board-chat");
    expect(rows[1]).toMatchObject({ ok: true, orgId: "unio", parentTempId: "a" });
    expect(rows[2].ok).toBe(false);
    expect(rows[3].ok).toBe(false);
  });

  it("a create already in Done stamps completedAt", () => {
    const [row] = buildReviewRows([{ op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Done one", statusId: 5 } }], ctx);
    expect(row.fields.completedAt).toBe(NOW);
  });

  it("clear nulls a field", () => {
    const [row] = buildReviewRows([{ op: "update", itemId: "p1", reason: "r", clear: ["dueDate"] }], { ...ctx, items: [{ ...items[0], dueDate: new Date(5) }] });
    expect(row.patch).toEqual({ dueDate: null });
  });
});

describe("buildReviewRows: conflicts with a delete", () => {
  const cases = [
    ["an update to the deleted item", { op: "update", itemId: "p1", reason: "r", fields: { title: "x" } }, /deleted by op/],
    ["an update to a cascade child", { op: "update", itemId: "s1", reason: "r", fields: { title: "x" } }, /deleted by op/],
    ["a create under the deleted parent", { op: "create", tempId: "n", parentRef: "p1", reason: "r", fields: { title: "New" } }, /being deleted/],
  ];
  const del = { op: "delete", itemId: "p1", reason: "r" };

  for (const [name, other, msg] of cases) {
    it(`rejects ${name} when the delete comes first`, () => {
      const rows = buildReviewRows([del, other], ctx);
      expect(rows[0].ok).toBe(true);
      expect(rows[1].ok).toBe(false);
      expect(rows[1].error).toMatch(msg);
    });

    it(`rejects ${name} when the delete comes second`, () => {
      const rows = buildReviewRows([other, del], ctx);
      expect(rows[1].ok).toBe(true);
      expect(rows[0].ok).toBe(false);
      expect(rows[0].error).toMatch(msg);
    });
  }

  it("the change set from conflicting ops holds only the delete", () => {
    const rows = buildReviewRows([
      { op: "update", itemId: "s1", reason: "r", fields: { title: "x" } },
      { op: "create", tempId: "n", parentRef: "p1", reason: "r", fields: { title: "New" } },
      del,
    ], ctx);
    const { ops } = toChangeSet(rows, new Set([0, 1, 2]));
    expect(ops).toEqual([{ kind: "delete", itemId: "p1", cascadeIds: ["s1", "s2"] }]);
  });
});

describe("buildReviewRows: parent and child deletes", () => {
  it("rejects the child delete when the parent delete comes first", () => {
    const rows = buildReviewRows([
      { op: "delete", itemId: "p1", reason: "r" },
      { op: "delete", itemId: "s1", reason: "r" },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
    expect(rows[1].error).toMatch(/already deleted by op 1/);
  });

  it("rejects the child delete when the parent delete comes second", () => {
    const rows = buildReviewRows([
      { op: "delete", itemId: "s1", reason: "r" },
      { op: "delete", itemId: "p1", reason: "r" },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, true]);
    expect(rows[0].error).toMatch(/already deleted by op 2/);
    const { ops } = toChangeSet(rows, new Set([0, 1]));
    expect(ops).toEqual([{ kind: "delete", itemId: "p1", cascadeIds: ["s1", "s2"] }]);
  });
});

describe("buildReviewRows: delete staleness", () => {
  it("is stale when a cascade child changed since the model saw it", () => {
    const [row] = buildReviewRows([{ op: "delete", itemId: "p1", reason: "r" }], ctx);
    expect(row.ok).toBe(true);
    expect(row.stale).toBe(true);
  });

  it("is stale when a cascade child was never seen", () => {
    const [row] = buildReviewRows([{ op: "delete", itemId: "p1", reason: "r" }], { ...ctx, seen: { p1: 1000, s1: 2000 }, items: items.slice(0, 2).concat({ ...items[2], updatedAt: new Date(1) }) });
    expect(row.stale).toBe(true);
  });

  it("is fresh when the parent and every child match what the model saw", () => {
    const [row] = buildReviewRows([{ op: "delete", itemId: "p1", reason: "r" }], { ...ctx, seen: { p1: 1000, s1: 2000, s2: 9000 } });
    expect(row.stale).toBe(false);
  });
});

describe("buildReviewRows: tempIds", () => {
  it("rejects a tempId that equals an existing item id", () => {
    const [row] = buildReviewRows([{ op: "create", tempId: "p1", orgId: "unio", reason: "r", fields: { title: "Clash" } }], ctx);
    expect(row.ok).toBe(false);
    expect(row.error).toMatch(/existing item/);
  });

  it("rejects a repeated tempId even when the first create failed validation", () => {
    const rows = buildReviewRows([
      { op: "create", tempId: "a", reason: "r", fields: { title: "No org" } },
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Valid" } },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, false]);
    expect(rows[1].error).toMatch(/Duplicate tempId a/);
  });
});

describe("buildReviewRows: value types", () => {
  const upd = (fields) => ({ op: "update", itemId: "p1", reason: "r", fields });
  it("rejects wrong types with a clear message", () => {
    const rows = buildReviewRows([
      upd({ title: 5 }),
      upd({ description: ["x"] }),
      upd({ assigneeIds: "u1" }),
      upd({ assigneeIds: [1] }),
      upd({ tagIds: "t1" }),
      upd({ statusId: "5" }),
      upd({ priorityId: "1" }),
      upd({ categoryId: 1 }),
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual(Array(8).fill(false));
    expect(rows[0].error).toBe("title must be a string");
    expect(rows[1].error).toBe("description must be a string");
    expect(rows[2].error).toBe("assigneeIds must be an array of strings");
    expect(rows[3].error).toBe("assigneeIds must be an array of strings");
    expect(rows[4].error).toBe("tagIds must be an array of strings");
    expect(rows[5].error).toMatch(/Status 5 is not allowed/);
    expect(rows[6].error).toMatch(/Priority 1 is not allowed/);
    expect(rows[7].error).toMatch(/Unknown category 1/);
  });

  it("rejects a due date that rolls over", () => {
    const rows = buildReviewRows([upd({ dueDate: "2026-02-31" }), upd({ dueDate: "2026-13-01" }), upd({ dueDate: "2028-02-29" })], ctx);
    expect(rows.map((r) => r.ok)).toEqual([false, false, true]);
    expect(rows[0].error).toMatch(/Bad dueDate "2026-02-31"/);
  });
});

describe("buildReviewRows: fallback tempIds", () => {
  it("never collide with a tempId the model supplied", () => {
    const rows = buildReviewRows([
      { op: "create", orgId: "unio", reason: "r", fields: { title: "No temp" } },
      { op: "create", tempId: "op0", orgId: "unio", reason: "r", fields: { title: "Named op0" } },
      { op: "create", tempId: "x", parentRef: "op0", reason: "r", fields: { title: "Under named" } },
    ], ctx);
    expect(rows.map((r) => r.ok)).toEqual([true, true, true]);
    expect(rows[0].tempId).not.toBe("op0");
    expect(rows[2].parentTempId).toBe("op0");
    const tempIds = rows.map((r) => r.tempId);
    expect(new Set(tempIds).size).toBe(tempIds.length);
  });

  it("stay unique when the model supplies the next candidate too", () => {
    const rows = buildReviewRows([
      { op: "create", orgId: "unio", reason: "r", fields: { title: "No temp" } },
      { op: "create", tempId: "op0", orgId: "unio", reason: "r", fields: { title: "A" } },
      { op: "create", tempId: "op0_1", orgId: "unio", reason: "r", fields: { title: "B" } },
    ], ctx);
    const tempIds = rows.map((r) => r.tempId);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(new Set(tempIds).size).toBe(3);
  });
});

describe("toChangeSet", () => {
  it("keeps checked rows and drops children of an unchecked parent create", () => {
    const rows = buildReviewRows([
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: { title: "Proj" } },
      { op: "create", tempId: "b", parentRef: "a", reason: "r", fields: { title: "Step" } },
      { op: "update", itemId: "p1", reason: "r", fields: { title: "Renamed" } },
    ], ctx);
    const { ops, skipped } = toChangeSet(rows, new Set([1, 2]));
    expect(ops).toEqual([{ kind: "update", itemId: "p1", patch: { title: "Renamed" } }]);
    expect(skipped).toEqual([{ index: 1, reason: "its parent create was not applied" }]);
  });

  it("emits only fields the writer accepts", () => {
    const all = { title: "T", description: "D", statusId: 5, assigneeIds: ["u1"], dueDate: "2026-11-01", priorityId: 1, categoryId: "c1", tagIds: ["t1"] };
    const rows = buildReviewRows([
      { op: "create", tempId: "a", orgId: "unio", reason: "r", fields: all },
      { op: "create", tempId: "b", parentRef: "a", reason: "r", fields: { title: "Step", statusId: 2 } },
      { op: "create", tempId: "c", parentRef: "p1", reason: "r", fields: { title: "Under p1" } },
      { op: "update", itemId: "p1", reason: "r", fields: all },
      { op: "update", itemId: "s1", reason: "r", fields: { statusId: 2 } },
      { op: "update", itemId: "s2", reason: "r", fields: { title: "S" }, clear: ["dueDate", "priorityId", "categoryId"] },
    ], ctx);
    expect(rows.every((r) => r.ok)).toBe(true);
    const { ops } = toChangeSet(rows, new Set(rows.map((r) => r.index)));
    expect(ops).toHaveLength(6);
    for (const o of ops) {
      const allowed = o.kind === "create" ? [...EDITABLE_FIELDS, "createdVia"] : EDITABLE_FIELDS;
      const keys = Object.keys(o.kind === "create" ? o.fields : o.patch);
      expect(keys.filter((k) => !allowed.includes(k))).toEqual([]);
    }
  });
});
