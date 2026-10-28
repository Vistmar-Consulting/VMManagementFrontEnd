# Session v0.4.20 — Sync Meeting: tracked changes + editable proposal

**Date:** 2026-10-27 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/sync-meeting-tracked-edits` on `worktree-sync-meeting-tracked-edits`, cut from `main` at `3773d77`

## Ask

In the Sync Meeting review: (A) full text editing of the proposed agenda; (B) a tracked-changes redline from the pre-sync agenda to the proposed agenda. Comments (Claude asking "is this done?") come later, as a separate API call. Keep the first version small.

## State

- Design approved 2026-10-27 → `docs/superpowers/specs/2026-10-27-sync-meeting-tracked-edits-design.md`. Changes | Edit tabs; jsdiff word diff per topic; no API change.
- Next: spec review, then implementation plan.

## Deferred

- Claude comments on the proposed agenda (separate API call, not in `/api/ai/prepare`).
- Per-change accept/reject.
