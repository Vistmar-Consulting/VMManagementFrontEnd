// src/lib/agendaChat/apply.js
//
// Writes a planAgendaWrites plan in one batch, after snapshotting the agenda
// into Version history so the apply can be reverted. Returns the new topic ids.
import { arrayRemove, arrayUnion, collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";
import { agendaEditStamp } from "../agendaEdits.js";
import { snapshotAgenda } from "../agendaVersions.js";

export async function applyAgendaPlan(agendaId, plan, uid) {
  await snapshotAgenda(agendaId, { source: "agenda-chat", uid });
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
  // Hand-removed items: union / remove, so a removal made elsewhere meanwhile
  // is kept. One field can't take both in one update, so two updates.
  for (const e of plan.excluded || []) {
    const ref = doc(db, "agendas", agendaId, "topics", e.id);
    if (e.add.length) batch.update(ref, { excludedItemIds: arrayUnion(...e.add), ...stamp });
    if (e.remove.length) batch.update(ref, { excludedItemIds: arrayRemove(...e.remove), ...stamp });
  }
  for (const id of plan.deletes) batch.delete(doc(db, "agendas", agendaId, "topics", id));
  batch.update(doc(db, "agendas", agendaId), {
    ...(plan.openFloorHtml !== null ? { openFloorHtml: plan.openFloorHtml, ...stamp } : {}),
    ...agendaEditStamp(uid),
  });
  await batch.commit();
  return created;
}
