import { useEffect, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";

import { db } from "../firebase.js";

// Module-level stable reference so callers that omit `constraints` don't
// re-subscribe every render.
const EMPTY_CONSTRAINTS = Object.freeze([]);

// Subscribe to a Firestore collection (or collection group later) via onSnapshot.
//   path: string like "items" or "items/xyz/comments". Falsy disables the subscription.
//   constraints: array of QueryConstraint values (where, orderBy, limit, ...).
//     The array reference is part of the subscription identity, so callers
//     SHOULD memoize via useMemo if they build it inline. Domain wrappers
//     (useItems, useUsers, etc.) own that responsibility.
// Returns { data, loading, error }. `data` is an array of {id, ...fields} documents.
export function useCollection(path, constraints = EMPTY_CONSTRAINTS) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) {
      setData([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = collection(db, path);
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
  }, [path, constraints]);

  return { data, loading, error };
}
