// src/lib/meetingChat/apply.js
//
// Writes a planAgendaWrites plan in one batch, after snapshotting the agenda
// into Version history so the apply can be reverted. Returns the new topic ids.
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { snapshotAgenda } from "../agendaVersions.js";

export async function applyAgendaPlan(agendaId, plan, uid) {
  await snapshotAgenda(agendaId, { source: "meeting-chat", uid });
  const batch = writeBatch(db);
  const stamp = { updatedAt: serverTimestamp(), updatedByUid: uid };
  const created = plan.creates.map((c) => {
    const ref = doc(collection(db, "agendas", agendaId, "topics"));
    batch.set(ref, {
      name: c.name,
      bodyHtml: c.bodyHtml,
      sortOrder: c.sortOrder,
      organizationId: c.organizationId,
      categoryIds: [],
      tagIds: [],
      createdAt: serverTimestamp(),
      createdByUid: uid,
      ...stamp,
    });
    return ref.id;
  });
  for (const u of plan.updates) batch.update(doc(db, "agendas", agendaId, "topics", u.id), { ...u.patch, ...stamp });
  for (const id of plan.deletes) batch.delete(doc(db, "agendas", agendaId, "topics", id));
  if (plan.openFloorHtml !== null) batch.update(doc(db, "agendas", agendaId), { openFloorHtml: plan.openFloorHtml, ...stamp });
  await batch.commit();
  return created;
}
