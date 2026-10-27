# Session v0.4.19 — Board Sync

**Date:** 2026-10-26 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/board-sync` on `worktree-board-sync`, cut from `main` at `c923daf`

## Ask

A Sync feature on the Task Board that updates every client's and Vistamar's tasks in one run, using the same sources as Sync Meeting, without touching any agenda. Used before and after the Monday Touch Base. Only adeemer@vistamarconsulting.com may use it.

## Decisions

- "New" is defined by a per-org transcript ledger (`syncedTranscripts`), stamped by both Sync Meeting and Board Sync; 30-day lookback; backfill from each org's last Sync Meeting.
- One model call per org in parallel; one review grouped by org; one atomic apply.
- Orgs with nothing new are skipped by default (checkbox to include).
- Touch Base (master-mapped) transcripts feed every org; other Vistamar meetings are context only for clients.
- Shared extra-context box. Access gate: Andy's email, client and server.

## Docs

- Spec: `docs/superpowers/specs/2026-10-26-board-sync-design.md`
- Plan: `docs/plans/2026-10-26-board-sync.md`

## State

- Spec written, reviewed, committed. Plan written; plan review pending.

## Deferred

- None yet.
