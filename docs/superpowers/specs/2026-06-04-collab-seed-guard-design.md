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

### Unbounded settle delay under continuous joins

Each awareness change resets the 50 ms timer, which could theoretically push seeding out
indefinitely if peers trickle in one-by-one. In practice this app has ≤5 concurrent users;
even if all five join 20 ms apart, the worst-case delay is ~180 ms (4 resets × 50 ms minus
overlap) — imperceptible and far below any user-visible threshold. No maximum-wait cap is
needed at this scale.

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
//
// NOTE: yProvider.awareness.getStates() always includes the local client's own
// entry (Yjs awareness invariant), so myClientID will normally appear in the
// list. isElectedSeeder treats an empty/absent list as "sole client" as a
// defensive fallback only.
//
// Safe for this app's scale (≤20 concurrent users). Math.min spread would throw
// RangeError on thousands of entries, but that scenario does not apply here.
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

### Background: `fragmentKey`

`fragmentKey` is a prop on `CollabBodyEditor` (the Yjs XmlFragment key — e.g., a topic ID or
`"openFloor"`). It is available in the closure of `reconcile()` without any changes.

### Background: `sanitizeHtml`

`sanitizeHtml` is already imported in `CollabBodyEditor.jsx` from `../../lib/agendaHtml.js`.
No new import is needed.

### `settleTimerRef`

A new `useRef(null)` beside the existing `debounceRef`. Holds the settle timeout ID. Cleared
(with `settleTimerRef.current = null` after `clearTimeout`) in the effect teardown and on every
`reconcile()` call.

### `reconcile()` — revised logic

```
reconcile():
  1. if (cancelled || !yProvider.synced) → return          [unchanged]
  2. fragmentHasContent = fragmentHasRealContent(ydoc, fragmentKey)
                          // fresh evaluation every call; NOT cached between outer + timer
  3. seed = sanitizeHtml(valueHtml) || ""                   [captured here, see stale-closure note]
  4. if decideSeedAction({ fragmentHasContent, seedHtml: seed }) !== "seed" → return
                          // fast exit for non-empty rooms; same call signature as today
  5. clearTimeout(settleTimerRef.current); settleTimerRef.current = null
  6. settleTimerRef.current = setTimeout(() => {
       settleTimerRef.current = null
       a. if (cancelled) return
       b. if (fragmentHasRealContent(ydoc, fragmentKey)) return   // re-evaluate: another client may have seeded
       c. awarenessIDs = [...yProvider.awareness.getStates().keys()]
       d. if (!isElectedSeeder(ydoc.clientID, awarenessIDs)) return   [not the winner]
       e. if (!fragmentHasRealContent(ydoc, fragmentKey))    // final guard: unchanged double-check
            editor.commands.setContent(seed, { emitUpdate: false })
     }, SEED_SETTLE_MS)
```

Steps 1–4 are unchanged from today — the election only fires when a seed is genuinely needed.
The inner calls at steps 6b and 6e call `fragmentHasRealContent(ydoc, fragmentKey)` directly
(re-evaluating, not using the `fragmentHasContent` variable from step 2) to get the freshest
state after the settle delay has elapsed.

**Awareness changes on non-empty rooms:** When a room already has content, every awareness
change (join/leave/cursor move) calls `reconcile()`, which exits at step 4
(`decideSeedAction → "skip"`) before reaching the settle timer. No timer is started; no
performance concern.

**Re-entrancy after seeding:** Once the elected client calls `setContent`, subsequent
`reconcile()` invocations (triggered by further awareness changes) will find
`fragmentHasRealContent → true` and exit at step 4. No double-seed is possible.

**Stale-closure safety for `seed`:** `seed` is computed at step 3 from `valueHtml` and captured
by the timer closure. `valueHtml` is a `useEffect` dep: if it changes before the timer fires,
React tears down the old effect (cancelling the timer via `cancelled = true` and
`clearTimeout(settleTimerRef.current)`) and runs a fresh effect. The timer therefore always
fires with the `seed` value that was current when it was started.

**Shared `reconcile()` for both event handlers:** `reconcile()` is registered as both the
`"synced"` handler and the `"change"` awareness handler. If `"synced"` fires after an awareness
change has already started the settle timer, `reconcile()` clears and restarts it — correct,
because it re-evaluates all state from scratch. No separate handler is needed.

### New awareness listener

```
const onAwarenessChange = () => reconcile();
yProvider.awareness.on("change", onAwarenessChange);
// cleanup:
yProvider.awareness.off("change", onAwarenessChange);
```

Registered and cleaned up inside the same effect, alongside the existing `"synced"` listener.
Full teardown order:
1. `cancelled = true`
2. `clearTimeout(settleTimerRef.current); settleTimerRef.current = null`
3. `yProvider.off("synced", onSynced)`
4. `yProvider.awareness.off("change", onAwarenessChange)`

---

## 5. Props Cleanup

Remove from `CollabBodyEditor`:

- `seedDocPath` prop — declared, never used
- `seedFlagField` prop — declared, never used
- Both lines in the JSDoc block

Known call sites (confirmed by grep of `src/`):

| File | Lines | Props to remove |
|---|---|---|
| `src/pages/AgendaDetail.jsx` | 467–468 | `seedDocPath`, `seedFlagField` (topic body, Working view) |
| `src/pages/AgendaDetail.jsx` | 494–495 | `seedDocPath`, `seedFlagField` (Open Floor, Working view) |
| `src/pages/AgendaDetail.jsx` | 1415–1416 | `seedDocPath`, `seedFlagField` (topic body, Overview view) |

These are the only three call sites. All are in `AgendaDetail.jsx`.

---

## 6. Testing

### Unit tests — `collabSync.test.js`

Add a new `describe("isElectedSeeder")` block:

| Case | Input | Expected | Notes |
|---|---|---|---|
| Sole client — empty array | `(5, [])` | `true` | defensive fallback; Yjs normally includes self |
| Sole client — undefined | `(5, undefined)` | `true` | same fallback |
| Self is minimum in a group | `(3, [3, 7, 12])` | `true` | normal two-client scenario |
| Self is not minimum | `(7, [3, 7, 12])` | `false` | normal two-client scenario |
| Two clients — self lower | `(2, [2, 9])` | `true` | |
| Two clients — self higher | `(9, [2, 9])` | `false` | |
| Only self in awareness (normal solo) | `(5, [5])` | `true` | standard Yjs solo case |

Also add a `describe("SEED_SETTLE_MS")` sanity test confirming the export is a positive number.

### Verification

Two isolated Chrome profiles required (same-browser tabs false-positive via y-indexeddb).
The `sk_dev_…` key is in `LIVEBLOCKS_SECRET_KEY` (`sk_dev_` prefix) — find it in the Vercel
dashboard (Production env, sensitive) or `.env.local`.

Test flow:

1. **Reset a non-critical agenda room's Yjs doc** by calling the Liveblocks REST API:
   `DELETE https://api.liveblocks.io/v2/rooms/<url-encoded-roomId>/ydoc`
   with `Authorization: Bearer <sk_dev_…>`. This clears the stored Yjs document without
   deleting the room. The room auto-recreates on next client connect. Use
   `agendaRoomId(agendaId)` from `src/lib/agendaRoom.js` to derive the correct room ID.
   Disconnect all clients before resetting or they will re-upload the existing doc immediately.
2. Open the agenda in Profile A and Profile B within ~100 ms of each other.
3. Observe: content appears once, not doubled.
4. Repeat with Profile A opened 5 s before Profile B (solo-client case).
5. Confirm rooms with existing content are unaffected (open any active agenda in both
   profiles simultaneously; content should not change).

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
