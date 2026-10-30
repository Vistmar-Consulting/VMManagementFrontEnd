// src/lib/tagWrites.js
//
// Deleting a tag removes it from every task and every agenda topic card that
// carries it, then deletes the tag itself.
import { arrayRemove, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";

// Firestore allows 500 writes per batch.
const BATCH = 450;

export async function deleteTag(tagId, uid) {
  const carrying = (ref) => getDocs(query(ref, where("tagIds", "array-contains", tagId)));
  const [items, agendas] = await Promise.all([carrying(collection(db, "items")), getDocs(collection(db, "agendas"))]);
  const topics = await Promise.all(agendas.docs.map((a) => carrying(collection(db, "agendas", a.id, "topics"))));

  const writes = [
    ...items.docs.map((d) => (b) => b.update(d.ref, { tagIds: arrayRemove(tagId), updatedAt: serverTimestamp() })),
    ...topics.flatMap((s) => s.docs).map((d) => (b) => b.update(d.ref, { tagIds: arrayRemove(tagId), updatedAt: serverTimestamp(), updatedByUid: uid })),
    // Last, so a failed earlier batch leaves the tag in place to delete again.
    (b) => b.delete(doc(db, "tags", tagId)),
  ];
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = writeBatch(db);
    writes.slice(i, i + BATCH).forEach((write) => write(batch));
    await batch.commit();
  }
  return { items: items.size, topics: topics.reduce((n, s) => n + s.size, 0) };
}
