// src/lib/aiTasks.js
//
// Slice 5a — AI-suggested Project Board tasks. suggestTasks() POSTs the
// meeting window (reuses assembleGenInputs) + full SOPs + existing board to
// the Vercel function; applyTaskSuggestions() writes the selected proposals as
// statusId 8 ("AI Gen" triage) items into the org's board.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { auth, db } from "../firebase.js";
import { tagSlug } from "./aiAgenda.js";

const AI_GEN_STATUS = 8;
const STATUS_MAP = { Assigned: 1, "In Progress": 2, Review: 4, Done: 5, Pending: 6 };

export async function suggestTasks({ agenda, transcripts, orgAgendas, existingTasks, categories, tagVocab, extraContext }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/ai/suggest-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ agenda, transcripts, orgAgendas, existingTasks, categories, tagVocab, extraContext }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { tasks: data.tasks || [], moves: data.moves || [], notes: data.notes || [] };
}

// Apply reviewed task changes (Slice 5a creates + 5b moves/notes):
//   creates → new statusId-8 items (in a transaction for the org itemNumber
//     counter; matches TaskBoard's pattern). Fresh `order` → sorts to top
//     for triage; the human re-ranks as they promote.
//   moves   → status change on an existing item (+ completedAt when → Done).
//   notes   → appended to the existing item's description.
// Moves/notes run in a writeBatch (no counter contention).
export async function applyTaskChanges(orgSlug, { creates = [], moves = [], notes = [] }, uid = null) {
  if (!orgSlug) throw new Error("Missing org");
  let createdCount = 0;
  let newTagCount = 0;

  if (creates.length) {
    const result = await writeCreates(orgSlug, creates, uid);
    createdCount = result.created;
    newTagCount = result.newTags;
  }

  if (moves.length || notes.length) {
    const noteSnaps = await Promise.all(notes.map((n) => getDoc(doc(db, "items", n.itemId))));
    const batch = writeBatch(db);
    moves.forEach((m) => {
      const sid = STATUS_MAP[m.toStatus];
      if (!sid || !m.itemId) return;
      batch.update(doc(db, "items", m.itemId), {
        statusId: sid,
        completedAt: sid === STATUS_MAP.Done ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });
    notes.forEach((n, i) => {
      const snap = noteSnaps[i];
      if (!snap?.exists() || !n.note) return;
      const cur = snap.data().description || "";
      batch.update(doc(db, "items", n.itemId), {
        description: `${cur ? `${cur}\n` : ""}— ${n.note}`,
        updatedAt: serverTimestamp(),
        updatedByUid: uid,
      });
    });
    await batch.commit();
  }

  return { created: createdCount, moved: moves.length, noted: notes.length, newTags: newTagCount };
}

// Write new statusId-8 items in a transaction (atomic org itemNumber counter).
async function writeCreates(orgSlug, tasks, uid) {
  const [catSnap, tagSnap] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "tags")),
  ]);
  const catBySlug = new Set(catSnap.docs.map((d) => d.id));
  const catByName = new Map(catSnap.docs.map((d) => [(d.data().name || "").toLowerCase(), d.id]));
  const resolveCat = (c) => {
    const v = String(c || "").trim();
    if (catBySlug.has(v)) return v;
    return catByName.get(v.toLowerCase()) || null;
  };
  const existingTagIds = new Set(tagSnap.docs.map((d) => d.id));
  const existingTagByName = new Map(tagSnap.docs.map((d) => [(d.data().name || d.id).toLowerCase(), d.id]));
  const tagSort = tagSnap.size;
  const orgRef = doc(db, "organizations", orgSlug);

  let newTagCount = 0;
  await runTransaction(db, async (tx) => {
    const orgS = await tx.get(orgRef);
    let num = orgS.data()?.nextItemNumber ?? 1;
    let order = null;
    // Built fresh each tx attempt so a retry doesn't double-create tags.
    const newTagWrites = [];
    const resolveTag = (t) => {
      const name = String(t || "").trim();
      if (!name) return null;
      if (existingTagIds.has(name)) return name;
      const byName = existingTagByName.get(name.toLowerCase());
      if (byName) return byName;
      const id = tagSlug(name);
      if (!id || existingTagIds.has(id)) return id || null;
      if (!newTagWrites.find((w) => w.id === id)) newTagWrites.push({ id, name });
      return id;
    };

    (tasks || []).forEach((t) => {
      order = generateKeyBetween(order, null);
      const ref = doc(collection(db, "items"));
      tx.set(ref, {
        organizationId: orgSlug,
        parentId: null,
        hasChildren: false,
        type: "task",
        title: String(t.title || ""),
        description: String(t.note || ""),
        statusId: AI_GEN_STATUS,
        priorityId: null,
        categoryId: resolveCat(t.category),
        tagIds: [...new Set((t.tags || []).map(resolveTag).filter(Boolean))],
        onHold: false,
        dueDate: null,
        completedAt: null,
        assigneeIds: [],
        itemNumber: num++,
        createdBy: uid || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        order,
      });
    });

    newTagWrites.forEach((w, i) => {
      tx.set(doc(db, "tags", w.id), {
        name: w.name,
        color: "#8b5cf6",
        layer: 3,
        sortOrder: tagSort + i + 1,
        createdAt: serverTimestamp(),
        createdByUid: uid,
      });
    });

    tx.set(orgRef, { nextItemNumber: num }, { merge: true });
    newTagCount = newTagWrites.length;
  });
  return { created: (tasks || []).length, newTags: newTagCount };
}
