# Session: v0.4.27 — Reschedule hardening

- **Developer:** Andrew
- **Date:** 2026-11-12
- **Branch:** `worktree-reschedule-hardening` (cut from `main` = `origin/dev` @ b258efd)
- **Status:** in progress — code done + tested locally, not pushed

## Trigger
Rescheduling "Vistamar Platform Development updates" (Thu Nov 12, 2:00 PM → 11:00 AM,
this occurrence only) failed: `graph-events.findInstanceByDate failed: 502 UnknownError`.

## Root cause
Microsoft Graph was down for the meetings@ mailbox (every endpoint — plain event list,
GET by id, instances, calendarView — returned 502/503/504 after 20–30s, from
~18:15Z onward). The app ran Graph first and aborted on its failure, so a Graph outage
blocked the attendee-facing change even though Google is the copy that emails attendees.

## Live state of the Nov 12 meeting
- Google occurrence `m4b1tbph59cpv51hk1t4p2bh0g_20261112T220000Z` moved to 11:00–12:00 PT
  with `sendUpdates:"all"` (attendees emailed) at ~18:21Z.
- Graph occurrence still at 2:00 PM. A background job (scratchpad `graph_catchup.mjs`)
  retries the Graph PATCH every 60s for up to 2h.

## Fixes on this branch
1. Occurrences are found by exact start instant, not calendar date. The old window was
   a UTC day, so any meeting at 4pm PT or later (next UTC day) could not be found.
   `api/meetings/_lib/instance-time.js` (+ tests); FE sends `original_start`.
2. Google is patched first, then Graph. A Graph failure after Google succeeded returns
   502 `partial:true` with a plain message; the retry is safe (each side skips an
   occurrence an earlier attempt already moved).
3. Graph lookup selects only `id,start,type,isCancelled` (full instance payload is the
   heavy part of the request).
4. Reschedule invalidates `["agenda-next-occ"]` so the Agenda page's dialog does not
   re-anchor on the old time (same class of bug as v0.4.4).
5. Dialog caption no longer says Outlook sends the invites (Google does).

6. **"Entire series" changes the time only** (Andy, 2026-11-12). The series keeps its
   first date, so its weekday and past occurrences stay; the dialog hides the date
   picker. One-time events still move to the new date. Previously the master start was
   patched to the picked date: a different weekday left BYDAY / `daysOfWeek` on the old
   day, and a later date dropped earlier occurrences in Google.
7. **Cancel** uses the same pattern: exact start instant, Google first, retry-safe,
   502 `partial:true` on a Graph failure. The Agenda page's cancel now targets the next
   live occurrence, not the agenda's stored (frozen, often past) meetingDatetime.

## Deferred
- `dev/bmd-cleanup.mjs` (one-off, already run) still passes `originalDate`.
- Full-suite run: 25 UI tests time out under load (pass in isolation) — see
  v0_4_21_Andrew_TEST_TIMEOUTS.
