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
// browser-only version are uploaded once, as views with no chat.
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
const toFirestore = (v) => ({ label: v.label, filtersJson: JSON.stringify(v.filters), chatId: v.chatId ?? null, createdAt: serverTimestamp() });

// Oldest first; a view still waiting on its server timestamp is the newest.
export function viewsFromDocs(docs) {
  const ms = (d) => (d.createdAt ? d.createdAt.toMillis() : Infinity);
  return [...docs]
    .sort((a, b) => ms(a) - ms(b))
    .map((d) => ({ id: d.id, label: d.label, filters: JSON.parse(d.filtersJson), chatId: d.chatId ?? null }));
}

export function useBoardViews(uid) {
  const cacheKey = `vm-board-views:${uid}`;
  const [views, setViewsState] = useState(() => readJson(cacheKey, []));
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
      Promise.all(legacy.map((v) => setDoc(viewDoc(uid, v.id), toFirestore(v))))
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
    const before = new Set(viewsRef.current.map((v) => v.id));
    const after = new Set(next.map((v) => v.id));
    commit(next);
    setError(null);
    next.filter((v) => !before.has(v.id)).forEach((v) => setDoc(viewDoc(uid, v.id), toFirestore(v)).catch(fail("save")));
    [...before].filter((id) => !after.has(id)).forEach((id) => deleteDoc(viewDoc(uid, id)).catch(fail("delete")));
  };

  return [views, setViews, error];
}
