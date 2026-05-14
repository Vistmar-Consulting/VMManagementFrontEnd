import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../firebase.js";

// Subscribe to a single Firestore document via onSnapshot.
//   path: string like "users/abc123" or "items/xyz". Falsy disables the subscription.
// Returns { data, loading, error }. `data` includes `id` and is null when the doc is missing.
export function useDoc(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const ref = doc(db, path);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [path]);

  return { data, loading, error };
}
