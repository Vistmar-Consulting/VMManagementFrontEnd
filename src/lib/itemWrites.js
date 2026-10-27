// src/lib/itemWrites.js
//
// Shared writer for items/{itemId}. The Task Board's add / add-subitem /
// update / delete handlers and Board Chat's Apply all go through here, so
// counters (organizations.nextItemNumber, parent.nextSubitemNumber),
// hasChildren and the delete cascade stay identical everywhere. (Discarding
// a just-added blank item and the category/tag clean-up still write items
// directly from TaskBoard.jsx.)
import { collection, doc, runTransaction, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
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

function assertSupportedFields(ops) {
  for (const o of ops) {
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

// Board Chat Apply: every accepted op in ONE transaction — all reads first
// (Firestore requires it), then all writes. A missing target aborts the set.
// Returns [{ tempId, itemId, ref }] for the creates.
export async function applyChangeSet(ops, { uid, allItems }) {
  assertSupportedFields(ops);
  assertNoConflicts(ops);
  const creates = ops.filter((o) => o.kind === "create");
  const refs = new Map(creates.map((c) => [c.tempId, newItemRef()]));
  const childCountByTemp = new Map();
  for (const c of creates) {
    if (c.parentTempId) childCountByTemp.set(c.parentTempId, (childCountByTemp.get(c.parentTempId) || 0) + 1);
  }

  return runTransaction(db, async (tx) => {
    const orgIds = unique(creates.filter((c) => !c.parentId && !c.parentTempId).map((c) => c.orgId));
    const parentIds = unique(creates.filter((c) => c.parentId).map((c) => c.parentId));
    const targetIds = unique(ops.filter((o) => o.kind !== "create").map((o) => o.itemId));

    const orgSnaps = new Map();
    for (const id of orgIds) orgSnaps.set(id, await tx.get(doc(db, "organizations", id)));
    const parentSnaps = new Map();
    for (const id of parentIds) parentSnaps.set(id, await tx.get(doc(db, "items", id)));
    for (const id of [...parentIds, ...targetIds]) {
      const snap = parentSnaps.get(id) || await tx.get(doc(db, "items", id));
      if (!snap.exists()) throw new Error(`Item ${id} no longer exists`);
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
    return results;
  });
}
