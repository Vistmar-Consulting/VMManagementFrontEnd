# Deferred Items — Vistamar Management

Items deferred during scaffolding (2026-05-12) and during V1 development. Add new entries as discovered.

## V1 Bootstrap (mostly done)

- ~~`npm install`~~ ✓ done 2026-05-12
- ~~Firebase project creation~~ ✓ done 2026-05-13 — `management-db9eb` in `us-west1` on Spark
- ~~Vercel project~~ ✓ done 2026-05-14 — `adeemervms-projects/vm-management-front-end`, GitHub auto-deploy on push to `dev` branch
- ~~GitHub repo~~ ✓ done 2026-05-14 — `Vistmar-Consulting/VMManagementFrontEnd` (public, required for Hobby plan Vercel connect)
- ~~Firebase Auth authorized domains~~ ✓ done 2026-05-14 — Andy added `vm-management-front-end.vercel.app`
- ~~Sign-in flow~~ ✓ rebuilt 2026-05-27 — replaced signInWithPopup → signInWithRedirect → Google Identity Services (ID-token + signInWithCredential). Most robust pattern; works first-try on fresh browsers. Required GCP console step: Authorized JavaScript origins on OAuth client `206947368406-...` (localhost:5173 + vm-management-front-end.vercel.app + management-db9eb.firebaseapp.com).
- ~~Firestore config + rules~~ ✓ done 2026-05-14 + updated 2026-05-27 (added collection-group rules for comments + files)
- ~~AuthContext + useDoc/useCollection~~ ✓ done 2026-05-14
- ~~Manual seeds (Andy admin, vistamar org)~~ ✓ done 2026-05-14
- ~~MUI theme port from VMConsoleFrontEnd~~ ✓ done 2026-05-14
- ~~portSeed — wipes generic items, plants archive data (4 client orgs + 8 categories + 5 tags + 44 mock items)~~ ✓ done 2026-05-27
- ~~Project Board table port (Monday-style, 14 cols, collapsible groups, scorecards, org chips, search)~~ ✓ done 2026-05-27
- ~~CRUD: delete confirm dialog, add item, add subtask, category/tag CRUD~~ ✓ done 2026-05-27
- ~~Notes modal (comments) + Files modal (URL link attachments)~~ ✓ done 2026-05-27
- ~~Expand-all toggle + filter cascade to subitems~~ ✓ done 2026-05-27
- ~~Sidebar restructure (Members removed, Organizations + Profile nested under Settings)~~ ✓ done 2026-05-27
- ~~"Due This Wk" scorecard scoped to current business week Mon–Fri~~ ✓ done 2026-05-27
- ~~Sequential I-N / SI-N item numbers via per-org counters~~ ✓ done 2026-05-27
- ~~Member avatars unified (FL initials, dark text)~~ ✓ done 2026-05-27
- ~~AI Gen status (id 8) added at top of status dropdown~~ ✓ done 2026-05-27

### Still pending in V1

- **Firebase Storage initialization** — Blaze-only since late 2025. `storage.rules` authored. When Blaze enables: `npx firebase deploy --only storage`. The Files modal currently only does URL links; will get a "📎 Attach file" button alongside the URL form once Storage is live.
- **Cloud-Function auth-onCreate trigger** (spec §5) — Blaze-required. V1 uses client-side bootstrap in AuthContext as documented exception.
- **DnD reorder** via `react-beautiful-dnd` + `fractional-indexing` `generateKeyBetween` — library is installed but no row-drag wiring yet.
- **Migration script** (`functions/scripts/migrate-from-sql.js`) — V1 ships mock data. If/when Andy wants live `pm.Items` pulled in, write the script then.
- **Members admin page** — `src/pages/Members.jsx` is a stub; route removed from sidebar. Build when needed (promote-to-admin button + per-user avatar color picker live here).
- **Settings page itself** — Settings is now a sidebar parent group only; no /settings page content. Add if/when global preferences land.
- **Date-picker keyboard navigation** — DatePicker opens on click, closes on outside-click or date select. Tab/Enter/Escape behavior not tested.

## V2 Backlog — Meeting Scheduler (NEXT SESSION'S WORK)

The next session is Andy starting Meeting Scheduler work. See `dev/HANDOFF_2026-05-27_MEETING_SCHEDULER_KICKOFF.md` for the full briefing.

Headline:
- Port `api/meetings/*` from `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/` to `functions/src/meetings/*` (requires Blaze upgrade)
- M365-primary architecture (Graph canonical, Google mirror) per `[[project-v2-meeting-scheduler-direction]]` memory
- Vistamar team gets **Google calendar ICS-mirrored events**; external attendees get the Graph .ics natively from Outlook/Teams
- Service account: `meetings@vistamarconsulting.com` (already provisioned in `Console-Meetings` GCP project)
- **Store the Graph Event ID** on the Calendar Series doc so agendas can marry up to the Graph event for updates/cancellations

V2 also requires:
- Blaze upgrade on Firebase (auth-onCreate trigger, Cloud Functions for meeting endpoints, Storage for any meeting attachments)
- Calendar UI lib decision (FullCalendar was dropped — Andy decides)
- Postmark + Graph sendMail replaced by Gmail send via `meetings@` service account

## V3 / Far-Future

- **AI-driven Project Board updates** — Andy 2026-05-27 direction: use Fireflies meeting transcripts + Meeting Agendas to auto-suggest items/decisions. AI-suggested items land with `statusId: 8` (AI Gen), human confirms into Assigned. See `[[project-v3-ai-feature-intent]]` memory when written.
- **Task File uploads** (Firebase Storage) — Blaze-gated. V1 ships URL-link-only Files dialog.
