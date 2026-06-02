# Sync Meeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two separate AI operations (AI Gen + Suggest Tasks) with one "Sync Meeting" operation that generates the agenda and the board changes in a single model pass, reviews them together, and applies them in one atomic Firestore transaction.

**Architecture:** One assembled context snapshot → one streamed structured-output call (`api/ai/prepare.js`) returning `{ preBriefHtml, topics[], openFloorHtml, boardChanges{creates,moves,notes} }`. Each create carries a session-local `topicId` and inherits its owning topic's category/tags on apply, guaranteeing it shows under that topic. One combined review dialog. One `applyUnified()` Firestore transaction advancing a single `lastUnifiedGenAt` anchor. Old paths retired.

**Tech Stack:** React 18 + Vite + MUI + Emotion; Firebase Web SDK 11 (`runTransaction`); Vercel serverless (`api/`); `@anthropic-ai/sdk` (`claude-sonnet-4-6`, adaptive thinking, streamed structured outputs); vitest for pure-lib unit tests.

**Spec:** `docs/superpowers/specs/2026-06-01-sync-meeting-design.md` (read it first).

**Intentional deviation from spec §5 (read this):** the spec's schema shows the model emitting `topics[].topicId` and `creates[].topicId` directly. This plan instead has the model emit `topics[]` *without* ids and `creates[].topicIndex` (an integer position into `topics`); the **endpoint** mints `t0..tN` and rewrites each `topicIndex → topicId` before returning. This keeps the model's job trivial (it can't fumble string ids) while the **client/apply contract is unchanged** — everything downstream of the endpoint (`validateProposal`, `applyUnified`, the dialog) sees `topics`/`creates` carrying `topicId`, exactly as the spec specifies. The integer `topicIndex` exists *only on the wire into the endpoint*. **Refine differs:** refine has no `creates`, so it round-trips `topicId` *strings* (Task 4) — no `topicIndex` there. The two endpoints use different conventions on purpose and that is correct.

**Build/lint coverage caveat:** `npm run build` (`vite build`) and `npm run lint` (`eslint src/**`) cover **`src/` only** — they do **not** build or lint `api/` (Vercel serverless functions). Errors in `api/ai/prepare.js` / `api/ai/refine.js` are caught only by the **Vercel deploy** (and live run), not by local build/lint. Treat the deploy in Tasks 3/7 as the validation gate for `api/` changes.

**Project conventions (CLAUDE.md):**
- Work on local `main`, push `git push origin main:dev`, then `vercel alias set <deploy-url> vm-management-front-end.vercel.app`. No local feature branches.
- Primary test surface is the deployed Vercel site (+ live Firestore). Pure functions get vitest; endpoint/transaction/UI get build + lint + live verification via `/agent-browser` (UI HARD GATE).
- No `console.log` in committed code; no commented-out code; PascalCase components, camelCase utils; lower-camelCase field names across FE/Firestore/payloads.

**Testing reality:** Only the pure logic in `src/lib/syncMeeting.js` is unit-testable (vitest). The endpoint (calls Anthropic), the transaction (hits Firestore), and the dialog (UI) are verified by build + lint + live run on Vercel — do NOT invent unit tests that mock Anthropic/Firestore.

---

## File Structure

**Create:**
- `src/lib/syncMeeting.js` — pure helpers: `mintTopicIds`, `validateProposal`, `inheritKeysForCreate`. No Firebase/React imports.
- `src/lib/__tests__/syncMeeting.test.js` — vitest tests for the above.
- `api/ai/prepare.js` — the unified endpoint (merged prompt + combined schema + stream).
- `src/components/SyncMeetingDialog.jsx` — the combined review dialog (ported from `AIGenDialog.jsx` + `SuggestTasksDialog.jsx`).

**Modify:**
- `src/lib/aiAgenda.js` — extend `assembleGenInputs` (add unwindowed id-bearing `existingTasks`); add `prepareMeeting()` and `applyUnified()`; keep/adjust `refineProposal` to round-trip `topicId`; remove `generateAgenda` + `applyProposal` (absorbed).
- `api/ai/refine.js` — add `topicId` to schema + instruct preserve-on-retain.
- `src/pages/AgendaDetail.jsx` — one "Sync Meeting" button + `SyncMeetingDialog`; drop the AI Gen + Suggest tasks buttons/state.

**Delete:**
- `api/ai/suggest-tasks.js`, `src/components/SuggestTasksDialog.jsx`, `src/lib/aiTasks.js` (its write logic folds into `applyUnified`; move `STATUS_MAP`/`AI_GEN_STATUS` constants into `aiAgenda.js`).

**Anchors:** replace `lastAgendaGenAt`/`lastSuggestTasksAt` with `lastUnifiedGenAt` (no migration — timestamps; first run uses the wide fallback window).

---

## Task 1: Pure sync-meeting helpers (`src/lib/syncMeeting.js`) — TDD

**Files:**
- Create: `src/lib/itemStatusMap.js` (shared status constants — single source of truth)
- Create: `src/lib/syncMeeting.js`
- Test: `src/lib/__tests__/syncMeeting.test.js`

This module is the correctness core (the §5.2 validation + §5.1 key inheritance). Pure, no imports from Firebase/React. `validateProposal` runs on proposal receipt AND at apply.

First create the shared status constants so `MOVE_STATUSES` (Task 1) and `STATUS_MAP` (Task 5's `applyUnified`) can't drift — they are the same vocabulary:

```js
// src/lib/itemStatusMap.js — single source of truth for the status vocabulary
// the AI may target (moves) and the id mapping used at apply.
export const STATUS_MAP = { Assigned: 1, "In Progress": 2, Review: 4, Done: 5, Pending: 6 };
export const MOVE_STATUSES = Object.keys(STATUS_MAP);
export const AI_GEN_STATUS = 8; // "AI Gen" triage
```

(These values mirror today's `src/lib/aiTasks.js:23` `STATUS_MAP` and `AI_GEN_STATUS` — verify they match before deleting `aiTasks.js` in Task 8.)

- [ ] **Step 1: Write failing tests**

```js
// src/lib/__tests__/syncMeeting.test.js
import { describe, it, expect } from "vitest";
import { mintTopicIds, validateProposal, inheritKeysForCreate } from "../syncMeeting.js";

const topics = [
  { name: "Website", categoryIds: ["website"], tagIds: ["t-hours"] },
  { name: "GBP", categoryIds: ["gbp-directories"], tagIds: ["t-hours", "t-photos"] },
  { name: "Empty", categoryIds: [], tagIds: [] },
];

describe("mintTopicIds", () => {
  it("assigns stable t0..tN ids preserving order", () => {
    const out = mintTopicIds(topics);
    expect(out.map((t) => t.topicId)).toEqual(["t0", "t1", "t2"]);
    expect(out[0].name).toBe("Website");
  });
});

describe("validateProposal", () => {
  const existingTasks = [{ id: "item-1", title: "Old task" }];
  const withIds = mintTopicIds(topics);

  it("accepts a create whose topicId resolves to a topic with a category", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "New", topicId: "t0", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates).toEqual([]);
    expect(r.acceptedCreates.map((c) => c.title)).toEqual(["New"]);
  });

  it("rejects a create whose topicId is missing from the proposal", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "Orphan", topicId: "t9", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates.map((c) => c.title)).toEqual(["Orphan"]);
    expect(r.rejectedCreates[0].reason).toMatch(/topic/i);
  });

  it("rejects a create whose topic has no category to inherit", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: { creates: [{ title: "NoCat", topicId: "t2", note: "" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(r.rejectedCreates.map((c) => c.title)).toEqual(["NoCat"]);
  });

  it("drops moves/notes referencing unknown itemIds", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [],
        moves: [{ itemId: "item-1", title: "Old task", toStatus: "Done", reason: "shipped" },
                 { itemId: "ghost", title: "x", toStatus: "Done", reason: "y" }],
        notes: [{ itemId: "ghost", title: "x", note: "n" }],
      },
      existingTasks,
    });
    expect(r.acceptedMoves.map((m) => m.itemId)).toEqual(["item-1"]);
    expect(r.droppedMoves.map((m) => m.itemId)).toEqual(["ghost"]);
    expect(r.droppedNotes.map((n) => n.itemId)).toEqual(["ghost"]);
  });

  it("drops moves with an unknown toStatus", () => {
    const r = validateProposal({
      topics: withIds,
      boardChanges: {
        creates: [], notes: [],
        moves: [{ itemId: "item-1", title: "Old task", toStatus: "Frozen", reason: "x" }],
      },
      existingTasks,
    });
    expect(r.acceptedMoves).toEqual([]);
    expect(r.droppedMoves.map((m) => m.itemId)).toEqual(["item-1"]);
  });
});

describe("inheritKeysForCreate", () => {
  it("inherits the owning topic's first category and all tags", () => {
    const withIds = mintTopicIds(topics);
    const byId = Object.fromEntries(withIds.map((t) => [t.topicId, t]));
    const keys = inheritKeysForCreate({ topicId: "t1" }, byId);
    expect(keys).toEqual({ categoryId: "gbp-directories", tagIds: ["t-hours", "t-photos"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- syncMeeting`
Expected: FAIL — `syncMeeting.js` does not export these.

- [ ] **Step 3: Implement `src/lib/syncMeeting.js`**

```js
// Pure helpers for Sync Meeting. No Firebase/React imports — unit-tested in
// __tests__/syncMeeting.test.js and shared by the dialog (on receipt) and
// applyUnified (at apply). See spec §5.1 / §5.2.
import { MOVE_STATUSES } from "./itemStatusMap.js";

// Assign stable, session-local topic ids (t0..tN) preserving array order.
export function mintTopicIds(topics) {
  return (topics || []).map((t, i) => ({ ...t, topicId: `t${i}` }));
}

// A topic has usable category keys to inherit?
function topicHasCategory(t) {
  return Array.isArray(t?.categoryIds) && t.categoryIds.length > 0;
}

// Inherit the owning topic's first category + all tags (spec §5.1, default policy).
export function inheritKeysForCreate(create, topicsById) {
  const t = topicsById[create?.topicId];
  return {
    categoryId: t?.categoryIds?.[0] ?? null,
    tagIds: Array.isArray(t?.tagIds) ? [...t.tagIds] : [],
  };
}

// Validate a proposal against the current topics + the live board. Runs on
// receipt and again at apply (topics may have been refined between).
// `topics` MUST already carry topicId (call mintTopicIds first).
export function validateProposal({ topics, boardChanges, existingTasks }) {
  const byId = Object.fromEntries((topics || []).map((t) => [t.topicId, t]));
  const knownItemIds = new Set((existingTasks || []).map((it) => it.id));
  const moveStatuses = new Set(MOVE_STATUSES);

  const acceptedCreates = [];
  const rejectedCreates = [];
  for (const c of boardChanges?.creates || []) {
    const t = byId[c.topicId];
    if (!t) { rejectedCreates.push({ ...c, reason: "owning topic no longer in proposal" }); continue; }
    if (!topicHasCategory(t)) { rejectedCreates.push({ ...c, reason: "owning topic has no category to inherit" }); continue; }
    acceptedCreates.push(c);
  }

  const acceptedMoves = [];
  const droppedMoves = [];
  for (const m of boardChanges?.moves || []) {
    if (!knownItemIds.has(m.itemId)) { droppedMoves.push({ ...m, reason: "unknown itemId" }); continue; }
    if (!moveStatuses.has(m.toStatus)) { droppedMoves.push({ ...m, reason: "unknown toStatus" }); continue; }
    acceptedMoves.push(m);
  }

  const acceptedNotes = [];
  const droppedNotes = [];
  for (const n of boardChanges?.notes || []) {
    if (!knownItemIds.has(n.itemId)) { droppedNotes.push({ ...n, reason: "unknown itemId" }); continue; }
    acceptedNotes.push(n);
  }

  return {
    acceptedCreates, rejectedCreates,
    acceptedMoves, droppedMoves,
    acceptedNotes, droppedNotes,
    hasRejections: rejectedCreates.length > 0 || droppedMoves.length > 0 || droppedNotes.length > 0,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- syncMeeting`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/lib/itemStatusMap.js src/lib/syncMeeting.js src/lib/__tests__/syncMeeting.test.js
git commit -m "feat(sync-meeting): status constants + pure validation/topicId/key-inheritance helpers"
```

---

## Task 2: Extend `assembleGenInputs` with unwindowed id-bearing `existingTasks`

**Files:**
- Modify: `src/lib/aiAgenda.js` (`assembleGenInputs`, ~line 81-275)

`moves`/`notes` reference items by `itemId` that may be older than the gen window, so we need the **full current org board** with ids — separate from the windowed, id-less `projectBoard`.

- [ ] **Step 1:** Read `src/lib/aiAgenda.js` `assembleGenInputs` fully. Locate where `projectBoard`/`recentItems` is built from the passed-in `items` (~line 180-193) and the return object (~line 247-274).

- [ ] **Step 2:** Add a **new** `existingTasks` array to the return (this is **new code in `assembleGenInputs`** — today this id-bearing list is built inline in `SuggestTasksDialog.jsx:57-59` as `{ id, title, status, category }`; we move it here). Build it from the full passed-in `items` (NOT window-filtered). Match the field names the merged prepare prompt will read — the inherited `suggest-tasks.js` user message (`suggest-tasks.js:109`) reads `t.category` and `t.status`, so use **`category`** (the slug), **not** `categoryId`. Use **`it.title`** for the title (items store `title`; `aiAgenda.js`'s `projectBoard` uses `it.name`, which is a pre-existing bug — leave it, out of scope). For master, include all orgs' items (the function already gathers cross-org items for master); for per-org, just that org's. Reuse the existing `statusLabel`/`STATUS_OPTIONS` helper in `aiAgenda.js` for the label. Keep `projectBoard` as-is.

```js
// NEW, alongside the existing recentItems / projectBoard construction:
const existingTasks = (items || [])
  .filter((it) => !it.parentId) // parents only; moves/notes target top-level tasks
  .map((it) => ({
    id: it.id,
    title: it.title || "",
    status: statusLabel(it.statusId), // existing helper in aiAgenda.js (returns "?" for unknown)
    category: it.categoryId || null,  // slug; field name matches the suggest-tasks prompt
    organizationId: it.organizationId || null, // master routing
  }))
  .filter((t) => t.title);
// add `existingTasks` to the returned object
```

- [ ] **Step 3:** Change the default `anchorField` from `"lastAgendaGenAt"` to `"lastUnifiedGenAt"` (the param default at the function signature, ~line 81). Leave the fallback-window logic untouched.

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiAgenda.js
git commit -m "feat(sync-meeting): assembleGenInputs returns unwindowed id-bearing existingTasks + unified anchor"
```

---

## Task 3: Unified endpoint `api/ai/prepare.js`

**Files:**
- Create: `api/ai/prepare.js`
- Reference (read, do not modify): `api/ai/generate.js`, `api/ai/suggest-tasks.js`

Single streamed structured-output call returning agenda + board changes. Merge the two existing system prompts; keep internal-vs-client branching, PRESERVE HYPERLINKS, don't-duplicate, move/note rules.

- [ ] **Step 1:** Read `api/ai/generate.js` end-to-end (schema builder, system/user message builders, the `client.messages.stream({...}).finalMessage()` call with `max_tokens`, the `stop_reason === "max_tokens"` guard, model/effort) and `api/ai/suggest-tasks.js` (its creates/moves/notes schema + rules). **Critical:** `generate.js` uses **streamed** `.stream(...).finalMessage()` (its comment at ~line 276-279 documents that high `max_tokens` trips the SDK 10-min non-streaming guard), whereas `suggest-tasks.js` uses non-streaming `messages.create()`. When merging, **use generate.js's streamed shape — do NOT carry over `suggest-tasks.js`'s `messages.create()`** (it would throw at the unified call's higher token ceiling).

- [ ] **Step 2:** Create `api/ai/prepare.js`. Build `buildSchema(master)` returning the combined object schema (§5 of the spec):
  - `preBriefHtml`, `openFloorHtml`: string.
  - `topics`: array of `{ topicId, name, bodyHtml, categories[], tags[], organizationId? }`. (Endpoint mints `topicId` server-side as `t{index}` after the model returns — OR includes it in the schema and instructs `t0..tN` in order; minting server-side post-return is simpler and avoids the model fumbling ids. **Choose: mint server-side** with `mintTopicIds` logic inline, then the model references topics by **array position** in `creates[].topicIndex`, and the endpoint rewrites `topicIndex` → `topicId` before returning. This keeps the model's job simple and the client contract stable on `topicId`.)
  - `boardChanges.creates`: `{ title, topicIndex (integer), note }`.
  - `boardChanges.moves`: `{ itemId, title, toStatus, reason }`.
  - `boardChanges.notes`: `{ itemId, title, note }`.
  - master: topics require `organizationId`; the endpoint validates each create's resolved topic org and stamps `organizationId` onto the create.
- [ ] **Step 3:** Build `buildSystem(...)` by merging `generate.js` + `suggest-tasks.js` system prompts: agenda rules + board-change rules in one. Critical added rule: **"For each new task in boardChanges.creates, set topicIndex to the index of the topic (in the topics array) it belongs under. The task will inherit that topic's category and tags — do not categorize tasks yourself."** Keep internal/client branch, PRESERVE HYPERLINKS, don't-duplicate-existing, move/note guidance, "use only existing category slugs" for topic categories.
- [ ] **Step 4:** Handler: same call shape as `generate.js` (streamed `.finalMessage()`, `thinking:{type:"adaptive"}`, `output_config.effort:"medium"`, `format: json_schema`). **`max_tokens`:** today `generate.js` uses `master ? 24000 : 16000`. The unified pass does more work (agenda + board), so this plan *proposes* a higher ceiling `master ? 32000 : 24000` — but that is **unverified**; Task 9 Step 7 measures real wall-clock against the 300s `maxDuration` and is the gate that confirms or lowers it. Start at the proposed values, copy everything else verbatim from `generate.js`. Include the `stop_reason === "max_tokens"` 5xx guard. After parsing: mint `topicId` per topic (`t{i}`), rewrite each create's `topicIndex` → `topicId` (drop creates with out-of-range index), stamp create `organizationId` from its topic (master). Return `{ preBriefHtml, topics, openFloorHtml, boardChanges }`.

- [ ] **Step 5: Deploy + live shape check**

```bash
git add api/ai/prepare.js && git commit -m "feat(sync-meeting): unified prepare endpoint (agenda + board changes, single pass)"
git push origin main:dev
# wait for Ready deploy, then:
vercel alias set <new-deploy-url> vm-management-front-end.vercel.app
```
Then via `/agent-browser` on the live site, call `/api/ai/prepare` with a real agenda's assembled inputs (or temporarily wire a console trigger) and confirm the JSON shape: topics carry `topicId`, every create has a `topicId` matching a topic. (This is a shape smoke test; full flow verified in Task 9.)

---

## Task 4: `refine.js` preserves `topicId`

**Files:**
- Modify: `api/ai/refine.js`, and `refineProposal` in `src/lib/aiAgenda.js`

Refine returns a fresh topics array today with no id continuity (would break create↔topic binding). It must preserve `topicId` for retained topics.

- [ ] **Step 1:** Read `api/ai/refine.js` schema + prompt and `refineProposal` in `aiAgenda.js`.
- [ ] **Step 2:** Add `topicId` (string) to refine's `topics` schema. Add prompt rule: **"Each input topic has a topicId. Preserve the exact topicId on any topic you keep or edit. Only omit topicId for brand-new topics you add (a new id will be assigned)."** Pass the current proposal's topics (with topicId) into refine's user message.
- [ ] **Step 3:** In `refineProposal`, after the model returns, mint ids for any topic missing one (continue the `t{n}` sequence past the current max), and keep provided topicIds. Return refined topics all carrying `topicId`.
- [ ] **Step 4: Deploy + commit**

```bash
git add api/ai/refine.js src/lib/aiAgenda.js
git commit -m "feat(sync-meeting): refine preserves topicId for retained topics"
```
(Deploy folded into Task 7's push; or push now and re-alias.)

---

## Task 5: `applyUnified()` — single Firestore transaction

**Files:**
- Modify: `src/lib/aiAgenda.js` (add `applyUnified`, `prepareMeeting`; move `STATUS_MAP`/`AI_GEN_STATUS` here from `aiTasks.js`; absorb `applyProposal` logic)
- Reference: `src/lib/aiTasks.js` (`writeCreates` transaction + counter pattern, `applyTaskChanges` moves/notes, note-append), current `applyProposal` in `aiAgenda.js`

Whole apply is ONE `runTransaction` (reads before writes, <500 writes). Atomic; anchor advances only inside the commit. See spec §7.

- [ ] **Step 1:** Add `prepareMeeting({ ...assembled, master })` mirroring `generateAgenda` but POSTing to `/api/ai/prepare`; returns `{ preBriefHtml, topics, openFloorHtml, boardChanges }`.
- [ ] **Step 2:** Import `STATUS_MAP`, `AI_GEN_STATUS` from `./itemStatusMap.js` (created in Task 1) and `validateProposal`, `inheritKeysForCreate` from `./syncMeeting.js`. (Do not re-declare the status constants — `aiTasks.js`'s copies are deleted in Task 8.)
- [ ] **Step 3:** Implement `applyUnified(agendaId, orgSlug, proposal, accepted, uid, { master = false })`. `accepted` = the user's review selections: `{ createIdxs, moveIdxs, noteIdxs, promotions: { [createIdx]: { statusId, assigneeIds } } }`. Steps:
  - **Before tx:** query current topics (`getDocs(collection(db,"agendas",agendaId,"topics"))`) for delete refs; load categories + tags snapshots for slug resolution (reference data, read outside tx); run `validateProposal` again and throw if `hasRejections` against `accepted` (unacknowledged); build `topicsById` from `proposal.topics`.
  - **`runTransaction`:** 
    1. Reads: org `nextItemNumber` doc(s) — for master, the set of distinct orgs among accepted creates' topics; each note's target `items` doc (for current `description`).
    2. Writes: agenda doc (`preBriefHtml`, `openFloorHtml`, `updatedAt/By`, `lastUnifiedGenAt`); delete current topic refs + write proposed topics (resolve categories/tags exactly as `applyProposal` does — reuse its `resolveCat`/`resolveTag`, `sortOrder=i+1`, `organizationId` for master); create coined layer-3 tags **rebuilt fresh each attempt**; accepted creates → new `items` (statusId 8 unless promoted; `categoryId`/`tagIds` from `inheritKeysForCreate`; `itemNumber` from counter incremented in-tx; org from topic for master); accepted moves → `statusId`; accepted notes → append `"— {note}"` to `description` only if not already a substring.
  - **After commit (best-effort, outside tx):** one `aiGenLog` entry.
- [ ] **Transaction correctness notes (do not skip):**
  - **Reads strictly before writes.** Inside the tx, do **all** `tx.get(...)` first (org counter doc(s); each accepted note's target `items` doc), then all writes. Firestore rejects a read after a write.
  - **Topic deletes:** query current topics with `getDocs(...)` **before** the transaction (refs are stable across the tx's auto-retries); inside the tx, `tx.delete(ref)` needs no prior `tx.get`. This mirrors today's `applyProposal` pre-query pattern.
  - **Categories/tags read outside the tx** is acceptable (reference data, rarely changes mid-apply). Coined-tag `tx.set` is id-keyed (slug), so a concurrent double-coin is last-write-wins on the same doc — harmless. Rebuild the coined-tag write list **fresh on each tx attempt** (auto-retry) so a retry can't double-append to a list.
  - **Master multi-org counters:** collect the distinct `organizationId`s across accepted creates' topics; `tx.get` **every** org's `nextItemNumber` doc up front (in the reads phase), then increment each independently in the writes phase. One transaction, N counters.
  - **Note append:** append `"— ${note}"` (matching today's `aiTasks.js:78` format) to `description` **only if the current description does not already contain the raw `note` string** (test the raw `n.note`, not the dashed line, to avoid re-adding the same note in a different form).
- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiAgenda.js
git commit -m "feat(sync-meeting): applyUnified single-transaction apply (topics + board changes, one anchor)"
```

---

## Task 6: `SyncMeetingDialog` combined review

**Files:**
- Create: `src/components/SyncMeetingDialog.jsx`
- Reference: `src/components/AIGenDialog.jsx` (agenda review + Refine box + busy/refining state), `src/components/SuggestTasksDialog.jsx` (creates/moves/notes review rows)

- [ ] **Step 1:** Read both reference dialogs fully. Note `AIGenDialog.jsx` is a single monolithic default export with **no exported sub-components** — so `SyncMeetingDialog` is a **fresh component that copies the relevant JSX** (agenda-proposal rendering, the Refine box, busy/refining state) out of `AIGenDialog`, plus the board-change rows from `SuggestTasksDialog`. There is nothing to import/extract; the two old dialogs are deleted wholesale in Task 8.
- [ ] **Step 2:** Build `SyncMeetingDialog` (copy, don't reinvent):
  - On open: `assembleGenInputs(... { master })` → `prepareMeeting(...)` → store proposal; mint topicIds already done server-side; run `validateProposal` on receipt to populate the **warning banner** (rejected creates / dropped moves/notes).
  - **Agenda section:** reuse AIGenDialog's topic-proposal rendering + the existing **Refine** box (calls `refineProposal`; on return, re-run `validateProposal`).
  - **Board changes section:** three groups (New/Moves/Notes) with accept checkboxes (default checked, keyed by index). New rows: owning-topic label (resolve `topicId` → topic name), optional inline status `Select` + assignee `Select` (the `promotions` map). Move rows: `from → to` + reason. Note rows: item title + note.
  - **Footer:** Discard / Apply all. Apply disabled while `busy || refining` or while unacknowledged rejections exist. Apply → build `accepted` from checkboxes + promotions → `applyUnified(...)` → close.
- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync-meeting): combined review dialog (agenda + board changes + inline promote)"
```

---

## Task 7: Wire into `AgendaDetail` + deploy

**Files:**
- Modify: `src/pages/AgendaDetail.jsx`

- [ ] **Step 1:** Replace the "AI Gen" + "Suggest tasks" ActionBar buttons with one **"Sync Meeting"** button opening `SyncMeetingDialog`. Remove `suggestTasksOpen` state + the old `AIGenDialog`/`SuggestTasksDialog` imports/usages. Pass `master={isMaster}`.
- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 3: Commit + deploy**

```bash
git add src/pages/AgendaDetail.jsx
git commit -m "feat(sync-meeting): single Sync Meeting button replaces AI Gen + Suggest tasks"
git push origin main:dev
# wait for Ready, then alias:
vercel alias set <new-deploy-url> vm-management-front-end.vercel.app
```

---

## Task 8: Retire old paths

**Files:**
- Delete: `api/ai/suggest-tasks.js`, `src/components/SuggestTasksDialog.jsx`, `src/components/AIGenDialog.jsx`, `src/lib/aiTasks.js` (delete wholesale — `SyncMeetingDialog` copied what it needed in Task 6; nothing imports these once Task 7 is done)
- Modify: `src/lib/aiAgenda.js` (remove `generateAgenda`, `applyProposal`, and the now-duplicate status constants once nothing imports them)

- [ ] **Step 1:** `grep -rn "suggest-tasks\|SuggestTasksDialog\|aiTasks\|generateAgenda\|applyProposal\|AIGenDialog\|lastAgendaGenAt\|lastSuggestTasksAt" src api` — confirm no remaining references except what SyncMeetingDialog/applyUnified now own.
- [ ] **Step 2:** Delete the dead files; remove the dead exports. Ensure `STATUS_MAP`/`AI_GEN_STATUS` now live in `aiAgenda.js`/`itemStatusMap.js`.
- [ ] **Step 3: Build + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build clean, lint clean, vitest green (syncMeeting + agendaHtml).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(sync-meeting): retire suggest-tasks path, old dialogs, old anchors"
```

---

## Task 9: Live end-to-end verification (Vercel + agent-browser) — UI HARD GATE

**No code unless a defect is found.** Verify the real flow on the deployed site.

- [ ] **Step 1:** Deploy current main, `vercel alias set` the new deploy.
- [ ] **Step 2:** Via `/agent-browser` (visible Chrome on the authenticated 9222 profile; guard evals with the `vm-management-front-end.vercel.app` hostname check), open a real **client** agenda (e.g. Unio Weekly `0u55qjoteslnrjsmftmlinea7i_R20260407T200000`). Click **Sync Meeting**. Confirm: a combined proposal appears (agenda topics + New/Moves/Notes), warning banner only for genuine rejections.
- [ ] **Step 3:** Accept a couple of new tasks (leave as triage; promote one inline), accept a move + a note, **Apply all**. Confirm no error.
- [ ] **Step 4 (the linkage check):** In the **Working view**, expand the relevant topic cards and confirm each accepted new task appears under its owning topic's mini board; the move landed on the right item (status changed); the note appended once. Screenshot.
- [ ] **Step 5:** Re-open Sync Meeting and **Refine** the agenda (e.g. "merge the last two topics"); confirm creates still bind to the right topics (no orphan) and Apply still works.
- [ ] **Step 5b (rejection / re-validate-at-apply path — §5.2 core claim):** With a proposal that has at least one new task, **Refine to delete the topic that task belongs under** (e.g. "remove the X topic"). Confirm: the warning banner now lists that create as dropped (its owning topic is gone), and Apply either excludes it or is blocked on the unacknowledged rejection — it must **not** silently write an orphan task. This exercises the at-Apply re-validation, not just the on-receipt check.
- [ ] **Step 6:** Smoke test on the **Vistamar internal** agenda (internal-scope prompt branch): run Sync Meeting, confirm proposal is Vistamar-scoped, Apply, verify.
- [ ] **Step 7:** Record measured wall-clock for a client and (if convenient) a master run against the 300s ceiling (spec §10 gating note). If a run approaches the limit, flag for the two-phase fallback.
- [ ] **Step 8:** Report results (with screenshots) to Andy. No commit unless a fix was needed.

---

## Notes for the executor
- **Anthropic SDK:** model `claude-sonnet-4-6`, adaptive thinking, `output_config.effort:"medium"`, streamed `.finalMessage()`, `maxDuration:300`. Copy the exact call shape from `api/ai/generate.js` — do not invent parameters.
- **Firestore transaction rules:** all `tx.get(...)` before any `tx.set/update/delete`; rebuild coined-tag writes fresh on each attempt (transactions auto-retry on contention).
- **No mocks for Anthropic/Firestore.** Pure-logic tests only (Task 1). Everything else: build + lint + live.
- **Naming parity:** lower-camelCase field names everywhere (`boardChanges`, `topicId`, `lastUnifiedGenAt`).
