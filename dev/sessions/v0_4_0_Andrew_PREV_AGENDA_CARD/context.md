# Session: v0.4.0 — Previous Agenda Card in Sync Meeting

**Developer:** Andrew  
**Date:** 2026-06-10  
**Branch:** main → origin/dev  
**Status:** CLOSED

---

## Goal

Add a collapsible "Previous agenda" card to the Sync Meeting review step.

- Appears above "Proposed agenda — review before applying"
- Collapsed by default
- Shows the pre-generation agenda rendered as HTML
- Previous topics are also threaded into the AI refine call so "Bring back X and its contents" works

---

## Files Changing

1. `src/components/SyncMeetingDialog.jsx` — snapshot topics at mount, add card UI, pass prevTopics to refine
2. `src/lib/aiAgenda.js` — add prevTopics param to refineProposal, include in POST body
3. `api/ai/refine.js` — accept prevTopics, append ## Previous agenda block to user message + system prompt note

---

## What Shipped

### Previous Agenda Card + Refine Context
- `src/components/SyncMeetingDialog.jsx` — `prevTopicsSnapshot` (frozen at mount via `useState` lazy init), `prevOpen` toggle, `oldAgendaHtml` computed once via `useMemo([], [])`. Collapsible card inserted above "Proposed agenda" in the review step; uses `ChevronRight`/`ChevronDown` from lucide-react; same HTML styling as the proposal preview. `prevTopicsSnapshot` passed as `prevTopics` to `refineProposal`.
- `src/lib/aiAgenda.js` — `prevTopics` added to `refineProposal` params and included in the `/api/ai/refine` POST body.
- `api/ai/refine.js` — `prevTopics` accepted from body; `buildUserMessage` appends a `## Previous agenda` block (name + bodyHtml per topic) when non-empty; system prompt gains one sentence directing the model to use that section when restoring dropped topics.

---

## Deferred

Nothing.

---

## Session Close Summary

Single feature shipped: Previous Agenda collapsible card in Sync Meeting review step + AI refine context threading. 3 files changed, ~50 lines. Build clean. Not yet committed — commit + push to `origin/dev` to close.
