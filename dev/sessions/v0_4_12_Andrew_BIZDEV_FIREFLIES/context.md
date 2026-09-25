# Session v0.4.12 — Business Dev Fireflies capture + mapping

**Date:** 2026-09-25 · **Developer:** Andrew · **Status:** complete

## What happened

Reported: Fireflies never auto-joins the Friday "VM - Weekly Business Dev", and its
recordings don't show on the agenda. No code changes — live data/calendar fixes only.

**Root cause — no auto-join (two faults, both verified via Graph + Google):**
1. `seo@` was not an attendee on the Graph series or the Google mirror, so seo@'s
   Fireflies auto-join (reads seo@'s Google calendar) never saw the meeting.
2. The series' Teams onlineMeeting (code `255883683641511`, created 2026-05-14 —
   before the 2026-09-14 `setLobbyBypass` fix) had `lobbyBypassSettings.scope =
   "organization"`, parking the anonymous notetaker in the lobby.

**Root cause — recordings unmapped:** agenda↔recording matching is exact title
(case-insensitive only). Manual seo@ captures got dash-variant titles
(`VM – Weekly Business Dev` en dash, `VM - Weekly Business Dev` hyphen) while the
agenda only listed `VM - Business Dev`.

## Live changes (all verified by re-reading)

| Where | Change |
|---|---|
| Graph onlineMeeting (Business Dev series) | lobby → `{"scope":"everyone","isDialInBypassEnabled":true}` |
| Graph master `AAMkAGRjMThk…AAaxVf2AAA=` | + `seo@` attendee (sent update .ics to all attendees) |
| Google master `0k0ph9i2hsjbbmhu1kq7o9evn0` (meetings@) | + `seo@` attendee; 10/2 occurrence now on seo@'s own Google calendar with Teams link |
| Firestore `agendas/0k0ph9i2hsjbbmhu1kq7o9evn0` | `firefliesTitles` += `VM - Weekly Business Dev`, `VM – Weekly Business Dev` |

Done via one-off node scripts calling `api/meetings/_lib` (`setLobbyBypass`,
`updateAttendees`) with `.env.vercel`, and Firestore REST with a gcloud token.
`PUT /api/meetings/attendees` could not be used: the Google master has no
`m365EventId` extended prop, so the endpoint returns 409.

Not mapped on purpose: 2026-06-29 `VM — Weekly Business Dev` (em dash) — different
Teams link, client-ops content; treated as a different meeting.

## Deferred

| What | Why deferred | Trigger |
|---|---|---|
| Confirm Fireflies auto-joins Business Dev | Only provable at the next occurrence | Fri 2026-10-02 11:30 PT — check Fireflies for a recording owned by seo@ with a full participant list |
| `fred@fireflies.ai` still on the Business Dev invite (first-inviter ambiguity) | Not asked to change | If the 10/2 recording lands in the wrong workspace |
| Teams tenant settings ("Manage external bots", "Anonymous users can join unverified") | Needs a Teams admin | If 10/2 still isn't auto-recorded |
| Dash-insensitive title matching in `PastMeetingsCard` / `FirefliesMeetings` | Code change, not requested | Next unmapped-recording report |
| Past Meetings card only loads the latest 50 Fireflies recordings — May/June Business Dev recordings are mapped but won't show | Code change, not requested | When older recordings are needed on an agenda |
| Other pre-2026-09-14 series (BMD, ID Care, GV, Biweekly Marketing, Platform Dev) likely also have lobby = organization and may lack seo@ | Out of scope | Any other meeting that Fireflies doesn't auto-join |
| Google master lacks `m365EventId` → attendees endpoint 409s for Business Dev in the app | Out of scope | Next time someone edits Business Dev guests in the app |
