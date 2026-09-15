# Session: v0.4.7 — Fireflies Notetaker Lobby Fix

**Developer:** Andrew
**Date opened:** 2026-09-14
**Date closed:** 2026-09-15
**Status:** complete
**Commit start:** `7d7b96d`
**Commit end:** `91a60d3` (pushed to `origin/dev`)
**Branch:** local `main` → `origin/dev` (project convention: no local feature branches)

> Session opened ad-hoc from a support question, not via `/new-session`. This
> file is the retroactive record.

---

## What this is

Andy had been manually dispatching the Fireflies notetaker to **every** meeting —
logging into fireflies.ai as `seo@`, clicking capture, then opening the meeting in
a browser as `seo@` while already in the call as `adeemer@`. The ask was to find
the root cause and end the manual work.

It was never a Fireflies configuration problem.

## Root cause

**Microsoft Graph mints every `/onlineMeetings` row with
`lobbyBypassSettings.scope = "organization"`.** The Fireflies notetaker joins
Teams **anonymously**, so it is not "in the organization" — it gets parked in the
lobby indefinitely, nobody admits it, and the meeting goes unrecorded.

Verified by reading `lobbyBypassSettings` over Graph on a real
`meetings@`-organized event. Fix is `scope: "everyone"`.

This had been mis-triaged three times (backlog #8, deferred since v0.3.0) as
"Fireflies-dashboard config, not code."

## Ruled out — do not re-chase

- **seo@'s auto-join was already correct** — "Record all calendar events with a
  meeting link", Google calendar connected. Confirmed from the Fireflies UI.
- **`adeemer@` has never had auto-join enabled**, so Andy's own account was not
  winning Fireflies' first-inviter race.
- **Adding `fred@fireflies.ai` is not the fix.** It was *already* a guest on the
  broken meeting and the bot still didn't join. `fred@` is the dispatch trigger,
  not the blocker. It was deliberately **removed** from the new series: `seo@`'s
  auto-join alone gives unambiguous workspace attribution, and a second trigger
  reintroduces the first-inviter ambiguity.
- **Meeting-organizer transfer is a dead end.** `Invoke-ChangeMeetingOrganizer`
  moves the *Exchange* meeting but explicitly does **not** move the Teams
  organizer — join link and lobby settings stay with the original owner.

## Fireflies behaviour worth knowing

Fireflies dedupes **across workspaces**: only one bot joins per meeting, "on
behalf of the first person who invited it," and that person's privacy/share
settings govern the transcript. So a client's or a teammate's personal Fireflies
can capture a Vistamar meeting into *their* workspace. There is no priority
setting. The structural fix is one shared Fireflies workspace for the team.

## Shipped

| Item | Commit | State |
|---|---|---|
| `setLobbyBypass()` in `api/meetings/_lib/graph-events.js` | `91a60d3` | pushed to `origin/dev` |
| `create.js` step 1b calls it after Graph mints the Teams binding | `91a60d3` | pushed |
| `api/meetings/_lib/__tests__/lobby-bypass.test.js` (4 tests) | `91a60d3` | 4/4 pass |

`setLobbyBypass` is **non-fatal by design**: at that point in `create.js` the
Graph event exists and step 2 is about to fan real invites, so throwing would
leave a live meeting with no Google mirror. The outcome is logged and returned as
`lobbyBypass` in the response so a failure is visible rather than swallowed.

Test suite: **148 passed / 1 failed (149)**. The one failure is
`PresentationModeToggle` — the parallel v0.4.7 presentation-mode session's file.
It passes 3/3 in isolation; it is a test-isolation flake under parallel run, not
a regression from this work. Not touched — belongs to the other session.

## Live data mutations made this session (outside git)

- **Created** `VM Weekly Touch Base` through the scheduler path (`meetings@`
  organizer, Mondays 11:00–12:00 PT, `FREQ=WEEKLY;BYDAY=MO`, first occurrence
  2026-09-21). Google event `71h9a6tk1d0niv3og5r2dlt3e0`, m365 binding stamped.
  **Real invites were sent** to the 5 VM attendees.
- **Removed** `fred@fireflies.ai` from that series. This **also emailed the team**
  — `google-calendar.js :: updateAttendees` hardcodes `sendUpdates: "all"` despite
  `attendees.js` claiming `"none"`.
- **Did not touch** Tate's two old hand-made series (`fin1psha42g36a1rba6l08iefd`
  and `..._R20260413T180000`). Andy is telling the team to delete the old event.
- Andy manually set lobby bypass → Everyone on the new Touch Base.

## Not done ❌

- **4 of 5 existing `meetings@` meetings are still lobby-held.** Audited
  2026-09-14: `ID Care - Biweekly` (9/15), `VM - Weekly Business Dev` (9/18),
  `GV – Biweekly` (9/23), `BMD - Biweekly` (9/24). Only the Touch Base is `everyone`.
  The code fix covers **new** meetings only — these need a one-time backfill.
- **Tenant-level Teams settings never verified** (needs Teams admin):
  *Manage external bots* → `Do not detect bots`, and *Anonymous users can join a
  meeting unverified* → `On`. Per-meeting lobby bypass will not help if either is
  wrong org-wide.
- **Nothing proven empirically.** No Monday call has yet recorded into `seo@`'s
  workspace. First real test is 2026-09-21 (or 9/15 ID Care if backfilled).
- **No agenda bound** to the new Touch Base event — `agenda_id` was left null, so
  the master Touch Base agenda is not attached.
- **Stale comments not corrected** in `create.js` and `attendees.js` re
  `sendUpdates` (see Deferred).
- No code review run before push (30-line change, Andy's call).

## Why closed

Root cause found, fixed, tested, pushed. Remaining work is either manual
click-through Andy has to do himself, or blocked on Teams admin access.

## Deferred

| What | Why deferred | Trigger to pick up |
|---|---|---|
| Backfill lobby bypass on the 4 existing `meetings@` meetings | The Graph PATCH is blocked by the sandbox security classifier; Andy can do it in Outlook → Options in ~2 min | Before the next occurrence of each — ID Care 9/15 is soonest |
| Verify tenant-level Teams bot/anonymous settings | Needs Teams Admin Center access | If the notetaker still fails after per-meeting bypass is correct |
| Consolidate the team onto one Fireflies workspace | Org/licensing decision, not code; Cedric/Tate had personal accounts and the `seo@` workspace shows no team members | If a transcript lands in someone else's workspace again |
| Fix stale `sendUpdates` comments in `create.js` + `attendees.js` | Out of scope for the fix; comments claim `"none"`, lib hardcodes `"all"` | Next time either file is touched |
| Bind the master agenda to the new Touch Base event | Not asked for; `agenda_id` left null | When the master agenda view needs the new series |
| Automate notetaker dispatch via Fireflies `addToLiveMeeting` | Superseded — lobby fix addresses the root cause; would need a Vercel Pro cron (Hobby caps at 1/day) and Fireflies rate-limits to 3 req/20 min | Only if lobby bypass proves insufficient |
| Confirm Vercel actually deployed `origin/dev` | Prior sessions recorded that Vercel was not auto-deploying from `dev` | Immediately — the fix is inert until deployed |
| `PresentationModeToggle` parallel-run test flake | Belongs to the parallel presentation-mode session | That session's next run |
| 90 GitHub dependabot vulnerabilities (1 critical, 30 high) | Unrelated to this work; surfaced by the push | Dedicated dependency pass |

## Session close summary

Diagnosed and fixed a problem that had survived three prior triages, by reading
the actual `lobbyBypassSettings` value over Graph instead of trusting the
Fireflies-side theory. Shipped `setLobbyBypass()` wired into the create path with
4 tests, recreated the Monday Touch Base under `meetings@` so it's inside the
app's architecture, and dropped the redundant `fred@` invite. Two memories
written: the lobby root cause (with ruled-out paths) and the stale `sendUpdates`
comment trap.

The fix is live in `origin/dev` but **unverified in production** and **only
applies to newly created meetings** — the 4-meeting backfill and the first real
Monday recording are the open loops.
