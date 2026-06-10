# /to-do log

Durable memory for the `/to-do` skill. The skill reads this at the start of every run and updates it at the end. It is **not** a source of truth for deferred items — `dev/sessions/*/context.md` owns those. This file only tracks the skill's own output: ideas it has proposed, run-over-run movement, and the developer's priority calls.

Do not hand-delete ledger rows — change their status instead.

## Suggestion ledger

| ID | Suggestion | Status | First proposed | Notes |
|----|------------|--------|----------------|-------|
| _(empty — first run will populate)_ | | | | |

## Run history

| Date | Open count | Shipped since last run | Note |
|------|-----------|------------------------|------|
| _(empty — first run will populate)_ | | | |

## Priority calls

_(none yet — recorded when the developer says "do X next" or "Y is blocked on Z")_
