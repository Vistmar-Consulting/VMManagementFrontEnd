// Normalize a Firestore timestamp-ish value into a JS Date.
//
// Handles all three shapes we see in practice:
//   - Firestore Timestamp objects (have .toDate())
//   - Already-Date objects (passed through unchanged)
//   - Strings / numbers (parsed via new Date())
//
// Returns null for null/undefined input so callers can short-circuit
// rendering without a separate truthiness check.
export function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}
