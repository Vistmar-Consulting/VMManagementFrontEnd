# Session: v0.4.8 — Open Permissions to All Vistamar Users

**Developer:** Andrew
**Date opened:** 2026-09-16
**Date closed:** 2026-09-16
**Status:** complete
**Commit start:** `c083160`
**Commit end:** `af60b5e` (pushed to `origin/dev` = Vercel production)
**Branch:** worktree `fix/task-edit-permissions` → fast-forwarded into local `main` → `origin/dev`

---

## What this is

Only `adeemer@` could edit Project Board tasks. Andy's decision: every active
`@vistamarconsulting.com` user can do everything, except two admin-only carve-outs.

## Root cause

`src/pages/TaskBoard.jsx` passed `canUpdate={isAdmin}` to every row and disabled
**New item** on `!isAdmin`. Console had `const canUpdate = true`; the gate was
introduced in the port (`ed663b5`). Firestore rules already allowed any active
user to write `items`, and Andy's account is the only `role: 'admin'`.

## Permission model (live)

| Capability | Who |
|---|---|
| Everything else — tasks, New item, orgs, categories, tags, AI prompts, Client SOPs, admin pages, agenda/series delete, editing other users' profile fields | Any active `@vistamarconsulting.com` user |
| Sync Meeting button (+ "synced X ago" caption) on Agenda Detail | `role == 'admin'` only |
| Change `role` / `active` on `users/{uid}` (deactivation), delete users | `role == 'admin'` only |

- `firestore.rules`: `isAdmin()` now = `isActiveUser()`; new `isRoleAdmin()` = real role check, used only on `users/{uid}` update (role/active) + delete. Self-only restriction on user profile update removed. Create still pins `role: 'member'`, `active: true`.
- `AuthContext.jsx`: `isAdmin` = `profile.active`; new `isRoleAdmin` = role admin + active. `AgendaDetail.jsx` Sync Meeting, `AppTopBar.jsx` + `Profile.jsx` admin badge use `isRoleAdmin`.

## Shipped

| Commit | What |
|---|---|
| `5f855dd` | Remove TaskBoard admin gates; `isAdmin` → any active user (rules + FE) |
| `e8a5a47` | CLAUDE.md: work in per-session worktrees (replaces "no local branches"); `.gitignore` `.claude/worktrees/` |
| `e0ec5af` | Sync Meeting + deactivation back to real admin role |
| `af60b5e` | Admin badge shows only for real admin role |

- **Vercel:** production deploy `vm-management-front-m528m6dpe` Ready. Confirmed Vercel production tracks `dev` (alias `vm-management-front-end-git-dev-…`) — closes the prior session's "confirm Vercel deployed origin/dev" item.
- **Firestore rules:** deployed to `management-db9eb` via `npx firebase-tools` as `adeemer@vistamarconsulting.com` (CLI default account was `deemerwsp@gmail.com` → 403).
- **Verified:** build passes; unit tests 126/126 (orgMembers file errored on missing `.env.local` in the worktree; `PresentationModeToggle` known flake). Andy confirmed `seo@` can edit tasks in production.

## Deferred

| What | Why deferred | Trigger to pick up |
|---|---|---|
| Sync Meeting gate is FE-only — `/api/ai/prepare` + `/api/ai/refine` only check email domain | Serverless handlers have no Firestore admin SDK to read `role` | If a non-admin should be hard-blocked from the Anthropic spend |
| Rules not exercised end-to-end by a non-admin for categories/tags/orgs/AI prompts | Only task editing was tested by Andy | First report of a permission error |
| `firestore.rules` header comment (lines 5-15) doesn't describe the open model | Cosmetic; comment above `isAdmin()` covers it | Next rules edit |
| Backfill lobby bypass on the 4 existing `meetings@` meetings | Carried from v0.4.7 | Before each meeting's next occurrence |
| Verify tenant-level Teams bot/anonymous settings | Carried from v0.4.7; needs Teams Admin Center | If notetaker still fails after per-meeting bypass |
| Consolidate the team onto one Fireflies workspace | Carried from v0.4.7; org/licensing decision | If a transcript lands in the wrong workspace |
| Fix stale `sendUpdates` comments in `create.js` + `attendees.js` | Carried from v0.4.7 | Next time either file is touched |
| Bind the master agenda to the new Touch Base event | Carried from v0.4.7 | When the master agenda view needs it |
| `PresentationModeToggle` parallel-run test flake | Carried from v0.4.7 | That session's next run |
| 90 GitHub dependabot vulnerabilities (1 critical, 30 high) | Carried from v0.4.7 | Dedicated dependency pass |

## Session close summary

Traced the "only adeemer@ can edit" bug to a port-time `isAdmin` gate on the
Project Board, then opened the whole app to every active Vistamar user per Andy,
keeping Sync Meeting and user deactivation/role changes admin-only. Shipped to
Vercel production and deployed Firestore rules; Andy verified with `seo@`. Also
switched the repo workflow to per-session worktrees (CLAUDE.md + memory).
