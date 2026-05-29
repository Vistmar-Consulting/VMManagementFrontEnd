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
- **DnD reorder** via `@hello-pangea/dnd` + `fractional-indexing` `generateKeyBetween` — library is installed (swapped from archived `react-beautiful-dnd` per 2026-05-27 code review) but no row-drag wiring yet.
- **Migration script** (`functions/scripts/migrate-from-sql.js`) — V1 ships mock data. If/when Andy wants live `pm.Items` pulled in, write the script then.
- **Members admin page** — `src/pages/Members.jsx` is a stub; route removed from sidebar. Build when needed (promote-to-admin button + per-user avatar color picker live here).
- **Settings page itself** — Settings is now a sidebar parent group only; no /settings page content. Add if/when global preferences land.
- **Date-picker keyboard navigation** — DatePicker opens on click, closes on outside-click or date select. Tab/Enter/Escape behavior not tested.

### Code review follow-ups (from 2026-05-27 superpowers:code-reviewer pass)

The Critical 3 + cheap Important 3 already landed in commit `7e3c2fc`. These remain. Originals graded by the reviewer; severity preserved here. **All should land BEFORE V2 grafts on top — V2 will build over these surfaces.**

- **#8 Important: TaskBoard.jsx component extraction** — file is ~1000 lines. Extract in this order:
  1. `useTaskBoardFilters(allItems, subitemsByParent)` custom hook — owns titleSearch, scorecardFilter, columnFilters, orgFilter, and returns `{topLevel, visibleSubitemsByParent, hasAnyFilter, filterForceExpandedIds, handleFilterChange, ...setters}`. Lines ~174-265, 309-317, 343-350.
  2. `<TaskBoardCategoryDialogs />` + `<TaskBoardTagDialogs />` — bundles add/edit + delete-confirm. Removes ~150 lines of JSX.
  3. `<TaskBoardScorecards />` + `<TaskBoardOrgFilterChips />` — pure presentational.
  4. `useItemMutations()` hook — owns the `runTransaction` add-item / add-subitem / handleUpdate / cascading delete logic. Centralizes write paths so V2 (agenda → item creation) doesn't sprinkle more `runTransaction` calls.
  Why now: V2 wants to surface items inside agendas — if `useItemMutations()` exists, the agenda view calls it directly instead of duplicating create logic.

- **#11 Important: AuthContext bootstrap recovery path** — `src/contexts/AuthContext.jsx:84-121`. If first-sign-in `setDoc` is rejected by rules, user is stuck on "Failed to load profile" with only a "Sign out" button. Add a "Retry" button on the error path in `ProtectedRoute.jsx`.

- **#12 Important: SignIn safety timeout never cleared on unmount** — `src/pages/SignIn.jsx:93-103`. The 10s polling-safety `setTimeout` handle is never captured. If user navigates away mid-flight, the timeout still fires (harmless but leaks a closure). Capture handle, `clearTimeout` in cleanup.

- **#7 Important: useCollection dev-warn on unmemoized constraints** — `src/hooks/useCollection.js:13-15`. Hook's caller contract is "memoize the constraints array" but nothing enforces it; a future caller passing `[orderBy("foo")]` inline creates infinite resubscription. Add a dev-mode warn: if previous-vs-current constraints diff by JSON, `console.warn` (guarded by `import.meta.env.DEV`).

- **#15 Minor: categoryId sort** — done ✓ (bundled into the Critical 6 fix in commit `7e3c2fc`).

- **Recommendation: vitest test for counter `runTransaction`** — `firebase-tools` emulator + 100 concurrent `handleAddItem` calls + assert all `itemNumber`s are unique. ~30 lines. The one test worth writing for V1 because it guards data integrity, not UI behavior.

- **#17 Minor: `Mui-` prefix convention is half-followed** — CLAUDE.md mandates `import Chip as MuiChip`-style; only `TaskBoardRow.jsx` + `TaskBoardColumnHeader.jsx` do it. Either retire the rule from CLAUDE.md or apply it everywhere. Decide.

- **#18 Minor: `tsToDate` duplicated in 4 files** (TaskBoard, TaskBoardRow, TaskBoardModal, TaskBoardFilesModal). Extract to `src/utils/firestoreTime.js`.

- **#19 Minor: `STATUS_OPTIONS` / `STATUSES` duplicated** between TaskBoard.jsx and TaskBoardRow.jsx. Move to `src/constants/itemStatuses.js` (file already exists from seed).

- **#20–22 Minor**: `useCallback`-wrap `getCommentCount`/`getFileCount`; consider `React.memo(TaskBoardRow)` once item count grows; expand the `eslint-disable react-hooks/exhaustive-deps` comment in TaskBoardRow.jsx:104 to explain *what* would break.

- **#23 Minor: `isDueThisWeek` timezone-implicit** — uses local `Date()`. Document the US-West assumption or convert to a fixed timezone via date-fns-tz when team goes remote.

- **#24 Minor: `useItems` returns ALL items** — fine at 85 items, needs server-side filtering past ~500. Tracking note only.

- **#25 Minor: `KanbanBoard.jsx` dead route** — still wired at `/board/kanban`. If kept for later, fine; if dead, delete the file + route entry.

- **#27 Minor: `Members.jsx` / `Settings.jsx` stubs** — V1 sidebar doesn't link to them but routes remain. Either keep stubs as scaffolding or remove route + file to reduce dead surface.

### Code review's strong recommendation

Write `dev/v2-graft-points.md` BEFORE V2 starts. Map every place V2 will touch V1 code: `useItemMutations()` (once extracted), `runTransaction`-on-org-doc patterns to reuse for series-counters, comments/files denormalization Cloud Function triggers. This forces #8 extraction now (so V2 plugs in) instead of after V2 has duplicated logic.

## V2 Backlog — Meeting Scheduler (NEXT SESSION'S WORK)

V2 kickoff session opened 2026-05-27 evening. See `dev/HANDOFF_2026-05-27_MEETING_SCHEDULER_KICKOFF.md` (original kickoff) and `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/context.md` (live brain). Implementation brief: `docs/plans/2026-05-27-meeting-scheduler-port.md` (architecture surface needs update — see below).

**Architecture (CORRECTED 2026-05-27 per Andy; invite-fanout flipped 2026-05-29):**
- Backend: **Vercel API routes** in `api/meetings/*` (NOT Firebase Functions — Andy explicitly questioned the Blaze requirement and ruled it out)
- Secrets: **Reuse Console's Azure VistamarVault** via service-principal env vars (AZURE_KV_*) — NOT GCP Secret Manager
- Google native Join meeting button: **PRESERVED** — `buildConferenceData` workaround in `_lib/google-calendar.js` ported intact per Andy's correction "I want the google native Join meeting button, don't fuck with that"
- Postmark + Graph sendMail: **PRESERVED** (no Gmail swap) — port relay-mail.js + graph-mail.js intact
- Tate's recurring meetings migration: separate one-shot script, not blocking V2.1
- **Invite fan-out (V2 FINAL — 2026-05-29):** Google is the canonical invite source via `sendUpdates:"all"` on every google-calendar.js mutation. Graph still mints the calendar event + Teams binding but is silent on email — the M365 meetings@ mailbox in our tenant does not have email send rights, so Graph's `Prefer: outlook.send-notifications` header is a no-op there. The Google Workspace meetings@ account DOES have send rights and fans the `.ics` (Invitation / Updated invitation / Canceled event) from its side. Verified end-to-end 2026-05-29 — see context.md §V2.2.2b.7. The 2026-04-28 m365-primary-meeting-scheduler design doc is now historical; current source of truth is google-calendar.js + the verification log in context.md.

**V2.1 landed in same session (2026-05-27):**
- ~~`api/meetings/_lib/*` ported verbatim from archive~~ ✓ (keyvault, cors, auth, attendee-helpers, google-calendar, graph-events, graph-mail, relay-mail, agenda-email, schedule-email)
- ~~`api/meetings/{reschedule,list,create,cancel,rename,attendees,send-prep,send-schedule}.js` ported~~ ✓ (V2.1 ships reschedule + list; others come on in later slices)
- ~~Slug-based orgId compat shim in list.js + listEvents + listEventResponses~~ ✓ (Console used numeric, Management uses slugs)
- ~~`src/pages/Calendar.jsx` (read-only meeting list)~~ ✓
- ~~`src/components/RescheduleDialog.jsx`~~ ✓ (V2.1 ⭐ ship target)
- ~~`src/lib/meetingsApi.js` (fetch wrapper, X-User-Token = Firebase ID token)~~ ✓
- ~~Route `/calendar` + sidebar link + QueryClientProvider wiring~~ ✓
- ~~Deps: `@azure/identity`, `@azure/keyvault-secrets`, `googleapis`~~ ✓
- ~~CORS allowlist updated for vm-management-front-end origin~~ ✓

### Pending V2.1 ops (Andy)

- **Vercel env vars** — copy from `~/Vistamar_Consulting/VMConsoleFrontEnd/.env.local` to Management's Vercel project (Settings → Environment Variables): `AZURE_KV_URL`, `AZURE_KV_TENANT_ID`, `AZURE_KV_CLIENT_ID`, `AZURE_KV_CLIENT_SECRET`. Set for Production + Preview + Development scopes. Trigger redeploy after.
- **Live test** — once env vars are set: open `/calendar` on the deployed Management site → see meetings@'s upcoming events → reschedule a non-critical one (NOT the GV biweekly until smoke test passes) → verify Outlook + Google update correctly.

### V2.1 → V2.2+ tightening

- **Backend auth upgrade — gating BOTH the dormant endpoints AND the V2.1-live endpoints** — `api/meetings/_lib/auth.js` is presence-only (matches Console). Upgrade: verify Firebase ID token via `firebase-admin` (add dep, init Admin SDK in api/, parse `X-User-Token` as ID token, check `email.endsWith('@vistamarconsulting.com')` AND `users/{uid}.active == true`). Roughly 30 lines. **Do BEFORE setting `MEETINGS_V2_2_ENABLED=true`** — the V2.2 endpoints (cancel, attendees, send-prep, send-schedule especially) are higher-blast-radius than reschedule.
- **`MEETINGS_V2_2_ENABLED=true` env flag** — gates 6 dormant endpoints (create, cancel, rename, attendees, send-prep, send-schedule) behind `requireV2_2Enabled` check in `api/meetings/_lib/auth.js`. Until set, they 404. Flip when V2.2 ships AND the Firebase-ID-token auth upgrade above is done. Remove the `requireV2_2Enabled` calls + helper when V2.2 is stable.
- **`agenda-email.js` user-facing string** — has "View full agenda in Console" link. Update when porting send-prep + send-schedule in V2.4.

## V3 / Far-Future

- **AI-driven Project Board updates** — Andy 2026-05-27 direction: use Fireflies meeting transcripts + Meeting Agendas to auto-suggest items/decisions. AI-suggested items land with `statusId: 8` (AI Gen), human confirms into Assigned. See `[[project-v3-ai-feature-intent]]` memory when written.
- **Task File uploads** (Firebase Storage) — Blaze-gated. V1 ships URL-link-only Files dialog.
