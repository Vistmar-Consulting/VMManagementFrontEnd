// src/lib/syncNoteReads.js
//
// The Note bodies already on existing tasks, so a sync rerun over the same
// meeting doesn't write the same Note twice (Sync Meeting and Board Sync).
// Read before the transaction: a transaction can't run queries.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

// { [itemId]: Set of comment bodies }
export async function noteBodiesByItem(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  const snaps = await Promise.all(ids.map((id) => getDocs(collection(db, "items", id, "comments"))));
  return Object.fromEntries(ids.map((id, i) => [id, new Set(snaps[i].docs.map((d) => d.data().body))]));
}
