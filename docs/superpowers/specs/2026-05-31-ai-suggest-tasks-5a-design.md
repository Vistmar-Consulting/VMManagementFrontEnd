# AI-Suggested Project Board Tasks (Slice 5a) — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design). Build directly + prod-verify.
**Sequence:** Last engine piece. Separate from agenda gen. v1 = new tasks only → statusId 8 (AI Gen). 5b later = status-moves + notes on existing tasks.

## 1. Goal

A separate admin action on the agenda — **Suggest tasks** — reads the meeting's window (transcripts + current agenda + other org agendas) with the **full Client SOPs**, and proposes NEW Project Board tasks (categorized + tagged) that surfaced from the meeting but aren't on the board yet. Proposed tasks land in **statusId 8 ("AI Gen")** — the human-triage column — after review. Safe by construction: even over-eager suggestions sit in triage for the human to promote or discard on the board.

## 2. Function — `api/ai/suggest-tasks.js` (new)

- Same auth/CORS/model as generate (`requireAuth` + @vistamar; `claude-sonnet-4-6`; `effort: "medium"`; `export const config = { maxDuration: 300 }`).
- Body: `{ agenda:{title}, transcripts, orgAgendas, existingTasks:[{title,status,category}], categories:[{slug,name,description,sop}], tagVocab, extraContext }`.
- System prompt (hardcoded v1 — a future editable Settings prompt): extract NEW actionable tasks the meeting surfaced that are NOT already on the board; one category slug + relevant tags each; concise action-oriented titles; a one-line `note` citing the source; do NOT duplicate `existingTasks`; use the **full SOPs** to frame tasks + identify the right owner/contact in the note. Include the 10 categories (slug·name·description) + full SOPs + tag vocab.
- **Structured output:** `{ tasks: [{ title, category, tags, note }] }` (json_schema). statusId 8 is implicit (set on apply).
- Returns `{ tasks }`.

## 3. FE — `src/lib/aiTasks.js` (new)

- `suggestTasks(payload)` — POST to `/api/ai/suggest-tasks` (X-User-Token), returns `{ tasks }`.
- `applyTaskSuggestions(orgSlug, tasks, uid)` — for each selected task, create an item: `{ organizationId: orgSlug, parentId: null, hasChildren: false, type: "task", title, description: note, statusId: 8, priorityId: null, categoryId: resolveCat(category), tagIds: resolve+create(tags), onHold:false, dueDate:null, assigneeIds:[], itemNumber (org counter), createdBy: uid, createdAt, updatedAt, order (fractional) }`. Reuses the category/tag resolution + coined-tag creation from `applyProposal` (extract a shared helper `resolveCategoryAndTags`). One writeBatch; bump `organizations/{org}.nextItemNumber`.
- Window inputs reuse `assembleGenInputs(agenda, items, orgSlug)` (it already returns transcripts, orgAgendas, categories WITH sop, tagVocab) — for suggest-tasks we send categories **with** full sop (unlike the agenda draft).

## 4. Dialog — `src/components/SuggestTasksDialog.jsx`

- Open → optional "Additional context" → Suggest. Working step (assembleGenInputs → suggestTasks). Review: a checkbox list of proposed tasks (default all checked), each showing title · category chip · tag chips · note. Apply → `applyTaskSuggestions(orgSlug, selectedTasks, uid)` → tasks land in the board's AI Gen column. Surfaces the ingestion summary line (reuse).

## 5. AgendaDetail

- Admin-only **Suggest tasks** button next to AI Gen in the top bar → opens SuggestTasksDialog (passes agenda, items, orgSlug).

## 6. Out of scope (5b+)

Status-moves + notes on existing tasks (needs selective per-change approval); an editable task-suggestion prompt in Settings; assignee inference; dedup beyond title-similarity (the model is told the existing titles). Security deferrals unchanged.

---
*End of spec.*
