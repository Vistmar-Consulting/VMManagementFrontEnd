# dev/ — Vistamar Management

Engineering scaffolding. Everything here is committed.

## Structure

- `SESSION_INDEX.json` — active + completed session ledger
- `sessions/` — per-session folders with `context.md` (THE BRAIN — single source of truth, includes a Deferred section)
- `feature_memory/` — per-feature cumulative history (created on `/push-ready`, not during dev)

## Session Lifecycle

1. Start: `/new-session` (or inferred from first developer message). Read the previous session's `context.md` and carry forward live items from its "Deferred" section into the new session's `context.md`.
2. During work: keep `dev/sessions/{folder}/context.md` current. After every meaningful action, ask *"if I crashed right now, would the next Claude know what happened?"* If no, update first.
3. End: append a "Session close" section to `context.md` summarizing what shipped + entry points for the next session. Mark `status: closed` in `SESSION_INDEX.json`.

Pre-commit hook enforces `context.md` is staged. If you hit that gate, you already failed.

**Retired 2026-05-29:** `dev/HANDOFF_*.md` files and `dev/DEFERRED.md` / `dev/DEFERRED_PLAYBOOK.md`. Their content lived redundantly with `context.md`. The Session close summary at the end of each session's `context.md` replaces HANDOFF; the Deferred section inside `context.md` replaces DEFERRED.
