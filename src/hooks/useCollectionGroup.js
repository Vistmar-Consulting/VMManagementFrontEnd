import { useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query } from "firebase/firestore";

import { db } from "../firebase.js";

// Module-level stable reference so callers that omit `constraints` don't
// re-subscribe every render.
const EMPTY_CONSTRAINTS = Object.freeze([]);

// Subscribe to a Firestore collection group (every subcollection that
// shares this name across the whole database) via onSnapshot.
//   groupName: e.g. "comments" → matches items/*/comments, plus any
//     other path that lands a doc in a `comments` subcollection.
//   constraints: array of QueryConstraints. Same memoization rules as
//     useCollection — pass a stable reference.
// Returns { data, loading, error }.
export function useCollectionGroup(groupName, constraints = EMPTY_CONSTRAINTS) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(groupName));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!groupName) {
      setData([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collectionGroup(db, groupName);
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref;

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [groupName, constraints]);

  return { data, loading, error };
}
