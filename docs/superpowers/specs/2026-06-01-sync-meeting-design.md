# Sync Meeting — Unified Agenda + Board Generation

**Date:** 2026-06-01
**Status:** Design (approved by Andy, revised through 2 spec-review rounds)
**Author:** Andy + Claude

## 1. Problem

Preparing a recurring meeting today requires two separate AI operations:

- **AI Gen** (`api/ai/generate.js` → `AIGenDialog`) — generates the **agenda** (topics with talking points, each carrying `categoryIds`/`tagIds`). Reads the project board as input; never writes to it.
- **Suggest Tasks** (`api/ai/suggest-tasks.js` → `SuggestTasksDialog`) — proposes **board changes** (new statusId-8 "AI Gen" tasks, status moves, notes). Reads the agenda title + board + transcripts; writes to `items/`.

These are **two independent LLM calls**, each choosing its own `categoryId`/`tagIds` for the same underlying concept. The Working view links a topic to its tasks purely by an **OR** category/tag match (`MiniProjectBoard.jsx:116-122`, `AgendaDetail.jsx:1220-1226`):

```js
if (it.categoryId && catSet.has(it.categoryId)) return true;                       // category match
if (Array.isArray(it.tagIds) && it.tagIds.some((t) => tagSet.has(t))) return true; // OR tag match
```

Because the two calls categorize independently, a freshly-proposed task can get a category that matches **no** topic, or a **different** topic than intended — so it never shows under the topic it was created for. The two also use separate time anchors (`lastAgendaGenAt`, `lastSuggestTasksAt`), so running one without the other lets agenda and board drift apart.

**This is a correctness problem.** The fix is to generate both from one shared understanding and have each created task derive its category/tags from the topic it belongs to.

### 1.1 What the join is and why it stays fuzzy

The category/tag OR-match is **intentional and must stay**. Topics live at `agendas/{id}/topics/{tid}` and are **deleted + rewritten on every generation** (new doc ids each time). Board `items` **persist across meeting cycles**. So the link from a regenerated topic to the still-living tasks it concerns *cannot* be a topic-id stored on the item (it would orphan on the next gen) — it has to be on stable global keys (category/tag slugs). This shapes the achievable guarantee (§2).

## 2. Goal & the honest guarantee

Replace the two operations with one **"Sync Meeting"** operation that:

- Assembles context **once**.
- Generates the agenda **and** board changes in **one model pass** with **one categorization decision**.
- Makes each created task **inherit its owning topic's category (and tags)**, so it is guaranteed to appear under that topic.
- Presents **one combined review**.
- Applies everything in **one atomic Firestore transaction** that advances **one anchor** (`lastUnifiedGenAt`).

**Guarantee (precise):** a created task **will appear under the topic it was generated for** (its inherited category satisfies that topic's category-match). It is **not** guaranteed to appear under *only* that topic — if two topics share a category or tag, the task surfaces under both, which is the **existing, intended OR-join behavior for every task** (manual or AI), not a regression. The bug we eliminate is "task appears under the wrong topic / no topic"; the pre-existing trait we accept is "a task can appear under multiple topics that share keys."

> **Tunable:** creates inherit the topic's category **+ tags** by default (richest, matches how a human would tag). If multi-topic spread proves noisy, the v1 fallback is to inherit **category only** (tags empty), which minimizes spread since categories are usually distinct per topic. Default = category + tags.

~5 minutes latency is the accepted budget. Real latency at the higher `max_tokens` is **unverified** — must be measured (§10).

## 3. Non-goals / out of scope

- **Master Touch Base Working-view display.** The unified call can generate for master, but the master Working view scopes mini-boards by the agenda's single `organizationId`, so master mini-boards stay empty. Separate tracked item.
- Preserving manually hand-edited topics across *re-generations* (v2).
- Refine acting on board changes (Refine stays agenda-only; §6).

## 4. Architecture — single model pass (Approach A)

```
Sync Meeting button
        │
        ▼
assembleGenInputs(agenda, items, orgSlug, { master })   ← extended: also returns id-bearing `existingTasks`
        │
        ▼
POST /api/ai/prepare        (NEW endpoint; single streamed structured output)
   → { preBriefHtml, topics[], openFloorHtml, boardChanges{ creates, moves, notes } }
        │
        ▼
combined review dialog  (evolved AIGenDialog)   ← Refine (agenda-only) available here
        │
        ▼  on "Apply all":  validate(proposal)  →  applyUnified()  = ONE transaction
```

### 4.1 Context assembly

Reuse `assembleGenInputs()` for window/anchor/transcript/SOP/prior-agenda assembly, **extended** (committed, not optional) to return a new `existingTasks` field: the org's **full current board** — `{ id, title, status, categoryId }` per item, **not window-scoped**. This matters because `moves`/`notes` reference items by `itemId` that may be **older than the gen window**; the existing windowed `projectBoard` (`aiAgenda.js:181-193`, filtered to recent items and id-less) cannot be reused for that. The anchor field becomes `lastUnifiedGenAt`.

**First-run window:** with both old anchors gone and `lastUnifiedGenAt` unset, the first run per agenda falls through to `assembleGenInputs`'s ~21-day fallback (`aiAgenda.js:133-135`) — a deliberately wide window. Expected.

### 4.2 The single endpoint `api/ai/prepare.js`

Mirrors `generate.js`'s shape: `client.messages.stream({ model, max_tokens, thinking: adaptive, output_config: { effort: "medium", format: { type: "json_schema", schema } } }).finalMessage()` with the streaming guard and `max_tokens` stop-reason check. Streaming mandatory. The merged system prompt preserves verbatim-in-intent the existing rules from both endpoints: internal-vs-client branching, **PRESERVE HYPERLINKS**, "don't duplicate existing board tasks" for `creates`, and the move/note rules (shipped→Done, underway→In Progress, etc.; only when the record is clear).

## 5. The unified schema

```jsonc
{
  "preBriefHtml": "string",
  "topics": [{
    "topicId": "string",                 // stable proposal-local id (e.g. "t0","t1") minted by the endpoint
    "name": "string",
    "bodyHtml": "string",
    "categories": ["category-slug"],
    "tags": ["tag-name-or-slug"],
    "organizationId": "org-slug | null"  // master only
  }],
  "openFloorHtml": "string",
  "boardChanges": {
    "creates": [{ "title": "string", "topicId": "string", "note": "string" }],  // topicId → owning topic
    "moves":   [{ "itemId": "string", "title": "string", "toStatus": "string", "reason": "string" }],
    "notes":   [{ "itemId": "string", "title": "string", "note": "string" }]
  }
}
```

### 5.1 The join binding (and why `topicId`, not a positional index)

A create carries no category/tags of its own — it carries `topicId`, a **stable proposal-local identifier** minted by the endpoint at generation. On Apply, the created item **inherits** its owning topic's resolved keys: `item.categoryId = topic.categoryIds[0]`, `item.tagIds = topic.tagIds` (default; see §2 tunable). This guarantees the create satisfies its owning topic's category-match.

`topicId` is a **session-local key for binding creates↔topics during review/apply only** — it is **not** stored on the persisted item (the item joins via inherited category/tags, per §1.1). Using a stable `topicId` instead of a positional array index is required because **Refine can reorder/add/delete topics** (§6); a positional index would silently re-point a create at a different topic after a reorder. Refine (§6) must **preserve `topicId` for retained topics** and mint new ids only for added topics.

### 5.2 Deterministic validation (at generation **and** at Apply)

Pure function over `{ topics, boardChanges, existingTasks }`:

- Every `creates[].topicId` must match a topic in the **current** proposal, and that topic must have ≥1 resolved category (else the create has nothing to inherit → rejected, shown in the review's warning banner; never lands as an orphan).
- `moves[].itemId` / `notes[].itemId` must exist in `existingTasks`; unknown ids dropped + listed.
- `moves[].toStatus` must be one of `STATUS_MAP`'s keys (`Assigned|In Progress|Review|Done|Pending`); unknown dropped (matches today's silent-drop in `aiTasks.js:64-65`, made explicit).

**Runs again at Apply** because Refine can mutate topics (delete the owning topic, or strip its categories) between generation and Apply. Re-validation against the *current* proposal catches both the deleted-topic case (create's `topicId` no longer present → flagged) and the lost-category case. Apply is blocked while unacknowledged rejections exist.

## 6. Combined review UX

Evolve `AIGenDialog` into the combined surface (approved preview):

```
┌─ Sync Meeting: <agenda title> ─────────────────────┐
│ AGENDA                                [Refine ▸]    │
│   • <topic name>            … (existing topic view) │
│  ⚠ 1 suggested task dropped (topic lost its category)│
│                                                     │
│ BOARD CHANGES                                       │
│   + New (n)    ↑ Moves (n)    ✎ Notes (n)           │
│   ☑ "<new task>"   under <topic name>  [status ▾][@ ▾]│
│   ☑ "<existing>"   In Progress → Done   <reason>    │
│   ☑ "<existing>"   ✎ <note>                         │
│        [Discard]              [Apply all ▶]         │
└─────────────────────────────────────────────────────┘
```

- **Agenda** section: existing topic proposal view + the existing **Refine** box (agenda-only — re-refines `topics`/`preBriefHtml`/`openFloorHtml` via `refine.js`, **preserving `topicId` for retained topics**; does not touch board changes).
- **Board changes**: three checkable groups, accept checkbox per row (default checked).
  - **New** rows: checkbox + **owning-topic label** (resolved from `topicId`, so the linkage is visible) + an **optional inline status/assignee** control. The model does **not** propose a status — new tasks default to triage (statusId 8). The only path to a real status/assignee is the human setting it here (single source of truth — closes the model-vs-human ambiguity).
  - **Moves**: title + `from → to` + one-line reason. **Notes**: item title + note text.
- **Footer**: Discard / Apply all. Apply disabled while generating/refining or while unacknowledged validation rejections exist.
- **Warning banner**: lists dropped creates (topic missing/no category) and unknown-itemId moves/notes.

## 7. Apply — `applyUnified(agendaId, orgSlug, proposal, accepted, uid, { master })`, ONE transaction

The entire apply is a **single Firestore `runTransaction`**, replacing today's split `applyProposal` (batch) + `applyTaskChanges` (transaction + batch). For one agenda the write count — topics (~5-10, delete + rewrite), creates (~5), moves/notes (~10), coined tags, org counter(s), anchor — is far under Firestore's 500-writes/transaction limit, so one transaction is feasible and makes the whole apply **atomic**: no partial commit, no resumable-step machinery, no early anchor.

**Transaction body (reads before writes, per Firestore rules):**
1. **Reads first:** the org `nextItemNumber` doc(s) (one per org for master); the `items` referenced by accepted `notes` (need current `description` for the append + contains-check). Categories/tags reference data is read **outside** the transaction (stable lookup) and passed in for slug resolution.
2. **Writes:**
   - Agenda: `preBriefHtml`, `openFloorHtml`, `updatedAt/By`, **and `lastUnifiedGenAt`** (anchor advances only as part of the same atomic commit — can't advance on failure).
   - Topics: delete current (by ref, queried just before the transaction), write proposed topics (resolve categories/tags as `applyProposal` does today, `sortOrder = i+1`, `organizationId` for master), create coined layer-3 tags. **Coined-tag writes are rebuilt fresh on each transaction attempt** (Firestore auto-retries on contention) so a retry can't double-create tags — the existing `writeCreates` pattern (`aiTasks.js:147-160`).
   - Creates (accepted): `statusId 8` unless the review promoted them; **inherit** the `topicId` topic's `categoryId`/`tagIds` (§5.1); `itemNumber` from the counter, incremented in-transaction. **Master:** creates grouped by their topic's `organizationId`, each org's counter read in step 1 and incremented independently.
   - Moves: set `statusId`. Notes: append `"— {note}"` to `description` **only if not already present** (contains-check; today's `aiTasks.js:73-82` appends unconditionally).
3. **After commit (best-effort, outside the transaction):** one `aiGenLog` entry (as today — never gates the core apply).

**Atomicity result:** either the whole agenda+board update commits or none of it does; the anchor advances iff everything committed. This closes the partial-failure and early-anchor concerns without per-step tracking or de-dupe keys. On transaction failure the dialog surfaces the error and retains the proposal; the user simply hits Apply again (the transaction re-reads counters and re-resolves — idempotent by construction).

**Re-generation:** running Sync Meeting again scans transcripts since `lastUnifiedGenAt` and produces a **new** proposal; topics are **replaced** on Apply. The review gate means you see/Refine/Discard before replacement. Caveat: topics hand-edited since the last gen are replaced on Apply — acceptable for v1 (review gate protects against surprise); preserving manual topics is a v2 refinement.

## 8. Retirement (part of this work)

- Delete `api/ai/suggest-tasks.js`, `src/components/SuggestTasksDialog.jsx`.
- `src/lib/aiTasks.js`: the create/move/note write logic is **rewritten** into the single-transaction `applyUnified` (multi-org creates, topic-inherited keys, note contains-check, in-transaction counter). Remove the standalone `suggestTasks()` fetch. `tagSlug` / `STATUS_MAP` reused.
- `src/lib/aiAgenda.js`: `assembleGenInputs` **extended** to return id-bearing, unwindowed `existingTasks` (§4.1). `applyProposal` absorbed into `applyUnified`. `generateAgenda` replaced by the `prepare` call. `refineProposal`/`refine.js` stay (refine must preserve `topicId`).
- `AgendaDetail` ActionBar: the "AI Gen" + "Suggest tasks" buttons → a single **"Sync Meeting"** button; FE state renamed from the old `tasks` shape to `boardChanges`.
- Remove `lastAgendaGenAt` / `lastSuggestTasksAt`; add `lastUnifiedGenAt`. No data migration (timestamps; first run sets the new field — wide first-run window per §4.1).

## 9. Error handling

- **Generation failure / `max_tokens` stop:** surface in the dialog (as `generate.js` does); no proposal applied.
- **Validation:** structured output enforces shape; §5.2 deterministic check (generation **and** Apply) enforces topicId/itemId/toStatus constraints and reports drops in the banner.
- **Apply (transaction) failure:** atomic — nothing committed, anchor unchanged; surface the error, retain the proposal, user retries Apply.

## 10. Testing & verification

- **Automated:** structured-output schema; §5.2 validation as a **pure unit-tested function** over `{ topics, boardChanges, existingTasks }` (topicId resolves to a topic with a category; itemId known; toStatus in `STATUS_MAP`).
- **Latency measurement (required, gating):** the master agenda already needs streaming to clear the SDK 10-min guard at `max_tokens: 24000` (`generate.js:276-279`). The unified pass at a higher ceiling (target `master ? 32000 : 24000`, to tune) approaches the 300s `maxDuration` — measure real wall-clock on a representative client **and** master agenda before locking `max_tokens`. If it can't fit, fall back to Approach B (two-phase) from the brainstorm.
  - *Apply-side note:* folding everything into one transaction means an org-counter contention retry re-runs the whole apply (topics + creates + moves/notes), not just the counter slice — correctness is safe (fresh-per-attempt tag writes; deletes-by-ref and moves/notes idempotent on replay), but it adds wall-clock; keep an eye on it under concurrent edits.
- **Live verification on Vercel** (primary surface): run Sync Meeting on a real client agenda (e.g. Unio Weekly), inspect the combined proposal, Apply, confirm in the **Working view** that each accepted new task appears under its owning topic's mini board (linkage check) and that moves/notes landed on the right items. Internal (Vistamar) smoke test for the internal-scope branch.
- LLM **content** quality is reviewed by the human in the dialog — not asserted in tests.

## 11. Open/deferred refinements

- Preserve manually-added topics across re-generations (v2).
- Refine adjusting board changes (v2) — would re-run §5.2 over refined board changes.
- Master Touch Base Working-view per-topic-org scoping (separate item).
- If multi-topic spread (§2) is noisy in practice, switch creates to inherit category-only.
