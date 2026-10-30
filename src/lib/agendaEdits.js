// src/lib/agendaEdits.js
//
// Edits to an agenda's content (title, topics, topic bodies, Open Floor),
// each stamped on the agenda with who made it and when — the header's
// "edited … ago" + avatar. lastEditedAt / lastEditedByUid are separate from
// updatedAt, which scheduling writes (invites, guests, concluding) also bump.
// Writes that already run in a batch or transaction (Sync Meeting, Meeting
// Chat, Version history restore) add agendaEditStamp themselves.
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";

export const agendaEditStamp = (uid) => ({ lastEditedAt: serverTimestamp(), lastEditedByUid: uid || null });

const agendaRef = (agendaId) => doc(db, "agendas", agendaId);
const topicRef = (agendaId, topicId) => doc(db, "agendas", agendaId, "topics", topicId);

// Fields on the agenda doc itself (title, openFloorHtml).
export function editAgenda(agendaId, patch, uid) {
  return updateDoc(agendaRef(agendaId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedByUid: uid || null,
    ...agendaEditStamp(uid),
  });
}

export function editTopic(agendaId, topicId, patch, uid) {
  const batch = writeBatch(db);
  batch.update(topicRef(agendaId, topicId), { ...patch, updatedAt: serverTimestamp(), updatedByUid: uid || null });
  batch.update(agendaRef(agendaId), agendaEditStamp(uid));
  return batch.commit();
}

export async function addTopic(agendaId, fields, uid) {
  const ref = doc(collection(db, "agendas", agendaId, "topics"));
  const batch = writeBatch(db);
  batch.set(ref, { ...fields, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByUid: uid || null });
  batch.update(agendaRef(agendaId), agendaEditStamp(uid));
  await batch.commit();
  return ref.id;
}

export function deleteTopic(agendaId, topicId, uid) {
  const batch = writeBatch(db);
  batch.delete(topicRef(agendaId, topicId));
  batch.update(agendaRef(agendaId), agendaEditStamp(uid));
  return batch.commit();
}
