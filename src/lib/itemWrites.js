// src/lib/itemWrites.js
//
// The one writer for items/{itemId}. The Task Board's add / add-subitem /
// update / delete handlers and Board Chat's Apply all go through here, so
// counters (organizations.nextItemNumber, parent.nextSubitemNumber),
// hasChildren and the delete cascade stay identical everywhere.
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

export function blankItem({ organizationId, parentId, itemNumber, uid, order, fields = {} }) {
  return {
    organizationId,
    parentId,
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
    itemNumber,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    order,
    ...fields,
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
