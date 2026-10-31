// src/lib/boardChat/apply.js
//
// Applies the ticked rows of a Task Board proposal (proposal.js) — Board
// Chat's propose_changes and the board half of Agenda Chat's — and reports
// to the model exactly what was applied. Items, new tags and categories, and
// tag / category edits go in one transaction (itemWrites.applyChangeSet).
// Tag and category deletes run after it, each clearing what uses them
// (tagWrites / categoryWrites); one that fails is reported, the rest stand.
import { applyChangeSet } from "../itemWrites.js";
import { deleteCategory } from "../categoryWrites.js";
import { deleteTag } from "../tagWrites.js";
import { toChangeSet } from "./proposal.js";

const DEFERRED = { deleteTag, deleteCategory };

// ctx: { uid, items, tags, categories, itemLabel(id) }
// Returns { result: { applied, declined }, created, touchedItemIds,
// touchedTopicIds (agenda topic cards a delete cleared), newIds: { [tempId]: real id } }. Throws (nothing written) if the
// transaction fails.
export async function applyBoardProposal(rows, checked, { uid, items, tags, categories, itemLabel }) {
  const { ops, skipped } = toChangeSet(rows, checked);
  const txOps = ops.filter((o) => !DEFERRED[o.kind]);
  const created = txOps.length ? await applyChangeSet(txOps, { uid, allItems: items, taxonomy: { tags, categories } }) : [];

  const failed = new Map();
  // Tasks and topic cards a delete cleared: their updatedAt moves too.
  const clearedItemIds = [];
  const touchedTopicIds = [];
  for (const r of rows) {
    if (!r.ok || !checked.has(r.index) || (r.op !== "delete_tag" && r.op !== "delete_category")) continue;
    try {
      const out = await DEFERRED[r.op === "delete_tag" ? "deleteTag" : "deleteCategory"](r.targetId, uid);
      clearedItemIds.push(...out.itemIds);
      touchedTopicIds.push(...out.topicIds);
    } catch (err) {
      failed.set(r.index, `delete failed: ${err.message}`);
    }
  }

  const newIds = Object.fromEntries(created.map((c) => [c.tempId, c.itemId || c.tagId || c.categoryId]));
  const byTemp = new Map(created.map((c) => [c.tempId, c]));
  // Applied = exactly the rows that went into the writes: valid, ticked, not
  // skipped, not failed. Reported by row index so a rejected op on the same
  // item can never be reported as applied.
  const skippedIdx = new Map(skipped.map((s) => [s.index, s.reason]));
  const isApplied = (r) => r.ok && checked.has(r.index) && !skippedIdx.has(r.index) && !failed.has(r.index);
  // completedAt holds a serverTimestamp sentinel (or null), so it is
  // reported as "now" / "cleared"; createdVia is ours, not the model's.
  const completed = (completedAt) => (completedAt !== undefined ? { completedAt: completedAt === null ? "cleared" : "now" } : {});
  const realIds = (bag) => {
    const out = { ...bag };
    if (Array.isArray(out.tagIds)) out.tagIds = out.tagIds.map((id) => newIds[id] || id);
    if (out.categoryId && newIds[out.categoryId]) out.categoryId = newIds[out.categoryId];
    return out;
  };
  const applied = rows.filter(isApplied).map((r) => {
    if (r.op === "create") {
      const { completedAt, createdVia, ...newValues } = r.fields;
      const c = byTemp.get(r.tempId);
      return { index: r.index, op: "create", title: r.fields.title, tempId: r.tempId, itemId: c.itemId, ref: c.ref, newValues: realIds(newValues), ...completed(completedAt) };
    }
    if (r.op === "delete") return { index: r.index, op: "delete", item: itemLabel(r.itemId), alsoDeletedSubtasks: r.cascadeIds.length };
    if (r.op === "update") {
      const { completedAt, ...newValues } = r.patch;
      return { index: r.index, op: "update", item: itemLabel(r.itemId), newValues: realIds(newValues), ...completed(completedAt) };
    }
    if (r.op === "create_tag") return { index: r.index, op: r.op, tempId: r.tempId, tagId: newIds[r.tempId], name: r.fields.name, scope: r.fields.organizationId || "shared" };
    if (r.op === "create_category") return { index: r.index, op: r.op, tempId: r.tempId, categoryId: newIds[r.tempId], name: r.fields.name };
    if (r.op === "delete_tag" || r.op === "delete_category") return { index: r.index, op: r.op, name: r.name, clearedFromItems: r.usedBy };
    return { index: r.index, op: r.op, id: r.targetId, newValues: r.patch };
  });
  const declined = rows.filter((r) => !isApplied(r))
    .map((r) => ({ index: r.index, op: r.op, why: r.error || skippedIdx.get(r.index) || failed.get(r.index) || "unticked by the user" }));

  // Everything whose updatedAt this Apply bumps: updated items, new items,
  // and existing parents that gained a subtask.
  const touchedItemIds = [
    ...txOps.filter((o) => o.kind === "update").map((o) => o.itemId),
    ...txOps.filter((o) => o.kind === "create" && o.parentId).map((o) => o.parentId),
    ...created.filter((c) => c.itemId).map((c) => c.itemId),
    ...clearedItemIds,
  ];
  return { result: { applied, declined }, created, touchedItemIds, touchedTopicIds, newIds };
}
