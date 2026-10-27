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

- Spec approved 2026-10-21 (name Board Chat; audit = createdVia on creates only). Next: implementation plan.

## Deferred

- **Sync Task Board** — Fireflies → board changes from the Task Board (today only Sync Meeting does this). Own session; reuse Board Chat's `itemWrites.js` write layer.
- Carried from v0.4.18: dev-server blank page (`createTheme_default is not a function`) needs root-causing; table column resizing off; AI Sync Meeting table preservation not exercised; two-person table editing untested; stale-bundle gate SHA / Skew Protection caveat.
- Noticed 2026-10-21, not fixed: manual status changes on the board (`TaskBoard.jsx` `handleUpdate`) don't set `completedAt` on Done; only Sync Meeting does.
