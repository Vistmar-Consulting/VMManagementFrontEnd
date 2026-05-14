import { useMemo } from "react";
import { orderBy } from "firebase/firestore";

import { useCollection } from "./useCollection.js";

// V1 strategy: server returns all items ordered by fractional rank. Callers
// filter client-side by status, parent, org, etc. No composite indexes
// required while item counts are small (legacy SQL has ~85 items today).
// When item volume meaningfully exceeds ~500, swap to server-side filters
// and add composite indexes to firestore.indexes.json.
//
// Returns { data, loading, error } where data is items ordered by `order` asc.
export function useItems() {
  const constraints = useMemo(() => [orderBy("order", "asc")], []);
  return useCollection("items", constraints);
}
