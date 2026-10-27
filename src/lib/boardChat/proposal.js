// src/lib/boardChat/proposal.js
//
// Turns a propose_changes call into review rows for the change modal, then
// the accepted rows into a change set for itemWrites.applyChangeSet. Pure.
//
// Rules: one op per item; only existing members/orgs/categories/tags; status
// in the allowed set (never AI Gen); subtasks only under top-level items.
// A delete wins over any op that touches what it removes: an update to the
// item or a cascade child, or a create under it, is rejected in either order,
// so applyChangeSet never sees a conflicting set.
// Moving to Done stamps completedAt and leaving Done clears it — Board Chat
// only (the board's manual edits are unchanged).
import { STATUS } from "../../constants/itemStatuses.js";
import { toMillis } from "./snapshot.js";

export const ALLOWED_STATUS_IDS = [1, 2, 9, 4, 5, 7];
const PRIORITY_IDS = [1, 2, 3, 4];
const FIELD_KEYS = ["title", "description", "statusId", "assigneeIds", "dueDate", "priorityId", "categoryId", "tagIds"];
const CLEARABLE = ["dueDate", "priorityId", "categoryId"];

export function parseDueDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) throw new Error(`Bad dueDate "${s}" (want YYYY-MM-DD)`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function normalizeFields(fields = {}, ctx) {
  const unknown = Object.keys(fields).filter((k) => !FIELD_KEYS.includes(k));
  if (unknown.length) throw new Error(`Unknown field ${unknown.join(", ")}`);
  const out = {};
  if (fields.title !== undefined) {
    if (!fields.title.trim()) throw new Error("Title cannot be empty");
    out.title = fields.title.trim();
  }
  if (fields.description !== undefined) out.description = fields.description;
  if (fields.statusId !== undefined) {
    if (!ALLOWED_STATUS_IDS.includes(fields.statusId)) throw new Error(`Status ${fields.statusId} is not allowed`);
    out.statusId = fields.statusId;
  }
  if (fields.assigneeIds !== undefined) {
    const bad = fields.assigneeIds.filter((id) => !ctx.memberIds.has(id));
    if (bad.length) throw new Error(`Unknown member ${bad.join(", ")}`);
    out.assigneeIds = fields.assigneeIds;
  }
  if (fields.dueDate !== undefined) out.dueDate = parseDueDate(fields.dueDate);
  if (fields.priorityId !== undefined) {
    if (!PRIORITY_IDS.includes(fields.priorityId)) throw new Error(`Priority ${fields.priorityId} is not allowed`);
    out.priorityId = fields.priorityId;
  }
  if (fields.categoryId !== undefined) {
    if (!ctx.categoryIds.has(fields.categoryId)) throw new Error(`Unknown category ${fields.categoryId}`);
    out.categoryId = fields.categoryId;
  }
  if (fields.tagIds !== undefined) {
    const bad = fields.tagIds.filter((id) => !ctx.tagIds.has(id));
    if (bad.length) throw new Error(`Unknown tag ${bad.join(", ")}`);
    out.tagIds = fields.tagIds;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  || (a instanceof Date || b instanceof Date ? toMillis(a) === toMillis(b) : false);

// A create with no tempId gets `op<index>`, suffixed until it matches no
// tempId the model supplied and no earlier fallback.
function makeFallbackTempId(ops) {
  const taken = new Set(ops.filter((o) => o.op === "create" && o.tempId).map((o) => o.tempId));
  return (index) => {
    let id = `op${index}`;
    for (let n = 1; taken.has(id); n += 1) id = `op${index}_${n}`;
    taken.add(id);
    return id;
  };
}

function buildRow(op, index, ctx, itemsById, childrenOf, tempCreates, fallbackTempId) {
  const base = { index, op: op.op, reason: op.reason, ok: true, error: null, stale: false };

  if (op.op === "create") {
    const fields = { ...normalizeFields(op.fields, ctx), createdVia: "board-chat" };
    if (!fields.title) throw new Error("A new item needs a title");
    if (fields.statusId === STATUS.DONE) fields.completedAt = ctx.now;
    if (op.tempId && tempCreates.has(op.tempId)) throw new Error(`Duplicate tempId ${op.tempId}`);
    const tempId = op.tempId || fallbackTempId(index);
    let row;
    if (op.parentRef) {
      const parentItem = itemsById.get(op.parentRef);
      const parentTemp = tempCreates.get(op.parentRef);
      if (parentItem) {
        if (parentItem.parentId) throw new Error("Subtasks cannot have subtasks");
        row = { ...base, tempId, orgId: parentItem.organizationId, parentId: parentItem.id, parentTempId: null, fields };
      } else if (parentTemp) {
        if (parentTemp.parentId || parentTemp.parentTempId) throw new Error("Subtasks cannot have subtasks");
        row = { ...base, tempId, orgId: parentTemp.orgId, parentId: null, parentTempId: parentTemp.tempId, fields };
      } else {
        throw new Error(`Parent ${op.parentRef} not found`);
      }
    } else {
      if (!ctx.orgIds.has(op.orgId)) throw new Error(`Organization ${op.orgId || "(none)"} not found`);
      row = { ...base, tempId, orgId: op.orgId, parentId: null, parentTempId: null, fields };
    }
    tempCreates.set(row.tempId, row);
    return row;
  }

  const item = itemsById.get(op.itemId);
  if (!item) throw new Error(`Item ${op.itemId} not found`);
  const seen = ctx.seen[item.id];
  const stale = seen == null || (toMillis(item.updatedAt) ?? 0) > seen;

  if (op.op === "delete") {
    return { ...base, stale, itemId: item.id, cascadeIds: (childrenOf.get(item.id) || []).map((c) => c.id) };
  }

  const clear = op.clear || [];
  const badClear = clear.filter((f) => !CLEARABLE.includes(f));
  if (badClear.length) throw new Error(`Cannot clear ${badClear.join(", ")}`);
  const both = clear.filter((f) => op.fields?.[f] !== undefined);
  if (both.length) throw new Error(`${both.join(", ")} is both set and cleared`);
  const patch = normalizeFields(op.fields, ctx);
  for (const f of clear) patch[f] = null;
  if (patch.statusId !== undefined && patch.statusId !== item.statusId) {
    if (patch.statusId === STATUS.DONE) patch.completedAt = ctx.now;
    else if (item.statusId === STATUS.DONE) patch.completedAt = null;
  }
  const diffs = Object.keys(patch)
    .filter((f) => f !== "completedAt" && !same(item[f], patch[f]))
    .map((f) => ({ field: f, before: item[f] ?? null, after: patch[f] }));
  if (diffs.length === 0) throw new Error("No change from the current values");
  return { ...base, stale, itemId: item.id, patch, diffs };
}

// Second pass over the valid rows: one update/delete per item, and nothing
// that touches an item a delete removes. Deletes are collected first so the
// order of ops in the proposal does not matter.
function rejectConflicts(rows) {
  const reject = (row, error) => ({ ...row, ok: false, error });
  const removedBy = new Map();
  const deleted = new Set();
  const out = rows.map((row) => {
    if (!row.ok || row.op !== "delete") return row;
    if (deleted.has(row.itemId)) return reject(row, `${row.itemId} already has a change in this proposal`);
    deleted.add(row.itemId);
    for (const id of [row.itemId, ...row.cascadeIds]) if (!removedBy.has(id)) removedBy.set(id, row.index);
    return row;
  });
  const updated = new Set();
  return out.map((row) => {
    if (!row.ok) return row;
    if (row.op === "update") {
      if (removedBy.has(row.itemId)) return reject(row, `${row.itemId} is deleted by op ${removedBy.get(row.itemId) + 1} in this proposal`);
      if (updated.has(row.itemId)) return reject(row, `${row.itemId} already has a change in this proposal`);
      updated.add(row.itemId);
    }
    if (row.op === "create" && row.parentId && removedBy.has(row.parentId)) {
      return reject(row, `Cannot add a subtask under ${row.parentId}; it is being deleted by op ${removedBy.get(row.parentId) + 1}`);
    }
    return row;
  });
}

export function buildReviewRows(ops, ctx) {
  const itemsById = new Map(ctx.items.map((i) => [i.id, i]));
  const childrenOf = new Map();
  for (const i of ctx.items) {
    if (i.parentId) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) || []), i]);
  }
  const tempCreates = new Map();
  const fallbackTempId = makeFallbackTempId(ops);
  const rows = ops.map((op, index) => {
    try {
      return buildRow(op, index, ctx, itemsById, childrenOf, tempCreates, fallbackTempId);
    } catch (err) {
      return { index, op: op.op, reason: op.reason, itemId: op.itemId, ok: false, error: err.message, stale: false };
    }
  });
  return rejectConflicts(rows);
}

// Accepted rows → applyChangeSet ops. A create whose tempId parent was not
// accepted is skipped and reported.
export function toChangeSet(rows, checked) {
  const ops = [];
  const skipped = [];
  const acceptedTemps = new Set();
  for (const r of rows) {
    if (!r.ok || !checked.has(r.index)) continue;
    if (r.op === "create") {
      if (r.parentTempId && !acceptedTemps.has(r.parentTempId)) {
        skipped.push({ index: r.index, reason: "its parent create was not applied" });
        continue;
      }
      acceptedTemps.add(r.tempId);
      ops.push({ kind: "create", tempId: r.tempId, orgId: r.orgId, parentId: r.parentId, parentTempId: r.parentTempId, fields: r.fields });
    } else if (r.op === "update") {
      ops.push({ kind: "update", itemId: r.itemId, patch: r.patch });
    } else {
      ops.push({ kind: "delete", itemId: r.itemId, cascadeIds: r.cascadeIds });
    }
  }
  return { ops, skipped };
}
