// Agenda version history — snapshot + restore of an agenda's CONTENT.
// Content = title + openFloorHtml + a frozen copy of the topics
// (id/name/bodyHtml/sortOrder/categoryIds/tagIds/excludedItemIds). NOT the meeting-binding
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
import { agendaEditStamp } from "./agendaEdits.js";

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
      // Items removed from the topic card by hand (lib/topicItems.js).
      excludedItemIds: t.excludedItemIds ?? [],
      // The master agenda groups topics by organization.
      organizationId: t.organizationId ?? null,
    };
  });
  const snapshot = {
    title: a.title ?? "",
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
// Returns the restored bodies by fragment key (topic id / "openFloor"): the
// live editor's content wins over Firestore once it has text, so the caller
// must write these into the room (writeTopicBodies) or the restore comes undone.
export async function restoreAgendaVersion(agendaId, versionId, { uid = null } = {}) {
  await snapshotAgenda(agendaId, { source: "pre-restore", uid });

  const vSnap = await getDoc(doc(db, "agendas", agendaId, "versions", versionId));
  if (!vSnap.exists()) throw new Error("Version not found");
  const snap = vSnap.data().snapshot || {};
  const snapTopics = snap.topics || [];
  const snapIds = new Set(snapTopics.map((t) => t.id));

  const curSnap = await getDocs(collection(db, "agendas", agendaId, "topics"));
  // A tag or category deleted since the version was saved stays deleted.
  const [tagSnap, catSnap] = await Promise.all([getDocs(collection(db, "tags")), getDocs(collection(db, "categories"))]);
  const tagIds = new Set(tagSnap.docs.map((d) => d.id));
  const categoryIds = new Set(catSnap.docs.map((d) => d.id));

  const batch = writeBatch(db);
  batch.update(doc(db, "agendas", agendaId), {
    title: snap.title ?? "",
    openFloorHtml: snap.openFloorHtml ?? "",
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
    ...agendaEditStamp(uid),
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
        categoryIds: (t.categoryIds ?? []).filter((id) => categoryIds.has(id)),
        tagIds: (t.tagIds ?? []).filter((id) => tagIds.has(id)),
        // Versions saved before organizationId / excludedItemIds were
        // captured leave them as they are.
        ...(t.organizationId !== undefined ? { organizationId: t.organizationId } : {}),
        ...(t.excludedItemIds !== undefined ? { excludedItemIds: t.excludedItemIds } : {}),
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      },
      { merge: true },
    );
  });
  await batch.commit();
  return {
    ...Object.fromEntries(snapTopics.map((t) => [t.id, t.bodyHtml ?? ""])),
    openFloor: snap.openFloorHtml ?? "",
  };
}
