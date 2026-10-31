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
// Tags and categories can be created, changed and deleted in the same
// proposal (taxonomy.js); items may use a new one by its tempId, and may not
// use one the proposal deletes. One op per tag or category.
import { STATUS } from "../../constants/itemStatuses.js";
import { tagsForOrg } from "../tagScope.js";
import { toMillis } from "./snapshot.js";
import { TAXONOMY_OPS, buildTaxonomyRow, taxonomyAfter } from "./taxonomy.js";

export const ALLOWED_STATUS_IDS = [1, 2, 9, 4, 5, 7];
const PRIORITY_IDS = [1, 2, 3, 4];
const FIELD_KEYS = ["title", "description", "statusId", "assigneeIds", "dueDate", "priorityId", "categoryId", "tagIds"];
const CLEARABLE = ["dueDate", "priorityId", "categoryId"];

// The y/m/d must round-trip, so "2026-02-31" is rejected rather than rolling
// over to March 3.
export function parseDueDate(s) {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!d || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    throw new Error(`Bad dueDate "${s}" (want a real YYYY-MM-DD date)`);
  }
  return d;
}

function assertString(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new Error(`${name} must be an array of strings`);
}

function normalizeFields(fields = {}, ctx) {
  const unknown = Object.keys(fields).filter((k) => !FIELD_KEYS.includes(k));
  if (unknown.length) throw new Error(`Unknown field ${unknown.join(", ")}`);
  const out = {};
  if (fields.title !== undefined) {
    assertString(fields.title, "title");
    if (!fields.title.trim()) throw new Error("Title cannot be empty");
    out.title = fields.title.trim();
  }
  if (fields.description !== undefined) {
    assertString(fields.description, "description");
    out.description = fields.description;
  }
  if (fields.statusId !== undefined) {
    if (!ALLOWED_STATUS_IDS.includes(fields.statusId)) throw new Error(`Status ${fields.statusId} is not allowed`);
    out.statusId = fields.statusId;
  }
  if (fields.assigneeIds !== undefined) {
    assertStringArray(fields.assigneeIds, "assigneeIds");
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
    assertStringArray(fields.tagIds, "tagIds");
    const bad = fields.tagIds.filter((id) => !ctx.tagIds.has(id));
    if (bad.length) throw new Error(`Unknown tag ${bad.join(", ")}`);
    out.tagIds = fields.tagIds;
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  || (a instanceof Date || b instanceof Date ? toMillis(a) === toMillis(b) : false);

// firstIndex: where each model-supplied tempId first appears, so a repeat is
// rejected even when the first create failed validation. A create with no
// tempId gets `op<index>`, suffixed until it matches no supplied tempId, no
// item id and no earlier fallback.
function makeTempIds(ops, itemsById) {
  const firstIndex = new Map();
  ops.forEach((o, i) => {
    if (o.op === "create" && o.tempId && !firstIndex.has(o.tempId)) firstIndex.set(o.tempId, i);
  });
  const taken = new Set([...firstIndex.keys(), ...itemsById.keys()]);
  const fallback = (index) => {
    let id = `op${index}`;
    for (let n = 1; taken.has(id); n += 1) id = `op${index}_${n}`;
    taken.add(id);
    return id;
  };
  return { firstIndex, fallback };
}

// An assignee the item doesn't already have must be someone offered for its
// organization (the team, or that client's contacts — lib/people.js). One
// already on the item may stay even if no longer offered (e.g. seo@).
// Without ctx.assignableIn (other callers), memberIds alone decides.
function checkNewAssignees(ids, orgId, existing, ctx) {
  if (!ids || !ctx.assignableIn) return;
  const allowed = ctx.assignableIn(orgId);
  const bad = ids.filter((id) => !existing.includes(id) && !allowed.has(id));
  if (bad.length) throw new Error(`Can't assign ${bad.join(", ")} to a task of this organization`);
}

// Likewise a new tag must be shared or the organization's own (lib/tagScope.js).
function checkNewTags(ids, orgId, existing, ctx) {
  if (!ids || !ctx.tagsIn) return;
  const allowed = ctx.tagsIn(orgId);
  const bad = ids.filter((id) => !existing.includes(id) && !allowed.has(id));
  if (bad.length) throw new Error(`Tag ${bad.join(", ")} belongs to another organization`);
}

// Same rule for an item and each cascade child: stale when the model never
// saw it or its live updatedAt is newer than what the model saw.
function isStale(item, ctx) {
  const seen = ctx.seen[item.id];
  return seen == null || (toMillis(item.updatedAt) ?? 0) > seen;
}

function buildRow(op, index, ctx, itemsById, childrenOf, tempCreates, tempIds) {
  const base = { index, op: op.op, reason: op.reason, ok: true, error: null, stale: false };

  if (op.op === "create") {
    if (op.tempId && itemsById.has(op.tempId)) throw new Error(`tempId ${op.tempId} is the id of an existing item`);
    if (op.tempId && tempIds.firstIndex.get(op.tempId) !== index) throw new Error(`Duplicate tempId ${op.tempId}`);
    const fields = { ...normalizeFields(op.fields, ctx), createdVia: "board-chat" };
    if (!fields.title) throw new Error("A new item needs a title");
    if (fields.statusId === STATUS.DONE) fields.completedAt = ctx.now;
    const tempId = op.tempId || tempIds.fallback(index);
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
    checkNewAssignees(fields.assigneeIds, row.orgId, [], ctx);
    checkNewTags(fields.tagIds, row.orgId, [], ctx);
    tempCreates.set(row.tempId, row);
    return row;
  }

  const item = itemsById.get(op.itemId);
  if (!item) throw new Error(`Item ${op.itemId} not found`);
  const stale = isStale(item, ctx);

  if (op.op === "delete") {
    const children = childrenOf.get(item.id) || [];
    return { ...base, stale: stale || children.some((c) => isStale(c, ctx)), itemId: item.id, cascadeIds: children.map((c) => c.id) };
  }

  const clear = op.clear || [];
  const badClear = clear.filter((f) => !CLEARABLE.includes(f));
  if (badClear.length) throw new Error(`Cannot clear ${badClear.join(", ")}`);
  const both = clear.filter((f) => op.fields?.[f] !== undefined);
  if (both.length) throw new Error(`${both.join(", ")} is both set and cleared`);
  const patch = normalizeFields(op.fields, ctx);
  checkNewAssignees(patch.assigneeIds, item.organizationId, item.assigneeIds || [], ctx);
  checkNewTags(patch.tagIds, item.organizationId, item.tagIds || [], ctx);
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
  const cascadedBy = new Map();
  for (const row of rows) {
    if (!row.ok || row.op !== "delete") continue;
    for (const id of row.cascadeIds) if (!cascadedBy.has(id)) cascadedBy.set(id, row.index);
  }
  const removedBy = new Map();
  const deleted = new Set();
  const out = rows.map((row) => {
    if (!row.ok || row.op !== "delete") return row;
    if (cascadedBy.has(row.itemId)) return reject(row, `${row.itemId} is already deleted by op ${cascadedBy.get(row.itemId) + 1} in this proposal`);
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

const failRow = (op, index, err) => ({ index, op: op.op, reason: op.reason, itemId: op.itemId, ok: false, error: err.message, stale: false });

// Taxonomy rows first, in their own pass, so an item may use a tag created
// later in the list. Each tag or category takes one op; a tempId must be new.
function taxonomyRows(ops, ctx, itemsById) {
  const taken = new Set();
  const touched = new Map();
  const seenTemp = new Map();
  ops.forEach((o, i) => { if (o.tempId && !seenTemp.has(o.tempId)) seenTemp.set(o.tempId, i); });
  const known = new Set([...itemsById.keys(), ...ctx.tags.map((t) => t.id), ...ctx.categories.map((c) => c.id)]);
  return ops.map((op, index) => {
    if (!TAXONOMY_OPS.includes(op.op)) return null;
    try {
      if (op.tempId && (known.has(op.tempId) || seenTemp.get(op.tempId) !== index)) throw new Error(`tempId ${op.tempId} is already used`);
      const row = buildTaxonomyRow(op, index, ctx, taken);
      if (row.targetId) {
        if (touched.has(row.targetId)) throw new Error(`That ${row.kind} already has a change in op ${touched.get(row.targetId) + 1}`);
        touched.set(row.targetId, index);
      }
      return row;
    } catch (err) {
      return failRow(op, index, err);
    }
  });
}

// What items may use, given the taxonomy rows: ctx with the post-proposal
// tag / category sets, and the deleted ones named in errors.
function itemContext(ctx, after) {
  if (!after) return ctx;
  return {
    ...ctx,
    categoryIds: after.categoryIds,
    tagIds: new Set(after.tags.map((t) => t.id)),
    tagsIn: (orgId) => new Set(tagsForOrg(after.tags, orgId).map((t) => t.id)),
  };
}

function assertNotDeleted(op, after) {
  if (!after) return;
  const f = op.fields || {};
  const tag = (f.tagIds || []).find((id) => after.deletedTags.has(id));
  if (tag) throw new Error(`Tag ${tag} is deleted by op ${after.deletedTags.get(tag) + 1} in this proposal`);
  if (f.categoryId && after.deletedCats.has(f.categoryId)) {
    throw new Error(`Category ${f.categoryId} is deleted by op ${after.deletedCats.get(f.categoryId) + 1} in this proposal`);
  }
}

// The taxonomy creates an item row relies on (row indexes), so it is skipped
// if one of them isn't applied.
function needsOf(row, after) {
  if (!after || !row.ok || row.op === "delete") return [];
  const f = row.fields || row.patch || {};
  return [
    ...(f.tagIds || []).filter((id) => after.pendingTags.has(id)).map((id) => after.pendingTags.get(id)),
    ...(f.categoryId && after.pendingCategories.has(f.categoryId) ? [after.pendingCategories.get(f.categoryId)] : []),
  ];
}

// The buildReviewRows ctx for a chat panel, from the live board lists.
// people (lib/people.js), when given, limits new assignees per org.
export function boardProposalContext({ items, orgs, users, people = null, categories, tags, seen, now }) {
  return {
    items,
    orgIds: new Set(orgs.map((o) => o.id)),
    memberIds: new Set(users.map((u) => u.id)),
    ...(people ? { assignableIn: (orgId) => new Set(people.choicesFor(orgId).map((p) => p.id)) } : {}),
    categoryIds: new Set(categories.map((c) => c.id)),
    tagIds: new Set(tags.map((t) => t.id)),
    tagsIn: (orgId) => new Set(tagsForOrg(tags, orgId).map((t) => t.id)),
    tags,
    categories,
    seen,
    now,
  };
}

// ctx.tags / ctx.categories (full lists) enable tag and category ops;
// without them those ops are rejected and items use ctx.tagIds / categoryIds.
export function buildReviewRows(ops, ctx) {
  const itemsById = new Map(ctx.items.map((i) => [i.id, i]));
  const childrenOf = new Map();
  for (const i of ctx.items) {
    if (i.parentId) childrenOf.set(i.parentId, [...(childrenOf.get(i.parentId) || []), i]);
  }
  const taxonomy = ctx.tags && ctx.categories ? taxonomyRows(ops, ctx, itemsById) : ops.map(() => null);
  const after = ctx.tags && ctx.categories ? taxonomyAfter(taxonomy, ctx) : null;
  const itemCtx = itemContext(ctx, after);
  const tempCreates = new Map();
  const tempIds = makeTempIds(ops, itemsById);
  const rows = ops.map((op, index) => {
    if (taxonomy[index]) return taxonomy[index];
    try {
      if (TAXONOMY_OPS.includes(op.op)) throw new Error("Tag and category changes are not available here");
      if (!["create", "update", "delete"].includes(op.op)) throw new Error(`Unknown op "${op.op}"`);
      assertNotDeleted(op, after);
      const row = buildRow(op, index, itemCtx, itemsById, childrenOf, tempCreates, tempIds);
      const needs = needsOf(row, after);
      return needs.length ? { ...row, needs } : row;
    } catch (err) {
      return failRow(op, index, err);
    }
  });
  return rejectConflicts(rows);
}

const TAXONOMY_KIND = {
  create_tag: "createTag", update_tag: "updateTag", delete_tag: "deleteTag",
  create_category: "createCategory", update_category: "updateCategory", delete_category: "deleteCategory",
};

// Accepted rows → applyChangeSet ops. A create whose tempId parent was not
// accepted is skipped and reported, as is an item op whose new tag or
// category was not accepted.
export function toChangeSet(rows, checked) {
  const ops = [];
  const skipped = [];
  const acceptedTemps = new Set();
  const accepted = (i) => rows[i]?.ok && checked.has(i);
  for (const r of rows) {
    if (!r.ok || !checked.has(r.index)) continue;
    if (TAXONOMY_KIND[r.op]) {
      const kind = TAXONOMY_KIND[r.op];
      if (kind.startsWith("create")) ops.push({ kind, tempId: r.tempId, fields: r.fields });
      else if (kind.startsWith("update")) ops.push({ kind, id: r.targetId, patch: r.patch });
      else ops.push({ kind, id: r.targetId });
      continue;
    }
    if ((r.needs || []).some((i) => !accepted(i))) {
      skipped.push({ index: r.index, reason: "a new tag or category it uses was not applied" });
      continue;
    }
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
