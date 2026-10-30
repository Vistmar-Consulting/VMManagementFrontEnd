// src/lib/boardChat/useBoardViews.js
//
// The user's Board Chat filter views, saved in Firestore (users/{uid}/boardViews,
// private to the owner) so they follow the user and can be deleted with the
// chat that made them. Returns [views, setViews, error] like a state hook:
// setViews updates the board at once (the board applies a view in the same
// tick) and writes only the views added or removed.
//
// A per-browser copy in localStorage lets the board restore an active view on
// first render, before Firestore answers. Views saved by the earlier
// browser-only version are uploaded once, as views with no chat, to the
// account signed in on that browser (that list was never per user).
import { useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebase.js";

const LEGACY_KEY = "vm-board-chat-views";

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// The earlier version stored a plain list, or { views } before that.
function legacyViews() {
  const stored = readJson(LEGACY_KEY, null);
  if (Array.isArray(stored)) return stored;
  if (Array.isArray(stored?.views)) return stored.views;
  return [];
}

const viewDoc = (uid, id) => doc(db, "users", uid, "boardViews", id);
// `order` is set by the browser that adds the view, so several views added in
// one reply keep their order while their server timestamps are pending.
const toFirestore = (v, order) => ({ label: v.label, filtersJson: JSON.stringify(v.filters), chatId: v.chatId ?? null, order, createdAt: serverTimestamp() });

// In the order they were added.
export function viewsFromDocs(docs) {
  return [...docs]
    .sort((a, b) => a.order - b.order)
    .map((d) => ({ id: d.id, label: d.label, filters: JSON.parse(d.filtersJson), chatId: d.chatId ?? null }));
}

// The next list after a change the board made from `base` (the list it
// rendered): `current` may already hold a view another tab added since, which
// must not be dropped as if the board had removed it.
export function applyViewChange(current, base, next) {
  const removed = new Set(base.filter((v) => !next.some((n) => n.id === v.id)).map((v) => v.id));
  const added = next.filter((n) => !base.some((v) => v.id === n.id));
  return { removed, added, views: [...current.filter((v) => !removed.has(v.id) && !added.some((a) => a.id === v.id)), ...added] };
}

export function useBoardViews(uid) {
  const cacheKey = `vm-board-views:${uid}`;
  // Before the first snapshot: this browser's copy, or (the first visit after
  // views moved to Firestore) the browser-only list being uploaded below.
  const [views, setViewsState] = useState(() => readJson(cacheKey, null) ?? legacyViews());
  const [error, setError] = useState(null);
  const viewsRef = useRef(views);

  const commit = (next) => {
    viewsRef.current = next;
    setViewsState(next);
    localStorage.setItem(cacheKey, JSON.stringify(next));
  };

  const fail = (what) => (err) => setError(`Could not ${what} the filter view: ${err.message}`);

  useEffect(() => {
    const legacy = legacyViews();
    if (legacy.length) {
      const start = Date.now();
      Promise.all(legacy.map((v, i) => setDoc(viewDoc(uid, v.id), toFirestore(v, start + i))))
        .then(() => localStorage.removeItem(LEGACY_KEY))
        .catch(fail("move"));
    }
    return onSnapshot(
      collection(db, "users", uid, "boardViews"),
      (snap) => commit(viewsFromDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
      fail("load"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commit/fail only touch state and refs
  }, [uid]);

  const setViews = (next) => {
    const change = applyViewChange(viewsRef.current, views, next);
    commit(change.views);
    setError(null);
    const start = Date.now();
    change.added.forEach((v, i) => setDoc(viewDoc(uid, v.id), toFirestore(v, start + i)).catch(fail("save")));
    change.removed.forEach((id) => deleteDoc(viewDoc(uid, id)).catch(fail("delete")));
  };

  return [views, setViews, error];
}
