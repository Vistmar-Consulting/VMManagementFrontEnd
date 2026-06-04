# Collab Single-Writer Seed Guard — Design Spec

**Date:** 2026-06-04  
**Status:** Approved for implementation  
**Area:** Collaborative agenda editing (Liveblocks + Yjs + TipTap)

---

## 1. Problem

`CollabBodyEditor` seeds an empty Yjs room from Firestore `bodyHtml` using a content-based,
self-healing approach: when a synced room's fragment has no real content but Firestore has HTML,
the component calls `editor.commands.setContent()` to populate the room.

This design has a race: two clients opening a fresh empty room simultaneously both see an empty
fragment, both decide to seed, and both call `setContent`. Because Yjs is a CRDT, both writes
are accepted and merged — producing doubled content. This bit us 2026-06-03 on the Biweekly
Marketing Updates agenda (two windows opened at once after the room was reset).

### Constraints

- **No durable seeded flag.** A Firestore or Liveblocks Storage flag that says "seeded" persists
  across room resets — exactly what caused the blank-display incident when a flag blocked
  reseeding of a legitimately empty reset room. This approach is permanently off the table.
- **Content-based guard stays.** `fragmentHasRealContent` and `decideSeedAction` remain the
  primary check. The election guard is a second layer, not a replacement.
- **Unused props removed.** `seedDocPath` / `seedFlagField` on `CollabBodyEditor` are currently
  unreferenced. They are removed as part of this fix.

---

## 2. Solution: Awareness Election with Settle Delay

Before writing to the Yjs doc, elect a single writer. Only the client whose `ydoc.clientID` is
the minimum value among all currently-visible `yProvider.awareness` states is allowed to seed.

A short **settle delay** (50 ms) is introduced between "I want to seed" and "I actually seed".
This gives latecomers time to register their awareness state before the election runs. Any
incoming awareness change during the settle window resets the timer, re-running the election
with the updated state.

### Why clientID-minimum?

Yjs assigns each `Y.Doc` instance a random integer `clientID` at construction time — stable for
the session lifetime, globally unique with overwhelming probability. The minimum is a fully
deterministic tie-breaker that requires no coordination channel, no coin flip, and no durable
state. Any other comparable scalar would work equally well; minimum is idiomatic in leader
election.

### Why 50 ms?

Liveblocks awareness messages round-trip in roughly 10–30 ms on a warm connection. 50 ms gives
~2× headroom without any perceptible UI delay. The settle window only fires for genuinely empty
rooms; rooms with existing content skip the election entirely via `decideSeedAction → "skip"`.

---

## 3. New Pure Function: `isElectedSeeder`

**Location:** `src/components/editor/collabSync.js`

```js
// SEED_SETTLE_MS: settle window before the election runs. Gives latecomers time
// to register their awareness before the winner writes.
export const SEED_SETTLE_MS = 50;

// Returns true if myClientID should seed the empty room.
// The client with the lowest awareness clientID wins the election.
// An empty or absent awareness list means this client is alone — seed.
export function isElectedSeeder(myClientID, awarenessClientIDs) {
  if (!awarenessClientIDs || awarenessClientIDs.length === 0) return true;
  return myClientID === Math.min(...awarenessClientIDs);
}
```

`isElectedSeeder` is a pure function: no side effects, no module-level state, no imports.
Exported alongside the existing `decideSeedAction` / `fragmentHasRealContent`.

---

## 4. Modified Seeding Effect in `CollabBodyEditor`

The existing seeding `useEffect` (deps: `[editor, yProvider, ydoc, valueHtml]`) is extended as
follows. No other part of the component changes.

### `settleTimerRef`

A new `useRef(null)` beside the existing `debounceRef`. Holds the settle timeout ID. Cleared in
the effect teardown and on every `reconcile()` call.

### `reconcile()` — revised logic

```
reconcile():
  1. if (cancelled || !yProvider.synced) → return          [unchanged]
  2. fragmentHasContent = fragmentHasRealContent(ydoc, fragmentKey)
  3. seed = sanitizeHtml(valueHtml) || ""
  4. if decideSeedAction(...) !== "seed" → return           [unchanged — fast exit for non-empty rooms]
  5. Clear any pending settle timer (settleTimerRef)
  6. Start a new settle timer for SEED_SETTLE_MS:
       a. if (cancelled) return
       b. if (fragmentHasRealContent(...)) return           [another client may have seeded during delay]
       c. awarenessIDs = [...yProvider.awareness.getStates().keys()]
       d. if (!isElectedSeeder(ydoc.clientID, awarenessIDs)) return   [not the winner]
       e. final guard: if (!fragmentHasRealContent(...))    [unchanged double-check]
            editor.commands.setContent(seed, { emitUpdate: false })
```

Steps 1–4 are unchanged from today — the election only fires when a seed is genuinely needed.

### New awareness listener

```
const onAwarenessChange = () => reconcile();
yProvider.awareness.on("change", onAwarenessChange);
// cleanup:
yProvider.awareness.off("change", onAwarenessChange);
```

Registered and cleaned up inside the same effect, alongside the existing `"synced"` listener.

---

## 5. Props Cleanup

Remove from `CollabBodyEditor`:

- `seedDocPath` prop — declared, never used
- `seedFlagField` prop — declared, never used
- Both lines in the JSDoc block

Any call sites passing either prop (identified at plan time by grep) remove them silently.

---

## 6. Testing

### Unit tests — `collabSync.test.js`

Add a new `describe("isElectedSeeder")` block:

| Case | Input | Expected |
|---|---|---|
| Sole client (empty array) | `(5, [])` | `true` |
| Sole client (undefined) | `(5, undefined)` | `true` |
| Is the minimum | `(3, [3, 7, 12])` | `true` |
| Is not the minimum | `(7, [3, 7, 12])` | `false` |
| Single other client, self is lower | `(2, [2, 9])` | `true` |
| Single other client, self is higher | `(9, [2, 9])` | `false` |
| All equal (degenerate) | `(5, [5])` | `true` |

Also add a `describe("SEED_SETTLE_MS")` sanity test confirming the export is a positive number.

### Verification

Two isolated Chrome profiles required (same-browser tabs false-positive via y-indexeddb).
Test flow:

1. Reset a non-critical agenda room via Liveblocks REST DELETE.
2. Open the agenda in Profile A and Profile B within ~100 ms of each other.
3. Observe: content appears once, not doubled.
4. Repeat with Profile A opened 5 s before Profile B (solo-client case).
5. Confirm rooms with existing content are unaffected.

---

## 7. Files Changed

| File | Change |
|---|---|
| `src/components/editor/collabSync.js` | Add `SEED_SETTLE_MS`, `isElectedSeeder` |
| `src/components/editor/CollabBodyEditor.jsx` | Extend seeding effect; add `settleTimerRef`; remove unused props |
| `src/components/editor/__tests__/collabSync.test.js` | Add `isElectedSeeder` tests |
| Any callsite passing `seedDocPath`/`seedFlagField` | Remove those props |

---

## 8. What Does Not Change

- `fragmentHasRealContent`, `decideSeedAction`, `isBlankContent` — no modifications
- The Firestore mirror path (`onUpdate` / debounce / flush-on-unmount / flush-registry) — untouched
- Liveblocks room schema — no new storage or presence fields
- `ANCHOR_SCROLL_MT`, TOC, AI sync, any other feature — untouched
