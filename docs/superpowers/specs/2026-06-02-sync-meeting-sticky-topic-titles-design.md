# Sync Meeting — Sticky Topic Titles (topic identity)

- **Date:** 2026-06-02
- **Author:** Andrew (design w/ Claude)
- **Status:** Draft for review
- **Slice type:** Sync Meeting correctness fix (standalone; precedes the agenda live-collaboration slice)

## 1. Problem

Sync Meeting's AI pass **renames existing agenda topics** every run. There is no concept of topic identity: the model's output schema is `{name, bodyHtml, categories, tags}` per topic, it writes every `name` freely, the current agenda's topics are handed to it only as context text, and `applyUnified` then **deletes all existing topics and recreates the model's set wholesale** (`src/lib/aiAgenda.js:524-540`). Nothing links a generated topic back to the specific existing topic it continues, so the AI can rename, merge, split, and reorder topics at will.

**Hard rule (Andy):** the AI must NEVER change the title of a topic that already exists. An existing topic's title is canonical. **Only a human may rename a topic**, and once they do, that new title is canonical and must persist across all future Sync Meeting runs.

## 2. Goal & non-goals

**Goal:** structurally guarantee that Sync Meeting can never alter an existing topic's title, while leaving the rest of Sync Meeting's behavior unchanged.

**In scope:**
- Topic identity carried through the AI round-trip via a `ref` (the existing topic's Firestore doc id).
- Apply-side enforcement: the title written for a continued topic always comes from Firestore, never from the model.
- Review modal shows a Retained / New / Dropped diff.

**Explicitly unchanged (status quo, all human-reviewed before apply):**
- Destroy-and-recreate apply remains (keeps the planned live-collaboration slice's clean per-topic reset intact — see [[2026-06-02 collab design, captured in session context]]).
- The AI may still **reorder** topics (order = the model's array order).
- The AI may still **drop** a topic (a topic it omits is removed on apply) — Andy confirmed; the review diff surfaces drops.
- Board changes (creates/moves/notes), categories, tags, Pre-Brief, Open Floor — untouched.

**Non-goals:** durable topic doc ids across runs (ids still churn on recreate — harmless because title is the canonical identity); collaborative editing; Pre-Brief removal.

## 3. Design

### 3.1 The core guarantee — the title for an existing topic never comes from the model

The model is given each current topic tagged with its Firestore doc id (`ref`), exactly mirroring the existing board-move pattern in the same prompt (`[itemId:…]`, "copy the existing title"). The model echoes `ref` back on every topic it carries forward. At apply, **a topic carrying a known `ref` is written with that existing topic's `name` read from Firestore — the model's `name` is discarded entirely.** Even if the model emits a reworded title, the reword is thrown away. That is the structural enforcement; the prompt instruction is a secondary, soft guard.

`ref` is independent of the existing session-local `topicId` (`t0…tN`, minted by `mintTopicIds` in `src/lib/syncMeeting.js` as the board-create→topic join key). The two coexist: `topicId` = positional join key for `boardChanges.creates.topicIndex`; `ref` = existing-topic identity for title locking.

### 3.2 Change sites

**`api/ai/prepare.js`**
- `buildSchema(master)` (line 38): add `ref: { type: "string" }` to `topicProps` and `"ref"` to `topicRequired` (applies to both master and non-master; `ref` is required, empty string `""` means "brand-new topic"). Structured-outputs can't express "optional," so `""`-as-sentinel is used and `ref` goes in `required` (consistent with this file's pattern — every property is in `required`, `additionalProperties:false`, line 45/57).
- Current-agenda topic rendering: in `buildUserMessage` ("## Current agenda" block at line 295; per-topic loop at **298-301**) and `buildMasterUserMessage` (loop at **232-235**), render each current topic as `[ref:<docId>] <title>` (and `[org:<slug>]` for master) so the model sees the id to echo. Requires the current topics to arrive **with their doc id** (see dialog change below).
- Output contract / system prompt (**lines 184-211**): add a **TOPIC IDENTITY** section: *"The current agenda's topics are listed below, each tagged `[ref:<id>]`. For every topic you carry forward from the current agenda, set its `ref` to that exact id and keep its title unchanged (the title is fixed by the system; do not reword it). Only a genuinely new topic may have a new title — set its `ref` to an empty string `""`. You may reorder topics and you may omit a topic whose work is fully complete."*
- **Handler reshape (the topics `.map`, ~lines 408-417):** the returned topic object does NOT currently carry `ref`. Add `ref: t?.ref ? String(t.ref) : ""` to the mapped object, or the dialog and `applyUnified` never see it. (The `topicId: \`t${i}\`` minting stays — independent.) **This is a required change site.**

**`api/ai/refine.js`** — refine has its **OWN** `buildSchema` (line 16), **not** shared with prepare; it must be edited separately:
- `buildSchema(master)` (line 16): add `ref: { type: "string" }` to `topicProps` and `"ref"` to `topicRequired`. (Note: `topicId` is in this schema's props but currently omitted from `topicRequired` (line 24) — the same not-required anti-pattern. Add `ref` to `topicRequired`; consider also adding `topicId` for consistency, but at minimum `ref` must be required to honor the `""`-sentinel contract.)
- `buildSystem` already carries a "PRESERVE TOPIC IDS" instruction (~line 69) — extend it to also **preserve each topic's `ref` verbatim**.
- `buildUserMessage` (~lines 77-95): render the proposal's topics with their `[ref:…]` tag so the model echoes it back.
- **Handler reshape (~lines 136-145):** the refined topic object must carry `ref` through — add `ref: t?.ref ? String(t.ref) : ""` to the mapped object (mirrors the existing `topicId` passthrough at line 138).
- `refineProposal` in `aiAgenda.js` (line 320) mints `topicId` for topics lacking one — leave as is; `ref` rides through untouched once the refine handler returns it.

**`src/lib/aiAgenda.js` — `applyUnified` (function starts line 402; topic recreate loop 524-542)**
- After reading `curTopics` (line 452-456, via `Promise.all` **outside** the transaction), build `const curNameById = new Map(curTopics.docs.map((d) => [d.id, d.data().name || ""]))` and (master) `curOrgById` similarly. **Reading these outside the tx is intentional and correct** — they're plain Maps consumed in the writes phase, not `tx.get` calls, so no reads-before-writes violation. A few-ms-stale name is acceptable here: Sync Meeting is single-admin, so no concurrent rename of the same doc mid-apply. Do NOT "fix" this by moving the read into the tx (it would add N pointless reads-before-writes).
- In the recreate loop (524-542), replace `name: String(t.name || "")` (line 531) with:
  ```js
  const retained = t.ref && curNameById.has(t.ref);
  // … name field:
  name: retained ? curNameById.get(t.ref) : String(t.name || ""),
  organizationId: retained && curOrgById.has(t.ref)
    ? curOrgById.get(t.ref)
    : (t.organizationId || null),
  ```
  So a retained topic keeps its canonical title (and, for master, its org); a new topic uses the model's. Everything else in the loop is unchanged. (Topic docs store the title in **`name`** — confirmed `aiAgenda.js:261,531,536` — not `title`; items use `title`, topics use `name`.)

**`src/components/SyncMeetingDialog.jsx`**
- Line 201: change `topics: (topics || []).map((t) => ({ name: t.name || "", bodyHtml: t.bodyHtml || "" }))` to include the id: `({ id: t.id, name: t.name || "", bodyHtml: t.bodyHtml || "" })`. **Verified safe:** `topics` reaches the dialog from `AgendaDetail.jsx:1553` `useCollection("agendas/{id}/topics")` (which returns `{id, ...data}` per doc) → passed `topics={topics}` at `:1962-1965`, so `t.id` is present.
- Review section (~lines 413-435): compute and render a **Retained / New / Dropped** diff:
  - For each `proposal.topics[i]`: `ref && currentIds.has(ref)` → **Retained** (title-locked badge); else → **New**.
  - For each current topic whose id is not referenced by any `proposal.topics[].ref` → **Dropped** (listed separately so a human can catch a mis-mapped rename surfacing as drop+add).
  - `currentIds = new Set((topics || []).map((t) => t.id))`.

**`src/lib/syncMeeting.js`**
- Add a small normalizer used on receipt and at apply: any topic whose `ref` is non-empty but not in the current-topic id set is normalized to `ref: ""` (treated as new) — defends against a hallucinated id. Unit-test it. `validateProposal` is otherwise unchanged (the board-create join still keys on `topicId`).

### 3.3 Data flow (unchanged except for `ref`)

```
AgendaDetail.topics (with doc ids)
  → SyncMeetingDialog passes {id,name,bodyHtml} per current topic
  → prepareMeeting → /api/ai/prepare renders "[ref:<id>] <title>" + schema with ref + identity prompt
  → model returns topics each with ref ("" = new)
  → (optional Refine: ref preserved)
  → review modal: Retained/New/Dropped diff
  → applyUnified: retained topics' name (and master org) taken from Firestore, model name discarded
```

## 4. Failure modes & mitigations

- **Model forgets `ref` on a continued topic** → it renders as New + the original shows as Dropped in the review diff → human catches it before apply. (The direct-rename path is structurally closed; this indirect path is review-gated, which is why the diff is in scope.)
- **Model hallucinates a `ref`** → normalizer (3.2, `syncMeeting.js`) downgrades it to New; the real topic still shows Dropped if also omitted.
- **User renames a topic** → the rename writes `name` to Firestore via the existing topic-title editor; the next Sync Meeting sends that as the fixed title; canonical persists. No special handling.

## 5. Testing

- **Unit (`src/lib/__tests__/syncMeeting.test.js`):** the `ref` normalizer — valid ref kept, unknown ref → `""`, empty stays empty.
- **Manual / prod (Vercel, real agenda, UI hard gate):**
  1. Pick an agenda; note exact topic titles. Run Sync Meeting → confirm the proposal reuses those titles verbatim and marks them Retained.
  2. Adversarial: add a Refine instruction nudging a rename ("rename the CyberKnife topic") → confirm the applied agenda still shows the original title (apply-side discard works).
  3. Rename a topic by hand → run Sync Meeting → confirm the new title is retained.
  4. Confirm a genuinely new subject appears as New, and an omitted topic appears as Dropped.
  5. Confirm board creates still land under the right topic (topicId join intact) and categories/tags still flow.

## 6. Rollout

Additive; no data migration. Deploy FE + the two `api/ai/*` functions together (the schema and apply must ship in lockstep — an old apply with a new schema would ignore `ref`, a new apply with an old schema would see no `ref` and treat everything as new). Verify on Vercel prod per §5, then push `origin/dev` and re-point the prod alias.
