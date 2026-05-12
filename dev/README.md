# dev/ — Vistamar Management

Engineering scaffolding. Everything here is committed.

## Structure

- `SESSION_INDEX.json` — active + completed session ledger
- `sessions/` — per-session folders with `context.md` (THE BRAIN)
- `feature_memory/` — per-feature cumulative history (created on `/push-ready`, not during dev)
- `DEFERRED.md` — items punted for later

## Session Lifecycle

1. Start: `/new-session` (or inferred from first developer message)
2. During work: keep `dev/sessions/{folder}/context.md` current. After every meaningful action, ask *"if I crashed right now, would the next Claude know what happened?"* If no, update first.
3. End: `/push-ready` writes HANDOFF, updates feature_memory, marks session complete

Pre-commit hook enforces `context.md` is staged. If you hit that gate, you already failed.
