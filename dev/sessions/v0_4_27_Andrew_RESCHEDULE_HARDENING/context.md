# Session: v0.4.27 — Reschedule hardening

- **Developer:** Andrew
- **Date:** 2026-11-12
- **Branch:** `worktree-reschedule-hardening` (cut from `main` = `origin/dev` @ b258efd)
- **Status:** complete — fbbed72 pushed to `origin/dev`, Vercel prod deploy Ready

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
- Graph occurrence PATCHed to 11:00–12:00 PT at 20:05Z (HTTP 200, attempt 80 of a
  scratchpad retry job, now deleted) — after the meeting had started. Not re-read
  afterwards: a follow-up read-only check got 502 again.

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

8. **Pre-push review fixes.** Outlook now finds the occurrence by its *series slot*
   (Google's `originalStartTime`, Graph's `originalStart`), which never changes when
   the occurrence moves, so a retry finds it whether or not either side already moved it.
   Live occurrences win over cancelled ones at the same start, and if two live ones share
   a start, the one originally scheduled there wins. An Outlook cancel that went through
   but reported failure no longer blocks the retry. Both dialogs fix the target
   occurrence when they open. Series cancel retry falls back to the FE's stored Graph id
   if Google no longer returns the deleted series.

## Deferred
- **Unverified against live APIs:** Graph `originalStart` on occurrences (the code
  falls back to `start` for unmoved `type: occurrence`); whether Google `events.get`
  on a deleted series still returns `m365EventId`. Graph was down during this session.
  Trigger: next time Graph is healthy, list Nov 12 instances with
  `$select=id,start,type,originalStart` and confirm the field + the 11:00 time.
- **Dialogs not clicked through in a browser** (Reschedule: instance + series-time-only;
  Cancel from Agenda page). Trigger: next session with agent-browser permission —
  open dialogs only, do not submit (submitting emails attendees).
- **Memory update pending Andy's OK:** meeting-architecture memory should record
  "Google first, Graph matched by series slot".
- `dev/bmd-cleanup.mjs` (one-off, already run) still passes `originalDate`.
- Full-suite run: 25 UI tests time out under load (pass in isolation) — see
  v0_4_21_Andrew_TEST_TIMEOUTS.

## Close (2026-11-12)
Complete. Commits 59ee7bd, 8710aa3, fbbed72 on `origin/dev`; 59 meetings tests pass.
Nov 12 meeting: Google moved and attendees emailed; Outlook caught up late (see above).
Worktree `reschedule-hardening` left in place pending Andy's OK to remove.
