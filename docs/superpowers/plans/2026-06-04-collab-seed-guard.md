# Collab Single-Writer Seed Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate content when two clients simultaneously open a fresh empty Liveblocks room by electing a single seeder (the client with the lowest `ydoc.clientID` in the current awareness set) after a short settle delay.

**Architecture:** A new pure function `isElectedSeeder(myClientID, awarenessClientIDs)` is added to `collabSync.js`. The seeding effect in `CollabBodyEditor.jsx` is extended with a `settleTimerRef` and an awareness change listener. When a seed is needed, the effect defers writing for 50 ms, then runs the election; any awareness change during the delay resets the timer. The content-based `fragmentHasRealContent` guard remains the primary check. Two unused props (`seedDocPath`, `seedFlagField`) are removed from the component and all three callsites in `AgendaDetail.jsx`.

**Tech Stack:** React 18, Yjs, Liveblocks (`@liveblocks/yjs`), TipTap v3, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-collab-seed-guard-design.md`

**Conventions:** No `console.log`, no commented-out code. Commit after each task. **Do NOT push** — stop at the deploy gate (Task 5).

---

## File Structure

| File | Action | Change |
|---|---|---|
| `src/components/editor/collabSync.js` | Modify | Add `SEED_SETTLE_MS` constant + `isElectedSeeder` function |
| `src/components/editor/__tests__/collabSync.test.js` | Modify | Add `isElectedSeeder` + `SEED_SETTLE_MS` tests |
| `src/components/editor/CollabBodyEditor.jsx` | Modify | Add `settleTimerRef`; extend seeding effect; remove unused props |
| `src/pages/AgendaDetail.jsx` | Modify | Remove `seedDocPath`/`seedFlagField` from 3 `<CollabBodyEditor>` call sites |

---

## Task 1: TDD — add `SEED_SETTLE_MS` and `isElectedSeeder` to `collabSync.js`

**Files:**
- Modify: `src/components/editor/__tests__/collabSync.test.js`
- Modify: `src/components/editor/collabSync.js`

- [ ] **Step 1: Add failing tests to `collabSync.test.js`**

  Append the following two `describe` blocks at the end of the file (after the `decideSeedAction` block):

  ```js
  describe("SEED_SETTLE_MS", () => {
    it("is a positive number", () => {
      expect(typeof SEED_SETTLE_MS).toBe("number");
      expect(SEED_SETTLE_MS).toBeGreaterThan(0);
    });
  });

  describe("isElectedSeeder", () => {
    it("sole client — empty array → seeds (defensive fallback)", () => {
      expect(isElectedSeeder(5, [])).toBe(true);
    });
    it("sole client — undefined → seeds (defensive fallback)", () => {
      expect(isElectedSeeder(5, undefined)).toBe(true);
    });
    it("self is minimum in a group → seeds", () => {
      expect(isElectedSeeder(3, [3, 7, 12])).toBe(true);
    });
    it("self is not minimum → does not seed", () => {
      expect(isElectedSeeder(7, [3, 7, 12])).toBe(false);
    });
    it("two clients — self is lower → seeds", () => {
      expect(isElectedSeeder(2, [2, 9])).toBe(true);
    });
    it("two clients — self is higher → does not seed", () => {
      expect(isElectedSeeder(9, [2, 9])).toBe(false);
    });
    it("only self in awareness (normal solo case) → seeds", () => {
      expect(isElectedSeeder(5, [5])).toBe(true);
    });
  });
  ```

  Also add `SEED_SETTLE_MS` and `isElectedSeeder` to the import at the top of the test file:

  ```js
  import {
    isLocalEditTransaction,
    isBlankContent,
    fragmentHasRealContent,
    decideSeedAction,
    SEED_SETTLE_MS,
    isElectedSeeder,
  } from "../collabSync.js";
  ```

- [ ] **Step 2: Run tests to confirm the new tests fail**

  ```bash
  npm test
  ```

  Expected: 8 new tests fail with "is not a function" / "is not exported". All 64 existing tests still pass.

- [ ] **Step 3: Add `SEED_SETTLE_MS` and `isElectedSeeder` to `collabSync.js`**

  Append the following to the end of `src/components/editor/collabSync.js` (after the `decideSeedAction` function):

  ```js
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
  ```

- [ ] **Step 4: Run tests to confirm all 72 tests pass**

  ```bash
  npm test
  ```

  Expected: `Tests  72 passed (72)` — 64 original + 8 new.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/editor/collabSync.js src/components/editor/__tests__/collabSync.test.js
  git commit -m "feat(collab): add SEED_SETTLE_MS + isElectedSeeder to collabSync"
  ```

---

## Task 2: Extend seeding effect in `CollabBodyEditor.jsx`

**Files:**
- Modify: `src/components/editor/CollabBodyEditor.jsx`

**Overview of changes:**
1. Add `SEED_SETTLE_MS, isElectedSeeder` to the import from `./collabSync.js`
2. Add `settleTimerRef` beside `debounceRef`
3. Replace the seeding effect body (keeping the same `useEffect` deps)

- [ ] **Step 1: Update the `collabSync.js` import (line ~26)**

  Change:
  ```js
  import { isLocalEditTransaction, fragmentHasRealContent, decideSeedAction } from "./collabSync.js";
  ```
  To:
  ```js
  import { isLocalEditTransaction, fragmentHasRealContent, decideSeedAction, isElectedSeeder, SEED_SETTLE_MS } from "./collabSync.js";
  ```

- [ ] **Step 2: Add `settleTimerRef` beside `debounceRef` (line ~115)**

  `debounceRef` is already declared as `const debounceRef = useRef(null);`. Add the new ref immediately after it:

  ```js
  const settleTimerRef = useRef(null);
  ```

- [ ] **Step 3: Replace the seeding effect body**

  The seeding effect currently reads (lines ~256–281):

  ```js
  useEffect(() => {
      if (!editor) return undefined;
      let cancelled = false;

      const reconcile = () => {
        if (cancelled || !yProvider.synced) return;
        const hasContent = fragmentHasRealContent(ydoc, fragmentKey);
        const seed = sanitizeHtml(valueHtml) || "";
        if (decideSeedAction({ fragmentHasContent: hasContent, seedHtml: seed }) !== "seed") return;
        // Re-check emptiness immediately before writing to minimise the duplicate window.
        if (!fragmentHasRealContent(ydoc, fragmentKey)) {
          editor.commands.setContent(seed, { emitUpdate: false }); // emitUpdate:false → no mirror write
        }
      };

      // The provider emits "synced" and exposes a .synced boolean getter. Only
      // reconcile AFTER sync so we've received the server's doc state.
      if (yProvider.synced) reconcile();
      const onSynced = (isSynced) => { if (isSynced) reconcile(); };
      yProvider.on("synced", onSynced);
      return () => {
        cancelled = true;
        yProvider.off("synced", onSynced);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, yProvider, ydoc, valueHtml]);
  ```

  Replace entirely with:

  ```js
  useEffect(() => {
      if (!editor) return undefined;
      let cancelled = false;

      const reconcile = () => {
        if (cancelled || !yProvider.synced) return;
        const hasContent = fragmentHasRealContent(ydoc, fragmentKey);
        const seed = sanitizeHtml(valueHtml) || "";
        if (decideSeedAction({ fragmentHasContent: hasContent, seedHtml: seed }) !== "seed") return;
        // Election: only the client with the lowest clientID in awareness seeds.
        // Defer writing by SEED_SETTLE_MS to let latecomers join awareness first.
        // Any awareness change resets the timer so the election re-runs with the
        // updated client set. valueHtml is a dep, so if it changes React tears down
        // this effect (cancelling the timer) and re-runs fresh — no stale-seed risk.
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          if (cancelled) return;
          if (fragmentHasRealContent(ydoc, fragmentKey)) return;
          const awarenessIDs = [...yProvider.awareness.getStates().keys()];
          if (!isElectedSeeder(ydoc.clientID, awarenessIDs)) return;
          if (!fragmentHasRealContent(ydoc, fragmentKey)) {
            editor.commands.setContent(seed, { emitUpdate: false });
          }
        }, SEED_SETTLE_MS);
      };

      if (yProvider.synced) reconcile();
      const onSynced = (isSynced) => { if (isSynced) reconcile(); };
      yProvider.on("synced", onSynced);
      const onAwarenessChange = () => reconcile();
      yProvider.awareness.on("change", onAwarenessChange);
      return () => {
        cancelled = true;
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
        yProvider.off("synced", onSynced);
        yProvider.awareness.off("change", onAwarenessChange);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, yProvider, ydoc, valueHtml]);
  ```

- [ ] **Step 4: Run tests to confirm all 72 tests still pass**

  ```bash
  npm test
  ```

  Expected: `Tests  72 passed (72)`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/editor/CollabBodyEditor.jsx
  git commit -m "feat(collab): single-writer seed guard — awareness election + settle timer"
  ```

---

## Task 3: Remove unused props `seedDocPath` / `seedFlagField`

**Files:**
- Modify: `src/components/editor/CollabBodyEditor.jsx` (JSDoc + destructuring)
- Modify: `src/pages/AgendaDetail.jsx` (3 call sites)

- [ ] **Step 1: Remove from JSDoc in `CollabBodyEditor.jsx` (lines ~86–87)**

  Delete these two lines from the JSDoc block:
  ```
   *   seedDocPath   — Firestore doc path string holding the seed flag
   *   seedFlagField — field name on that doc to lock seeding (string)
  ```

- [ ] **Step 2: Remove from prop destructuring in `CollabBodyEditor.jsx` (lines ~98–99)**

  The destructured props currently include:
  ```js
  seedDocPath,
  seedFlagField,
  ```
  Delete both lines.

- [ ] **Step 3: Remove from `AgendaDetail.jsx` callsite 1 (topic body, Working view, ~lines 467–468)**

  Find the `<CollabBodyEditor` block in the Working view that contains:
  ```jsx
          seedDocPath={`agendas/${agendaId}/topics/${topic.id}`}
          seedFlagField="collabSeeded"
  ```
  Delete both lines.

- [ ] **Step 4: Remove from `AgendaDetail.jsx` callsite 2 (Open Floor, Working view, ~lines 494–495)**

  Find the Open Floor `<CollabBodyEditor` block that contains:
  ```jsx
          seedDocPath={`agendas/${agendaId}`}
          seedFlagField="openFloorCollabSeeded"
  ```
  Delete both lines.

- [ ] **Step 5: Remove from `AgendaDetail.jsx` callsite 3 (topic body, Overview view, ~lines 1415–1416)**

  Find the Overview-view `<CollabBodyEditor` block that contains:
  ```jsx
              seedDocPath={`agendas/${agendaId}/topics/${topic.id}`}
              seedFlagField="collabSeeded"
  ```
  Delete both lines.

- [ ] **Step 6: Confirm no remaining refs**

  ```bash
  grep -rn "seedDocPath\|seedFlagField" src/
  ```

  Expected: no output (zero matches).

- [ ] **Step 7: Run tests to confirm still 72 passing**

  ```bash
  npm test
  ```

  Expected: `Tests  72 passed (72)`.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/editor/CollabBodyEditor.jsx src/pages/AgendaDetail.jsx
  git commit -m "chore(collab): remove unused seedDocPath/seedFlagField props"
  ```

---

## Task 4: Local UI verification

**Files:** none changed — verification only

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```

- [ ] **Step 2: Verify a normal (non-empty) agenda works**

  Using `/agent-browser` or Playwright, open any active agenda in the Working view. Confirm:
  - All topic bodies render with content (not blank)
  - Presence avatars appear
  - Editing a topic body and waiting 1.5 s → Firestore mirror fires (no console errors)

- [ ] **Step 3: Smoke-test the election path (solo client)**

  This requires resetting a non-critical room's Yjs doc first. Do this via the Liveblocks REST API:

  ```bash
  # Derive the room ID using agendaRoomId() from src/lib/agendaRoom.js — typically "agenda:<agendaId>".
  # Replace <sk_dev_…> with the LIVEBLOCKS_SECRET_KEY value from .env.local
  curl -X DELETE \
    "https://api.liveblocks.io/v2/rooms/agenda%3A<agendaId>/ydoc" \
    -H "Authorization: Bearer <sk_dev_…>"
  # Expected: HTTP 204
  ```

  Open the agenda in a single browser profile. Confirm content appears normally (solo client seeds after 50 ms settle).

- [ ] **Step 4: Confirm no doubled content in a normal existing-content room**

  Open any agenda with existing content in two browser tabs of the same profile (or two profile windows). Content should be identical in both — no doubling, no seeding triggers (rooms with content skip the election entirely).

  Note: full two-profile simultaneous-open race test requires two isolated Chrome profiles. That test is done at deploy/verify time (Andy, two profiles). The local smoke test above covers the solo path.

- [ ] **Step 5: Stop the dev server** (if started by this agent)

---

## Task 5: Deploy gate — STOP

**Do NOT push or deploy until Andy reviews this task.**

- [ ] **Step 1: Verify final test count**

  ```bash
  npm test
  ```

  Expected: `Tests  72 passed (72)` across 7 test files.

- [ ] **Step 2: Confirm no debug artifacts remain**

  ```bash
  grep -rn "console\.log\|TODO\|FIXME\|HACK" src/components/editor/CollabBodyEditor.jsx src/components/editor/collabSync.js
  ```

  Expected: no output (zero matches).

- [ ] **Step 3: Report to Andy**

  All three tasks are committed. Tests pass (72/72). Summarise the three commits and ask Andy to:
  1. Review the diff
  2. Verify on Vercel prod with two isolated Chrome profiles (see spec Section 6 for the verification procedure)
  3. Approve push to `origin/dev` + `npx vercel deploy --prod`
