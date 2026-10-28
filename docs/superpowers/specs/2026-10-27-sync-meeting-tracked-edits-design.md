# Sync Meeting — Tracked Changes + Editable Proposal

**Date:** 2026-10-27 · **Author:** Andrew (with Claude) · **Status:** approved design, not yet planned

## Goal

In the Sync Meeting review step, the person can:

- **A.** edit the text of the proposed agenda before applying it, and
- **B.** see a redline of what changed from the pre-sync agenda to the proposed agenda: struck-through deletions, highlighted insertions.

The redline covers only pre-sync → proposed (AI output plus the person's edits). No history beyond that.

## Decisions

| Decision | Choice |
|---|---|
| How editing and the redline relate | Two tabs, **Changes** (read-only redline) and **Edit** (clean, editable). Switching back to Changes re-diffs against the current edits. |
| Accept/reject individual changes | No. Apply takes the proposal as edited. |
| What is editable | Every topic body, Open Floor, and the titles of **new** topics. Retained topic titles stay locked (the existing title-lock in `applyUnified`). Adding, removing and reordering topics stays with Refine and the Delete checkboxes. |
| Diff engine | `jsdiff` (`diff` npm package), word level, inside block-aligned HTML. Formatting-only changes (bold, italic, links) do not show in the redline. Accepted 2026-10-27. |
| Anthropic API | None. The diff runs in the browser and is deterministic. The prepare and refine prompts do not change. |

VMStudio's client-review editor (`tiptap-track-changes`) records a person's keystrokes in suggest mode. It does not fit here: the AI writes a whole new agenda in one go, so there are no keystrokes to record. A computed diff is the right tool.

## Out of scope

- Claude commenting on the agenda or asking questions ("is this done?"). This is the expected later addition, and the only part that would need a second, separate API call. It must not be added to `/api/ai/prepare`.
- Accepting or rejecting individual changes.
- Keeping edits after Cancel. Cancel throws away the proposal and its edits, as it does today. Backdrop click and Escape already cannot close the dialog.
- Showing changes to topic order.

## Design

### 1. `diffAgendaHtml(beforeHtml, afterHtml)` — new pure helper

`src/lib/agendaDiff.js`. No React or Firebase imports. Takes two sanitized body HTML strings and returns HTML marked with `<del>` and `<ins>`.

1. Parse each side into an ordered list of **blocks**: `p`, `li` (its own text, not nested lists), and `table`. These are the block tags `sanitizeHtml` allows in bodies (no headings). Nested lists are flattened in document order and keep their depth, so the output can rebuild the nesting.
2. Line the blocks up by longest common subsequence on block text. Unmatched blocks on both sides at the same gap are paired in order as "changed" blocks, and the rest are plain inserts or deletes.
3. Matched or changed text blocks: word diff with `diffWords` from `jsdiff`, removed runs wrapped in `<del>`, added runs in `<ins>`. The output keeps the **after** block's inline markup for unchanged runs where that can be done cheaply. Otherwise it uses plain text plus marks. The plan picks one and states it.
4. Inserted block: wrapped whole in `<ins>`. Deleted block: wrapped whole in `<del>`.
5. Tables: if both tables have the same number of rows and columns, each cell is diffed as a text block. Otherwise the old table is shown struck and the new one inserted.
6. Equal input returns the after HTML unchanged (no marks).

The output only feeds the read-only Changes view and is never saved. `sanitizeHtml` (`src/lib/agendaHtml.js`) stays as it is: it guards saved bodies, which must never carry `del`/`ins`. Add a separate `sanitizeRedlineHtml` export beside it: the same `ALLOWED_TAGS` plus `del` and `ins`, used only by the Changes view.

`diff` becomes a direct dependency in `package.json`. The lockfile only has `diff@4.0.4`, pulled in through `ts-node`. Install the current major with an exact version pinned, and check the `diffWords` import shape for that version.

### 2. Building the redline for the whole agenda

Diffing happens **per topic**, not over the composed agenda HTML, because topics already line up through `ref` (`classifyTopicChanges` in `src/lib/syncMeeting.js`):

- **Retained** topic (`ref` points to a pre-sync topic): `diffAgendaHtml(prev.bodyHtml, proposed.bodyHtml)`, under the topic's heading.
- **New** topic: heading and body shown fully inserted.
- **Topic suggested for removal** (in `dropped` and shown to the AI): heading and body shown fully struck, with a caption pointing to its Delete checkbox. The checkbox stays where it is today, above the review box. Unchecked means Apply keeps the topic, as today.
- **Open Floor**: `diffAgendaHtml(prevOpenFloorHtml, proposal.openFloorHtml)`.

The baseline is taken **once, when the dialog mounts**: the existing `prevTopicsSnapshot` plus a new `prevOpenFloorHtml` snapshot of `agenda.openFloorHtml`. Topics added by someone else during review are not in the baseline and do not appear as dropped. This matches the existing `shownIds` rule.

A small pure function, `buildAgendaRedline(prevTopics, prevOpenFloorHtml, proposal, droppedShown)`, returns an ordered list of `{ kind: "retained" | "new" | "dropped" | "openFloor", topicId?, name, html }` for the view to render. It lives in `src/lib/agendaDiff.js` beside `diffAgendaHtml`.

### 3. Review UI — `SyncMeetingDialog.jsx`

The "Proposed agenda — review before applying" box (today a `dangerouslySetInnerHTML` preview of `composeAgendaHtml(proposal, …)`) becomes MUI `Tabs`: **Changes | Edit**. Changes is the default. The topic chips and the "AI suggests removing" Delete checkboxes above it stay as they are. The collapsed "Previous agenda" panel stays.

**Changes tab:** renders the `buildAgendaRedline` output, read-only. Styling: `del` gets a strikethrough in a muted red, and `ins` an underline or soft green background. Colours come from theme tokens (`src/theme/tokens.js`). No raw hex in the component. The same scroll box and type sizes as today's preview.

**Edit tab:** for each proposal topic, in order:
- the heading: locked text for a retained topic, a `TextField` for a new topic;
- a body editor;

then Open Floor with its own body editor.

The body editor is the existing, currently unused `src/components/editor/RichBodyEditor.jsx`, mounted unchanged in its default inline mode. It is a plain, non-collab TipTap editor with the same schema as `bodyContentExtensions()` (StarterKit with headings, code, blockquote and rules off, plus `TableKit`), so tables and lists survive a round trip. It keeps StarterKit's undo/redo, carries its own `EditorToolbar` and Cmd+K link handler, and flushes a pending change on unmount. (Corrected 2026-10-27: an earlier draft of this spec said it had no tables and proposed a new `ProposalBodyEditor`.)

It is mounted with `debounceMs={0}`, so each edit reaches `proposal` on the next tick, before a person can click Apply or Refine. A switch to Changes unmounts the editors, which flushes anything pending, so Changes always diffs the latest text. A Refine response replaces the proposal, and the editors must then reset to the new content. Add a `proposalRev` counter to the dialog, incremented on every prepare and refine result, and key the editors by it.

**Baselines.** Two sources, each used for one purpose:
- The **redline** diffs against the mount-time snapshot (`prevTopicsSnapshot`, `prevOpenFloorHtml`): "what the agenda looked like before this sync".
- The **chips, the title-lock in the Edit tab, and Apply** use the live `topics` prop through `classifyTopicChanges`, as today. That is what Apply will actually write against.

These differ only if someone changes the agenda's topics during review. If they do, the chips and the title-lock follow Apply.

### 4. Data flow

`proposal` (dialog state) stays the single source of truth. Edits write into it:

- topic body → `proposal.topics[i].bodyHtml`
- new-topic title → `proposal.topics[i].name` (only where `classifyTopicChanges` says `"new"`)
- Open Floor → `proposal.openFloorHtml`

What follows needs no change:

- **Refine** sends the current `proposal`, so the AI sees the edits. Refine's output replaces the proposal; edits it drops are lost, and the redline shows the result against the pre-sync baseline.
- **Apply** (`applyUnified`, `src/lib/aiAgenda.js`) already sanitizes and writes topic `bodyHtml` to Firestore and, through `updatedBodies` → `writeTopicBodies`, to the live Yjs fragments. Retained titles stay locked; new topics are created with their (possibly edited) `name`.

**One change to Apply: Open Floor must reach the live editor.** Today `applyUnified` writes `openFloorHtml` to the agenda doc only (`aiAgenda.js:596`). `updatedBodies` holds topic ids only, so the `"openFloor"` Yjs fragment (`AgendaDetail.jsx:581`, `fragmentKey="openFloor"`) is never written. The live fragment wins over Firestore once it has content (`topicBodyYjs.js`), so the old Open Floor stays on screen and can be saved back over the new text. This bug already affects AI-rewritten Open Floor today. It becomes a headline bug once Open Floor is editable. Fix: when the sanitized Open Floor differs from the current one, `applyUnified` adds it to `updatedBodies` under the key `"openFloor"`, This follows the same "write only if changed" rule as topics. `writeTopicBodies` needs no change: it calls `ydoc.get(key, Y.XmlFragment)` with each key as given, which is how `CollabBodyEditor` binds `fragmentKey="openFloor"`, and it skips a blank fragment, as it does for topics. Topic ids are Firestore auto-ids, so they cannot clash with `"openFloor"`.
- Board-change validation (`applyValidation`) runs on topic ids, not text, so edits do not affect it. A new topic whose title is cleared to empty still has its `topicId`. The plan decides whether an empty new-topic title blocks Apply (recommended: yes, with an inline error).

### 5. AI Integration page

Add a row to `HOW_IT_WORKS` in `src/pages/AIIntegration.jsx` (CLAUDE.md rule 4): the review step shows a redline against the pre-sync agenda and lets the person edit topic bodies, Open Floor and new-topic titles before Apply; edits go to Refine; the AI prompts do not change.

## Testing

- **Unit** (`src/lib/__tests__/agendaDiff.test.js`): `diffAgendaHtml` — equal input, word insert, word delete, replace, block insert, block delete, reordered blocks, nested list, same-shape table cell change, different-shape table, empty before, empty after. `buildAgendaRedline` — retained, new, dropped-shown, dropped-not-shown (topic added during review), Open Floor.
- **Component**: editing a topic body in the Edit tab updates `proposal`, and Apply is called with the edited `bodyHtml`. Editing a retained topic's title is not possible. Switching to Changes after an edit shows the edit as an insertion.
- **Apply**: `applyUnified` returns the Open Floor body under `"openFloor"` in `updatedBodies` only when it changed. `writeTopicBodies` writes it into the `"openFloor"` fragment.
- **Editor wiring**: an edit in a topic's or Open Floor's editor reaches `proposal` (component test with the editor stubbed). Typing in the real TipTap editor is checked in the browser.
- **Sanitizer**: `del`/`ins` survive `sanitizeRedlineHtml` and are still stripped by `sanitizeHtml`.
- **Browser** (CLAUDE.md rule 3, drive it yourself): open Sync Meeting on a real agenda, check both tabs, edit, Refine, Apply, reload, confirm the edited text is in the live editor, for a topic body **and** Open Floor. A fresh proposal needs a live `/api/ai/prepare` call (~$0.54 on Opus 5.5 fast). That call needs Andy's go-ahead with the price named first (global rule 14).

## Risks

- **Formatting-only changes are invisible** in the redline (accepted).
- **Block alignment on heavy rewrites**: when the AI rewrites most of a topic, the LCS pairs few blocks, and the redline reads as "all struck, all inserted". That is correct, but noisy. No mitigation in this version.
- **Inline markup in changed blocks**: if the plan settles on plain text plus marks for changed blocks, links and bold inside changed blocks show as plain text in the redline only. Saved content is unaffected.
