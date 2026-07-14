# Session: v0.4.5 — BMD Blank Agenda Strand Fix + Full Agenda Audit

- **Developer:** Andrew
- **Date:** 2026-07-13 → 2026-07-14
- **Branch:** `studio-integration-proxy`
- **Phase reached:** Complete — repair applied to prod Firestore + Andy confirmed live
- **Status at close:** complete

## What this is
Bug report: "BMD - Biweekly agenda is blank and has no history" — a meeting the
team had used for months suddenly showed an empty editor + no Fireflies history.
Root-caused to a recurrence-split stranding bug, repaired by copy-forward, then
swept every agenda for the same class of failure. This is the materialization of
v0.4.4's deferred "Firestore agenda-linkage audit" item.

## Root cause (confirmed with evidence)
The **Google Calendar mirror** of "BMD - Biweekly" split into a new recurrence
master (`6295h9p4mu514u7fkqm0tgmr68_R20260702T183000`) at the **Jul 2** boundary
(from a "this-and-following" edit). **Graph/Outlook stayed one intact series**
(same `seriesMasterId …U3mG6AAA=` for every occurrence May 7 → Aug 27).

Agendas are keyed by the **Google recurrence-master id**, so `reconcileMeetings`
saw the new master, found no agenda, and **minted a fresh EMPTY agenda doc**
(created Jul 6). The app routes upcoming occurrences (`/agendas/{series_id}`) to
that empty doc → blank editor + no history. The team's real content sat stranded
on the previous master's doc (`…_R20260521T183000`): 4 topics + Fireflies history.

- The "BMD ad hoc Content Strategy" meeting Andy made the night before is a
  **separate series** (`5pk0be…`) and was **NOT** the cause — the split predated it.
- Storage contract that made the fix clean: Firestore `topic.bodyHtml` /
  `agenda.openFloorHtml` are canonical; the Liveblocks room (`agenda:<docId>`,
  `src/lib/agendaRoom.js`) is transport and **self-seeds from bodyHtml on first
  open** (awareness-election, `CollabBodyEditor.jsx`). So a Firestore copy-forward
  fully restores the visible content — no Liveblocks surgery needed.

## What shipped (prod Firestore, Andy-confirmed live)
1. **BMD repair applied** via `dev/repair-bmd-biweekly-content.mjs --apply`
   (dry-run-first, guarded, gcloud user token → Firestore REST). Copied from
   `…_R20260521T183000` → `…_R20260702T183000`, verbatim, same doc ids:
   - 4 topics (Content, Website, PPC + Matchback, Cosmetic Treatment Matcher Tool)
     with all `bodyHtml` (639 / 173 / 201 / 808 chars)
   - `firefliesTitles` `["BMD - Biweekly","BMD Marketing"]` (Past Meetings history)
   - 5 `versions` snapshots (version-history clock icon)
   - Source doc left intact as archive; DEST meeting-binding fields untouched.
   - Verified: DEST bodyHtml lengths match source byte-for-byte; **Andy confirmed
     it renders live.**
2. **Full strand audit** — `dev/audit-agenda-strands.mjs` checks BOTH vectors:
   (A) recurrence-split (group by base Google id, cross-ref live Google calendar
   for the upcoming-owning master), and (B) dual-id-scheme (NewMeetingDialog
   random-id content doc + empty `agendas/{seriesId}` shadow). **Result: BMD was
   the only strand with recoverable content. No other agenda needs repair.**

## New dev scripts (untracked, LOCAL — not committed yet)
- `dev/diag-bmd-firestore.mjs` — read-only Firestore dump of BMD agendas + series
- `dev/diag-bmd-source-content.mjs` — read-only full content shape of a source doc
- `dev/repair-bmd-biweekly-content.mjs` — the copy-forward repair (dry-run default)
- `dev/audit-agenda-strands.mjs` — read-only both-vector strand sweep (reusable)

## Memory added
- `project_agenda_recurrence_split_bug` — the class, the repair pattern, the
  deferred durable fix. Linked from `reference_meeting_diagnostics_toolkit`.

## Deferred
- **DURABLE ARCHITECTURAL FIX (the real prevention).** Agendas are still keyed by
  the volatile Google recurrence-master id, so BMD — and any recurring client
  meeting — **will re-strand on the next "this-and-following" reschedule.** Fix:
  key agendas by a **stable** identity (Graph `seriesMasterId`/`m365EventId`, which
  stayed constant here, or `iCalUID`), OR have `reconcileMeetings` detect a split
  and carry the prior master's content forward. Needs its own brainstorm→spec→plan.
  *Trigger:* next agenda goes blank, or a dedicated meetings-hardening pass.
  Detection is now one command: `node --env-file=.env.vercel dev/audit-agenda-strands.mjs`.
- **GV-Vistamar Bi-Weekly Mtg — empty live agenda, but NO content stored anywhere.**
  Live master `…_R20260520T193000` (next occ Jul 15 12:30) is empty AND its sibling
  is empty AND Vector-B found no content doc — nothing was stranded, nothing to
  recover. Either the team doesn't keep an agenda for GV, or it was never filled.
  *Trigger:* if the team reports GV agenda content missing → check the prior
  GV-fork cleanup (`dev/diag-gv-fork.mjs`, `dev/cancel-gv-stale.mjs`).
- **Commit the 4 new dev scripts** (currently untracked). *Trigger:* next commit /
  when committing the branch.

### Carried forward from v0.4.4 (still open)
- **Dependabot: 37 vulns (13 high).** *Trigger:* security pass / before next dep bump.
- **Reschedule UX pre-flight** for `ErrorOccurrenceCrossingBoundary`. *Trigger:*
  next meetings-polish pass or next time someone hits it.
- **`audit-recurring-meetings.mjs` only sweeps `meetings@`** — extend to Tate's +
  Cedric's Google calendars. *Trigger:* next ghost hunt. (Note: the new
  `audit-agenda-strands.mjs` DOES already sweep all three calendars.)

## Session close summary
BMD blank-agenda incident resolved end-to-end: root-caused (Google recurrence
split → stranded agenda), repaired by copy-forward to the live master doc,
verified server-side + confirmed live by Andy. Swept all 32 agendas across both
strand vectors — BMD was the only recoverable strand; no further repairs needed.
The durable code-level prevention is deferred (keyed-by-stable-id or carry-forward
on split). No app code changed this session; the fix was a production data repair.
