// Agenda version history — snapshot + restore of an agenda's CONTENT.
// Content = title + preBriefHtml + openFloorHtml + a frozen copy of the topics
// (id/name/bodyHtml/sortOrder/categoryIds/tagIds). NOT the meeting-binding
// fields (graphEventId etc.) and NOT the Project Board items (live task state).
//
// Versions live at agendas/{id}/versions/{auto}. snapshotAgenda is reusable —
// Slice 4 (AI generation) calls it with source "pre-ai-gen" before generating.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";

// Capture the current agenda content as a new version doc. Returns its id.
export async function snapshotAgenda(agendaId, { source = "manual", label = null, uid = null } = {}) {
  const aSnap = await getDoc(doc(db, "agendas", agendaId));
  const a = aSnap.data() || {};
  const tSnap = await getDocs(
    query(collection(db, "agendas", agendaId, "topics"), orderBy("sortOrder", "asc")),
  );
  const topics = tSnap.docs.map((d) => {
    const t = d.data();
    return {
      id: d.id,
      name: t.name ?? "",
      bodyHtml: t.bodyHtml ?? "",
      sortOrder: t.sortOrder ?? 0,
      categoryIds: t.categoryIds ?? [],
      tagIds: t.tagIds ?? [],
    };
  });
  const snapshot = {
    title: a.title ?? "",
    preBriefHtml: a.preBriefHtml ?? "",
    openFloorHtml: a.openFloorHtml ?? "",
    topics,
  };
  const ref = await addDoc(collection(db, "agendas", agendaId, "versions"), {
    createdAt: serverTimestamp(),
    createdByUid: uid,
    source,
    label: label || null,
    snapshot,
  });
  return ref.id;
}

// Restore a version: first snapshots the CURRENT state (so a restore is itself
// revertible), then overwrites the agenda content + syncs topics by id.
export async function restoreAgendaVersion(agendaId, versionId, { uid = null } = {}) {
  await snapshotAgenda(agendaId, { source: "pre-restore", uid });

  const vSnap = await getDoc(doc(db, "agendas", agendaId, "versions", versionId));
  if (!vSnap.exists()) throw new Error("Version not found");
  const snap = vSnap.data().snapshot || {};
  const snapTopics = snap.topics || [];
  const snapIds = new Set(snapTopics.map((t) => t.id));

  const curSnap = await getDocs(collection(db, "agendas", agendaId, "topics"));

  const batch = writeBatch(db);
  batch.update(doc(db, "agendas", agendaId), {
    title: snap.title ?? "",
    preBriefHtml: snap.preBriefHtml ?? "",
    openFloorHtml: snap.openFloorHtml ?? "",
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
  // Drop topics that aren't in the snapshot.
  curSnap.docs.forEach((d) => {
    if (!snapIds.has(d.id)) batch.delete(d.ref);
  });
  // Recreate/update snapshot topics by their original id (preserves ids).
  snapTopics.forEach((t) => {
    batch.set(
      doc(db, "agendas", agendaId, "topics", t.id),
      {
        name: t.name ?? "",
        bodyHtml: t.bodyHtml ?? "",
        sortOrder: t.sortOrder ?? 0,
        categoryIds: t.categoryIds ?? [],
        tagIds: t.tagIds ?? [],
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      },
      { merge: true },
    );
  });
  await batch.commit();
}
