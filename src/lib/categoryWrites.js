// src/lib/categoryWrites.js
//
// Deleting a category clears it from every task that has it and removes it
// from every agenda topic card that lists it, then deletes the category
// itself — the same clean-up lib/tagWrites.js does for a tag.
import { arrayRemove, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";

// Firestore allows 500 writes per batch.
const BATCH = 450;

export async function deleteCategory(categoryId, uid) {
  const [items, agendas] = await Promise.all([
    getDocs(query(collection(db, "items"), where("categoryId", "==", categoryId))),
    getDocs(collection(db, "agendas")),
  ]);
  const topics = await Promise.all(agendas.docs.map((a) => getDocs(query(collection(db, "agendas", a.id, "topics"), where("categoryIds", "array-contains", categoryId)))));

  const writes = [
    ...items.docs.map((d) => (b) => b.update(d.ref, { categoryId: null, updatedAt: serverTimestamp() })),
    ...topics.flatMap((s) => s.docs).map((d) => (b) => b.update(d.ref, { categoryIds: arrayRemove(categoryId), updatedAt: serverTimestamp(), updatedByUid: uid })),
    // Last, so a failed earlier batch leaves the category in place to delete again.
    (b) => b.delete(doc(db, "categories", categoryId)),
  ];
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = writeBatch(db);
    writes.slice(i, i + BATCH).forEach((write) => write(batch));
    await batch.commit();
  }
  // The ids too, so a chat can count these updatedAt bumps as its own writes.
  return { items: items.size, topics: topics.reduce((n, s) => n + s.size, 0), itemIds: items.docs.map((d) => d.id), topicIds: topics.flatMap((s) => s.docs.map((d) => d.id)) };
}
