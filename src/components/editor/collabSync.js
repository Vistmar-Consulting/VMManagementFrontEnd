import * as Y from "yjs";
import { ySyncPluginKey } from "y-prosemirror";

// TipTap's onUpdate hands a ProseMirror transaction. y-prosemirror tags any
// transaction it applies from a REMOTE Yjs update with { isChangeOrigin: true }
// under ySyncPluginKey. Return true only for genuine LOCAL user edits, so the
// Firestore mirror writes once (from the originating client) instead of N times.
export function isLocalEditTransaction(transaction) {
  const meta = transaction?.getMeta?.(ySyncPluginKey);
  return !meta?.isChangeOrigin;
}

// True when markup/text carries no real content: strip tags, <br>, &nbsp;, and
// non-breaking spaces, then check for non-whitespace. Shared by the seed
// decision and the Yjs-fragment content test so they agree on "blank".
export function isBlankContent(markupOrText) {
  return String(markupOrText || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/ /g, "")
    .replace(/<[^>]*>/g, "")
    .trim().length === 0;
}

// Does the Yjs XmlFragment hold REAL content?
//
// A Yjs XmlFragment bound to ProseMirror is NEVER truly "length 0" once an
// editor has mounted on it: y-prosemirror materialises a default empty
// <paragraph/>, so fragment.length === 1 for a visually-blank body. The old
// seed guard used `fragment.length > 0` to mean "already populated" — so an
// empty <paragraph/> read as populated, the self-heal refused to reseed, and
// the topic rendered blank forever (the blank-topic incident). Detect content
// by SERIALISING the fragment and checking for non-whitespace text instead.
export function fragmentHasRealContent(ydoc, fragmentKey) {
  const xml = ydoc.get(fragmentKey, Y.XmlFragment).toString();
  return !isBlankContent(xml);
}

// Pure seed decision. Firestore bodyHtml (seedHtml) is canonical; the Yjs
// fragment is transport. We deliberately do NOT consult any durable "seeded"
// flag/marker: a flag that says "seeded" while the fragment is blank is exactly
// what blanked topics before. Decide only from CURRENT content:
//   - fragment already has real content      -> "skip"  (never reseed; avoids clobber/dup)
//   - fragment blank AND Firestore blank too  -> "wait"  (nothing to seed yet; do NOT lock)
//   - fragment blank AND Firestore has content-> "seed"
export function decideSeedAction({ fragmentHasContent, seedHtml }) {
  if (fragmentHasContent) return "skip";
  if (isBlankContent(seedHtml)) return "wait";
  return "seed";
}

// Settle window (ms) before the single-writer election runs. Gives latecomers
// time to register their awareness state before the winner writes.
export const SEED_SETTLE_MS = 50;

// Returns true if this client should seed the empty room.
// The client with the lowest clientID in the current awareness set wins.
// yProvider.awareness.getStates() always includes the local client's own entry
// (Yjs awareness invariant), so myClientID will normally appear in the list;
// the empty/undefined fallback is defensive only.
// Safe for ≤20 concurrent users — Math.min spread is fine at this scale.
export function isElectedSeeder(myClientID, awarenessClientIDs) {
  if (!awarenessClientIDs || awarenessClientIDs.length === 0) return true;
  return myClientID === Math.min(...awarenessClientIDs);
}
