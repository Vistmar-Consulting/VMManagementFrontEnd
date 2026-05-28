# HANDOFF — 2026-05-27 — Background Cleanup Session

Autonomous `--dangerously-skip-permissions` session spawned to land 5 code-review follow-ups while Andy starts V2 Meeting Scheduler work in parallel. Scope is fixed by the session's launch prompt — see "Scope" below.

> **Background agent: replace each `_TODO_` placeholder as you go. Don't restructure the headings.**

## Session metadata

- Started: _TODO_ (ISO timestamp)
- Ended: _TODO_
- Agent: _TODO_ (model id)
- Branch / push target: local `main` → `origin/dev`
- Starting commit: `56f39a8` (docs(deferred): file remaining code-review follow-ups)

## Scope (per launch prompt)

Five items from `dev/DEFERRED.md` "Code review follow-ups" section:

1. **#7** — useCollection dev-warn on unmemoized constraints
2. **#11** — AuthContext Retry button on profile-load error path (ProtectedRoute.jsx)
3. **#12** — SignIn safety timeout cleanup on unmount
4. **#18** — Extract `tsToDate` to `src/utils/firestoreTime.js` + update 4 call sites
5. **#19** — Move `STATUSES` to `src/constants/itemStatuses.js` + update 2 import sites

**Explicitly out of scope:** #8 TaskBoard.jsx extraction, #9 collectionGroup denorm, #17 Mui prefix decision, #20-#22, #23, #24, #25, #27, the vitest counter test. See launch prompt for the full DO-NOT-TOUCH list.

## Results

### Landed

| # | Item | Commit SHA | Notes |
|---|------|-----------|-------|
| 7 | useCollection dev-warn | _TODO_ | _TODO_ |
| 11 | AuthContext Retry button | _TODO_ | _TODO_ |
| 12 | SignIn timeout cleanup | _TODO_ | _TODO_ |
| 18 | tsToDate extraction | _TODO_ | _TODO_ |
| 19 | STATUSES extraction | _TODO_ | _TODO_ |

### Skipped or blocked

_TODO_ — list any of the 5 you couldn't land cleanly, what broke, what root cause you found (or didn't), what you tried. Empty section means all 5 landed.

### Noticed-but-untouched (scope-discipline overflow)

_TODO_ — things you saw while in the code that look worth fixing but were OUT of scope. List them here; do NOT fix them. Andy decides.

## Build state at session end

- `npm run build`: _TODO_ (pass / fail, paste final output line)
- Working tree: _TODO_ (clean / dirty)
- Last commit on `origin/dev`: _TODO_ (SHA + first line of message)
- Vercel deploy status: _TODO_ (if you checked — optional)

## Anything Andy should know before opening the next session

_TODO_ — short note on anything unexpected, anything that needed a judgment call, anything the next session should read before continuing. Empty is fine if everything was mechanical.
