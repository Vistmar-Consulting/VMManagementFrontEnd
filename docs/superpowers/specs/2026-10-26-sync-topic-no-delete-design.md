# Sync Meeting — topics are never deleted by a sync

**Date:** 2026-10-26 · **Owner:** Andrew · **Status:** approved

## Rule

A topic card is deleted only by a person deliberately deleting it. Sync Meeting may suggest a removal; it never performs one on its own.

## Problem

`applyUnified` (`src/lib/aiAgenda.js`) deletes every topic doc and recreates the proposal's topics under new doc ids. A topic the model omits (the prompt allows omitting "fully complete" topics) is lost. The new ids are also what make AI bodies appear: the collaborative body (Yjs fragment keyed by topic id) only seeds from Firestore `bodyHtml` when empty, so a fresh id is an empty fragment.

## Design

1. **In-place apply.** A proposal topic whose `ref` names an existing topic updates that doc (same id, Firestore name and org kept — the existing title lock). A topic with no valid `ref` is created. A second proposal topic pointing at an already-claimed `ref` is created as new.
2. **Omitted topics are kept** unchanged, in their current relative order, after the proposal's topics (`sortOrder` continues after the last proposal topic).
3. **Removal is a human choice.** The review's "Dropped" line becomes **AI suggests removing**, one unchecked **Delete** checkbox per omitted topic. Only checked topics are deleted (`accepted.deleteTopicIds`). An id that is not an omitted topic is rejected.
4. **Live body write.** After the Firestore transaction commits, the dialog writes each updated topic's new body into its Yjs fragment on the agenda room's doc (one `ydoc.transact`): HTML → ProseMirror doc via the editor's own schema → `prosemirrorToYXmlFragment` into the cleared fragment. Remote-origin transactions do not trigger the Firestore mirror, so no write storm. New topics need nothing — empty fragment seeds from Firestore as today.
5. **Fail loudly.** Apply refuses before writing anything if the room's Yjs provider is not synced: "Live editor not connected — reload the agenda and retry."
6. **Shared schema.** The editor extension list moves to `src/components/editor/editorExtensions.js`, used by `CollabBodyEditor` and the new `src/components/editor/topicBodyYjs.js` (`writeTopicBodies(ydoc, bodiesById)`), so the parsed content matches what the editor renders.

## Added after code review (2026-10-26)

7. **Mirror guard key fixed.** `isLocalEditTransaction` read the sync meta with y-prosemirror's `ySyncPluginKey`, but TipTap v3 binds through `@tiptap/y-tiptap`, a different key object — every remote change read as local and each viewing client wrote it back to Firestore. Now uses y-tiptap's key (also the converter in `writeTopicBodies`), with a test against the real binding.
8. **Blank fragments are skipped** by `writeTopicBodies`; they seed from Firestore through the existing election. Writing them too raced that seed and could merge two copies.
9. **Unchanged bodies are not rewritten** (Firestore or fragment), so edits made in the room during review survive.
10. **Refine restore keeps identity.** The Previous agenda block sent to refine now carries `[ref: id]`, and the prompt says a restored topic takes it — otherwise a restore would add a duplicate next to the kept original.
11. **Post-commit failure.** If the live write throws after the commit, Apply stays disabled and the dialog says the agenda was saved but needs a reload. Residual risk: closing the tab in the instant between commit and the Yjs update leaving the browser leaves the old text in the live editor.
12. **Removal suggestions** list only topics the AI was shown (the dialog's snapshot at open); a topic added during review is simply kept.

## Unchanged

The prompt (it may still omit topics — that is now a suggestion), Version History Restore (deliberate human action), master sync (same code path), board changes.

## Surfaces to update

- `HOW_IT_WORKS` in `src/pages/AIIntegration.jsx` (repo rule 4).
- The presence `confirm()` text and the footer line that say Apply "replaces all topics".

## Tests

- `applyUnified`: retained topic updated in place (no delete); omitted topic kept and ordered after; only checked `deleteTopicIds` deleted; invalid delete id rejected; duplicate `ref` → second becomes new.
- `topicBodyYjs`: written fragment serialises to the expected content; replaces prior content; table HTML survives.
- `classifyTopicChanges` unchanged (dropped list feeds the checkboxes).
