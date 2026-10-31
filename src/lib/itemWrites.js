// src/lib/itemWrites.js
//
// Shared writer for items/{itemId}. The Task Board's add / add-subitem /
// update / delete handlers and Board Chat's Apply all go through here, so
// counters (organizations.nextItemNumber, parent.nextSubitemNumber),
// hasChildren and the delete cascade stay identical everywhere. (Discarding
// a just-added blank item still writes directly from TaskBoard.jsx; tag and
// category deletes go through lib/tagWrites.js / lib/categoryWrites.js.)
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "../firebase.js";

function orderAfterLast(siblings) {
  const last = siblings.map((i) => i.order).filter(Boolean).sort().pop() || null;
  return generateKeyBetween(last, null);
}

// Rank for a new item: placed after the current last sibling.
export function nextTopLevelOrder(allItems) {
  return orderAfterLast(allItems.filter((i) => i.parentId == null));
}

export function nextSubitemOrder(allItems, parentId) {
  return orderAfterLast(allItems.filter((i) => i.parentId === parentId));
}

// Identity fields come last so model- or caller-supplied `fields` can set
// content but never overwrite where the item lives or who made it.
export function blankItem({ organizationId, parentId, itemNumber, uid, order, fields = {} }) {
  return {
    hasChildren: false,
    type: "task",
    title: "",
    description: "",
    statusId: 1,
    priorityId: null,
    categoryId: null,
    tagIds: [],
    dueDate: null,
    completedAt: null,
    assigneeIds: [],
    ...fields,
    organizationId,
    parentId,
    itemNumber,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    order,
  };
}

export function newItemRef() {
  return doc(collection(db, "items"));
}

// Transaction pulls the next item number from the org doc and bumps it, so
// two people adding at once can't get the same I-N.
export async function createTopLevelItem({ ref, orgId, uid, order }) {
  const orgRef = doc(db, "organizations", orgId);
  await runTransaction(db, async (tx) => {
    const orgSnap = await tx.get(orgRef);
    const next = orgSnap.data()?.nextItemNumber ?? 1;
    tx.set(ref, blankItem({ organizationId: orgId, parentId: null, itemNumber: next, uid, order }));
    tx.update(orgRef, { nextItemNumber: next + 1 });
  });
}

// SI-N is per parent. Reading the parent in the transaction also makes the
// hasChildren update race-safe.
export async function createSubitem({ ref, parent, uid, order }) {
  const parentRef = doc(db, "items", parent.id);
  await runTransaction(db, async (tx) => {
    const parentSnap = await tx.get(parentRef);
    const next = parentSnap.data()?.nextSubitemNumber ?? 1;
    tx.set(ref, blankItem({ organizationId: parent.organizationId, parentId: parent.id, itemNumber: next, uid, order }));
    tx.update(parentRef, { nextSubitemNumber: next + 1, hasChildren: true, updatedAt: serverTimestamp() });
  });
}

// Items assigned to someone by email before they signed in (lib/people.js)
// move to their uid. Runs at every sign-in, so a failed run retries next time.
export async function claimEmailAssignments(uid, email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return 0;
  const snap = await getDocs(query(collection(db, "items"), where("assigneeIds", "array-contains", key)));
  // Batches of 450 (Firestore allows 500 writes per batch).
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 450).forEach((d) => {
      const ids = d.data().assigneeIds.map((id) => (id === key ? uid : id));
      batch.update(d.ref, { assigneeIds: [...new Set(ids)], updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }
  return snap.size;
}

export function updateItem(itemId, patch) {
  return updateDoc(doc(db, "items", itemId), { ...patch, updatedAt: serverTimestamp() });
}

// Parent + all children commit together so a Firestore hiccup can't leave
// subitems orphaned.
export async function deleteItemCascade(itemId, subitemIds = []) {
  const batch = writeBatch(db);
  subitemIds.forEach((id) => batch.delete(doc(db, "items", id)));
  batch.delete(doc(db, "items", itemId));
  await batch.commit();
}

const unique = (arr) => [...new Set(arr)];

export const EDITABLE_FIELDS = ["title", "description", "statusId", "assigneeIds", "dueDate", "priorityId", "categoryId", "tagIds", "completedAt"];
const CREATABLE_FIELDS = [...EDITABLE_FIELDS, "createdVia"];

const TAXONOMY_WRITES = new Set(["createTag", "updateTag", "createCategory", "updateCategory"]);
const TAXONOMY_FIELDS = { Tag: ["name", "color", "organizationId"], Category: ["name", "color"] };

function assertSupportedFields(ops) {
  for (const o of ops) {
    if (o.kind === "deleteTag" || o.kind === "deleteCategory") {
      throw new Error(`${o.kind} runs after the change set (lib/boardChat/apply.js), not inside it`);
    }
    if (TAXONOMY_WRITES.has(o.kind)) {
      const allowed = TAXONOMY_FIELDS[o.kind.endsWith("Tag") ? "Tag" : "Category"];
      for (const key of Object.keys(o.fields || o.patch || {})) {
        if (!allowed.includes(key)) throw new Error(`Unsupported field ${key} on ${o.kind}`);
      }
      continue;
    }
    if (o.kind === "delete") continue;
    const allowed = o.kind === "create" ? CREATABLE_FIELDS : EDITABLE_FIELDS;
    const bag = o.kind === "create" ? o.fields : o.patch;
    for (const key of Object.keys(bag || {})) {
      if (!allowed.includes(key)) throw new Error(`Unsupported field ${key} on ${o.kind} ${o.itemId || o.tempId}`);
    }
  }
}

function assertNoConflicts(ops) {
  const creates = ops.filter((o) => o.kind === "create");
  const tempIds = new Set(creates.map((c) => c.tempId));
  const removed = new Set();
  for (const o of ops.filter((d) => d.kind === "delete")) {
    for (const id of [o.itemId, ...(o.cascadeIds || [])]) {
      if (removed.has(id)) throw new Error(`Item ${id} is deleted twice in the same change set`);
      removed.add(id);
    }
  }
  for (const o of ops) {
    if (o.kind === "update" && removed.has(o.itemId)) {
      throw new Error(`Item ${o.itemId} is updated and deleted in the same change set`);
    }
    if (o.kind === "create") {
      if (o.parentId && removed.has(o.parentId)) throw new Error(`Cannot add a subtask under ${o.parentId}; it is being deleted`);
      if (o.parentTempId && !tempIds.has(o.parentTempId)) throw new Error(`Unknown parent ${o.parentTempId} for ${o.tempId}`);
    }
  }
}

const maxSort = (list) => list.reduce((m, x) => Math.max(m, Number(x.sortOrder) || 0), 0);
// Colors for a tag / category created without one: violet as for tags the
// syncs coin, blue for categories.
const DEFAULT_TAG_COLOR = "#8b5cf6";
const DEFAULT_CATEGORY_COLOR = "#3b82f6";

// Board Chat / Agenda Chat Apply: every accepted op in ONE transaction — all
// reads first (Firestore requires it), then all writes. A missing target
// aborts the set. New tags and categories are written first in the same
// transaction; an item that names one by its tempId gets its real id.
// `taxonomy` ({ tags, categories }, the current lists) places new ones last
// in sort order. Returns [{ tempId, itemId, ref }] for item creates and
// [{ tempId, tagId | categoryId }] for tag / category creates.
export async function applyChangeSet(ops, { uid, allItems, taxonomy = { tags: [], categories: [] } }) {
  assertSupportedFields(ops);
  assertNoConflicts(ops);
  const newTags = ops.filter((o) => o.kind === "createTag");
  const newCats = ops.filter((o) => o.kind === "createCategory");
  const tagRefs = new Map(newTags.map((o) => [o.tempId, doc(collection(db, "tags"))]));
  const catRefs = new Map(newCats.map((o) => [o.tempId, doc(collection(db, "categories"))]));
  const realTag = (id) => tagRefs.get(id)?.id ?? id;
  const realCat = (id) => (id && catRefs.has(id) ? catRefs.get(id).id : id);
  const resolve = (bag) => {
    if (!bag) return bag;
    const out = { ...bag };
    if (Array.isArray(out.tagIds)) out.tagIds = out.tagIds.map(realTag);
    if (out.categoryId) out.categoryId = realCat(out.categoryId);
    return out;
  };
  ops = ops.map((o) => (o.kind === "create" ? { ...o, fields: resolve(o.fields) } : o.kind === "update" ? { ...o, patch: resolve(o.patch) } : o));
  const creates = ops.filter((o) => o.kind === "create");
  const refs = new Map(creates.map((c) => [c.tempId, newItemRef()]));
  const childCountByTemp = new Map();
  for (const c of creates) {
    if (c.parentTempId) childCountByTemp.set(c.parentTempId, (childCountByTemp.get(c.parentTempId) || 0) + 1);
  }

  return runTransaction(db, async (tx) => {
    const orgIds = unique(creates.filter((c) => !c.parentId && !c.parentTempId).map((c) => c.orgId));
    const parentIds = unique(creates.filter((c) => c.parentId).map((c) => c.parentId));
    const targetIds = unique(ops.filter((o) => o.kind === "update" || o.kind === "delete").map((o) => o.itemId));

    const orgSnaps = new Map();
    for (const id of orgIds) orgSnaps.set(id, await tx.get(doc(db, "organizations", id)));
    const parentSnaps = new Map();
    for (const id of parentIds) parentSnaps.set(id, await tx.get(doc(db, "items", id)));
    for (const id of [...parentIds, ...targetIds]) {
      const snap = parentSnaps.get(id) || await tx.get(doc(db, "items", id));
      if (!snap.exists()) throw new Error(`Item ${id} no longer exists`);
    }
    for (const o of ops.filter((x) => x.kind === "updateTag" || x.kind === "updateCategory")) {
      const coll = o.kind === "updateTag" ? "tags" : "categories";
      if (!(await tx.get(doc(db, coll, o.id))).exists()) throw new Error(`${o.kind === "updateTag" ? "Tag" : "Category"} ${o.id} no longer exists`);
    }

    const taxonomyResults = [];
    newTags.forEach((o, i) => {
      const ref = tagRefs.get(o.tempId);
      tx.set(ref, {
        name: o.fields.name,
        color: o.fields.color || DEFAULT_TAG_COLOR,
        organizationId: o.fields.organizationId ?? null,
        sortOrder: maxSort(taxonomy.tags) + i + 1,
        createdAt: serverTimestamp(),
        createdByUid: uid || null,
      });
      taxonomyResults.push({ tempId: o.tempId, tagId: ref.id });
    });
    newCats.forEach((o, i) => {
      const ref = catRefs.get(o.tempId);
      tx.set(ref, {
        name: o.fields.name,
        color: o.fields.color || DEFAULT_CATEGORY_COLOR,
        sortOrder: maxSort(taxonomy.categories) + i + 1,
        createdAt: serverTimestamp(),
      });
      taxonomyResults.push({ tempId: o.tempId, categoryId: ref.id });
    });
    for (const o of ops) {
      if (o.kind === "updateTag") tx.update(doc(db, "tags", o.id), o.patch);
      if (o.kind === "updateCategory") tx.update(doc(db, "categories", o.id), o.patch);
    }

    const nextOrgNum = new Map(orgIds.map((id) => [id, orgSnaps.get(id).data()?.nextItemNumber ?? 1]));
    const nextSubNum = new Map(parentIds.map((id) => [id, parentSnaps.get(id).data()?.nextSubitemNumber ?? 1]));
    let lastTop = null;
    const lastSub = new Map();
    const results = [];

    for (const c of creates) {
      const ref = refs.get(c.tempId);
      if (!c.parentId && !c.parentTempId) {
        const n = nextOrgNum.get(c.orgId);
        nextOrgNum.set(c.orgId, n + 1);
        const order = lastTop
          ? generateKeyBetween(lastTop, null)
          : nextTopLevelOrder(allItems);
        lastTop = order;
        const kids = childCountByTemp.get(c.tempId) || 0;
        const fields = kids ? { ...c.fields, hasChildren: true, nextSubitemNumber: kids + 1 } : c.fields;
        tx.set(ref, blankItem({ organizationId: c.orgId, parentId: null, itemNumber: n, uid, order, fields }));
        results.push({ tempId: c.tempId, itemId: ref.id, ref: `I-${n}` });
      } else {
        const parentId = c.parentId || refs.get(c.parentTempId).id;
        const n = nextSubNum.get(parentId) ?? 1;
        nextSubNum.set(parentId, n + 1);
        const order = lastSub.has(parentId)
          ? generateKeyBetween(lastSub.get(parentId), null)
          : nextSubitemOrder(allItems, parentId);
        lastSub.set(parentId, order);
        tx.set(ref, blankItem({ organizationId: c.orgId, parentId, itemNumber: n, uid, order, fields: c.fields }));
        results.push({ tempId: c.tempId, itemId: ref.id, ref: `SI-${n}` });
      }
    }

    for (const id of orgIds) tx.update(doc(db, "organizations", id), { nextItemNumber: nextOrgNum.get(id) });
    for (const id of parentIds) {
      tx.update(doc(db, "items", id), { nextSubitemNumber: nextSubNum.get(id), hasChildren: true, updatedAt: serverTimestamp() });
    }
    for (const o of ops) {
      if (o.kind === "update") tx.update(doc(db, "items", o.itemId), { ...o.patch, updatedAt: serverTimestamp() });
      if (o.kind === "delete") {
        (o.cascadeIds || []).forEach((id) => tx.delete(doc(db, "items", id)));
        tx.delete(doc(db, "items", o.itemId));
      }
    }
    return [...taxonomyResults, ...results];
  });
}
