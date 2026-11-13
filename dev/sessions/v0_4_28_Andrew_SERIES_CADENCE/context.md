# Session v0.4.28 — Change schedule (series cadence) + GV weekly switch

**Date:** 2026-11-17
**Branch:** worktree `.claude/worktrees/series-cadence` on `worktree-series-cadence`, cut from `origin/dev` at `fbbed72`

## Task

Andy's directive: move the Golden Vision meeting to "GV - Weekly", Mondays 10am PT, with Carolina Numan replacing Leslie Polley, keeping the existing agenda and its history; build it into the FE so Andy can change cadence himself (back to biweekly in ~3-4 weeks).

## Change

- **Reschedule → "Change schedule"** (`src/components/RescheduleDialog.jsx`): title, Weekly / Every 2 weeks, first meeting date (its weekday becomes the series weekday), time. Renames the invite only if the title was edited. Writes the new date (and title) to the agenda doc.
- **API** `PUT /api/meetings/reschedule` mode `pattern` (`api/meetings/reschedule.js`): validates mode/date/time/frequency; Google first (emails attendees), then Outlook; 502 + retry-safe on an Outlook failure.
- `changeSeriesPattern` in `api/meetings/_lib/google-calendar.js` and `graph-events.js`: patches the series master in place (same ids, same Teams link); retry-safe.
- **Split series:** a Google split piece (`{id}_R{date}`) cannot be re-dated (Google 400 "Invalid start time"). The Google step now targets the original master, carrying the split piece's guests; Google then cancels the split piece itself.

## GV live change (2026-11-17)

- Original Google master `ea74a0v5at8tqo46ka8mtth368` changed to weekly Monday 10:00 PT from 2026-11-23, title "GV - Weekly"; Outlook series updated to match; split piece `_R20260826T193000` cancelled by Google.
- Guests: Leslie removed, Carolina added (Google + Outlook).
- Agenda doc `ea74a0v5at8tqo46ka8mtth368`: title "GV - Weekly"; attendees match the invite; `lastSentAttendees` set to the same list (no pending Send Invite); `firefliesTitles` += "GV - Weekly".
- Emails sent: one "Updated invitation" to the pre-swap list (incl. Leslie); Carolina's invite; Leslie's removal notice. Wed 11/18 meeting removed.

## Verification

- Unit: `api/meetings` 77/77 pass (pattern handler, Google + Graph `changeSeriesPattern`, split routing, `weekdayOf`).
- Live, through the local app against Google + Outlook, on no-attendee test series (all cancelled silently, app records deleted): biweekly Wed → weekly Mon (renamed) and back to every 2 weeks; ids and Teams link kept; Manage Guests + Send Invite add/remove (Andy's own address only).
- Not verified: the split-routing path through the dialog (verified by hand on GV, unit-tested in code); Carolina's receipt of her invite.
- `npm run build` passes. Frontend suite: 4 timeouts in `BoardChatChangesModal` / `ProposalReview` run alone; neither imports the changed code.

## Deferred

- **Past Meetings misses older recordings** — What: `PastMeetingsCard` loads only the 50 most recent Fireflies transcripts account-wide, so GV (last recording 2026-08-26) shows 0. Why deferred: pre-existing, outside this task. Trigger: Andy's go-ahead.
- **GV back to biweekly** — What: Change schedule → "GV - Biweekly", Every 2 weeks; add "GV - Biweekly" (hyphen) to the agenda's `firefliesTitles`. Trigger: ~3-4 weeks after 2026-11-23.

- **Carried from v0.4.27 (reschedule hardening)** — still open: confirm Graph returns `originalStart` on occurrences (list a series' instances with `$select=id,start,type,originalStart`); confirm Google `events.get` on a deleted series still returns `m365EventId`; `dev/bmd-cleanup.mjs` (one-off, already run) still passes `originalDate`. Closed today: Reschedule dialog opened in the browser (scope options render, nothing submitted on a real meeting except GV). Worktree `reschedule-hardening` removed 2026-11-17.

## Shipped

| Commit | Change |
|---|---|
| `ee216db` | Change schedule + split-series routing. Pushed to `origin/dev` 2026-11-17 after pre-push review (no Critical; Important items fixed). |
