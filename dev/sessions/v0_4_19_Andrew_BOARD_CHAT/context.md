# Session v0.4.19 — Board Chat

**Date:** 2026-10-21 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/task-board-ai-chat` on `worktree-task-board-ai-chat`, cut from local `main` at `c923daf`

## Ask

A chat panel on the Task Board where the user talks to Claude (Anthropic API) about the board: answers questions about tasks and meetings, drives the board filters (including an AI filter narrowed to exactly the matching tasks/subtasks), and creates/updates/deletes tasks and subtasks after confirmation in a change modal. Running cost tracker per reply and per conversation.

## Decisions

- Writes confirmed in a modal (Apply / Cancel, per-change checkboxes).
- Model: latest Sonnet, resolved at runtime via the Models API — no pinned version (Andy, 2026-10-21).
- Tools run in the browser via the Firebase Web SDK; the server (`/api/ai/chat` on `dispatch.js`) only runs the model.
- Spec: `docs/superpowers/specs/2026-10-21-board-chat-design.md`.

## State

- Spec approved 2026-10-21 (name Board Chat; audit = createdVia on creates only). Plan: `docs/plans/2026-10-21-board-chat.md`.
- 2026-10-27: plan Tasks 1–10 built test-first, each with spec + quality review. Final whole-branch review: no Critical, Important items fixed. Rebased onto origin/dev (Meeting Sync session's Opus changes) and pushed to `origin/dev`. Build passes; Board Chat test files 138/138 (one modal test hit the 5s default timeout once under load, passed alone).
- Amendments to the plan made during the build (code is the source of truth): writer-level field allowlist + conflict guards in `applyChangeSet`; the proposal layer rejects conflicting ops, double deletes, tempId clashes and bad values; at the 10-call cap pending tool calls are answered "not run"; `set_board_filter` validates every column value (`src/lib/boardChat/boardFilter.js`) and rejects an empty AI filter; `/api/ai/chat` validates message roles and caps size (413).
- 2026-10-27 Task 11: the first live call returned 400 "Schema is too complex", confirming the strict-schema risk. `strict` dropped from `set_board_filter` and `propose_changes` (`8124aee`, pushed, deployed). Re-verified in Chrome on production: a question about the ID Care meeting answered with the meeting time and the related items ($0.12); a filter request set the AI chip "ID Care meeting prep (10)" and narrowed the board ($0.03); a change request opened the Review changes modal with the correct diff, and Cancel wrote nothing; the model reported "no changes were made" ($0.02). Total spend $0.17. Board filters restored afterwards.
- Not exercised: Apply in the modal (a live write), Shift+Enter.
- 2026-10-27: fixed subtask refs. SI-N restarts under every parent, so the snapshot showed many identical "SI-1" refs and the model once invented "I-<raw id>" for a subtask. Subtask refs now carry the parent's (`I-4/SI-1`) in the snapshot, tool results and change labels, and the system prompt shows the form. Not re-verified live.

- 2026-10-27: Andy approved three additions (spec §13): a `?` hints popover in the panel header, switchable filter views (each Board Chat filter saves a chip; click toggles, x deletes, turning a view off restores the user's own filters; persisted in localStorage `vm-board-chat-views`), and a Reset button (views off, search/column/scorecard cleared, org pill kept). Code review: no Critical; the Important finding (several set_board_filter calls in one reply read stale state) fixed with `flushSync` in `TaskBoard.handleBoardChatFilter`; a jsdom test covers it but passed before the fix too, so the browser case is unproven. Also: a filter call that sets nothing now errors; a malformed views entry is ignored. Tests pass; build passes.
- 2026-10-27: Live check on vm-management-front-end.vercel.app passed ($0.16, two Board Chat requests): hints popover opens; "appointment data" and "blocked" each saved a chip; switching chips, turning a view off (restored org Vistamar + search "pipeline"), reload persistence, Reset (views off, filters cleared, chips kept) and x all worked. Board left as found. Not exercised: two filter calls in one reply (the flushSync case). Observed: Reset leaves the org a view set (All), as specified.
- 2026-10-27: Remaining checks, live ($0.20 Board Chat): Shift+Enter adds a line without sending; one reply with two `set_board_filter` calls saved two correct chips (flushSync case now proven in the browser); Apply created test task I-100 (status Assigned) and a second Apply deleted it — board left as found.
- 2026-10-27: Fixed (Andy approved): an active chip now reads "· edited" once the user changes filters by hand, and clicking it puts the view's filters back. Cross-tab mixing fixed at the source: the views list stays in localStorage, but which view is on (`vm-board-chat-active`, sessionStorage) and the org pill are per tab; a new tab starts on the last org picked (`vm-board-org-filter`) or the active view's org. Code review: no Critical; both Important findings (org still shared; column value order counted as an edit) fixed, plus old-format views kept and the views list written only when it changes. Tests: views 11/11, related suites 99/99, build passes. Live check (free, seeded view, two tabs): edited marker, restore, and tab independence all confirmed.

## Deferred

- **Sync Task Board** — Fireflies → board changes from the Task Board (today only Sync Meeting does this). Own session; reuse Board Chat's `itemWrites.js` write layer.
- Carried from v0.4.18: dev-server blank page (`createTheme_default is not a function`) needs root-causing; table column resizing off; AI Sync Meeting table preservation not exercised; two-person table editing untested; stale-bundle gate SHA / Skew Protection caveat.
- Board Chat, open (minor): views are not capped (x deletes; no observed harm); if another tab deletes this tab's active view, its filters stay applied and the pre-view filters are lost; the Apply modal shows org, assignees and due date for a create but not status, priority, category or tags.
- Noticed 2026-10-21, not fixed: manual status changes on the board (`TaskBoard.jsx` `handleUpdate`) don't set `completedAt` on Done; only Sync Meeting does.
