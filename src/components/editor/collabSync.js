import { ySyncPluginKey } from "y-prosemirror";

// TipTap's onUpdate hands a ProseMirror transaction. y-prosemirror tags any
// transaction it applies from a REMOTE Yjs update with { isChangeOrigin: true }
// under ySyncPluginKey. Return true only for genuine LOCAL user edits, so the
// Firestore mirror writes once (from the originating client) instead of N times.
export function isLocalEditTransaction(transaction) {
  const meta = transaction?.getMeta?.(ySyncPluginKey);
  return !meta?.isChangeOrigin;
}
