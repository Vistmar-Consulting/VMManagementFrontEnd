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
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { auth, db } from "../firebase.js";
import { tagSlug } from "./aiAgenda.js";

const AI_GEN_STATUS = 8;

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
  return data.tasks || [];
}

// Write selected suggested tasks as statusId 8 items into the org's board.
export async function applyTaskSuggestions(orgSlug, tasks, uid = null) {
  if (!orgSlug) throw new Error("Missing org");
  const [catSnap, tagSnap, orgSnap] = await Promise.all([
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "tags")),
    getDoc(doc(db, "organizations", orgSlug)),
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
  let tagSort = tagSnap.size;
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

  const batch = writeBatch(db);
  let num = orgSnap.data()?.nextItemNumber ?? 1;
  let order = null;

  (tasks || []).forEach((t) => {
    order = generateKeyBetween(order, null);
    const ref = doc(collection(db, "items"));
    batch.set(ref, {
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
    batch.set(doc(db, "tags", w.id), {
      name: w.name,
      color: "#8b5cf6",
      layer: 3,
      sortOrder: tagSort + i + 1,
      createdAt: serverTimestamp(),
      createdByUid: uid,
    });
  });

  batch.set(doc(db, "organizations", orgSlug), { nextItemNumber: num }, { merge: true });
  await batch.commit();
  return { created: (tasks || []).length, newTags: newTagWrites.length };
}
