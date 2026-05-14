# Session: SES-20260512-Andrew-v0.1.0-bootstrap

- **Session ID:** SES-20260512-Andrew-v0.1.0-bootstrap
- **Developer:** Andrew
- **Date:** 2026-05-12
- **Version Start:** v0.1.0 (fresh scaffold, no version_logs yet)
- **Version End:** (pending)
- **Commit Start:** 671b469248f6fe33889f0b701e1b45f96d460a37
- **Branch:** main
- **Task:** V1 bootstrap — install deps, verify scaffold loads, then lay foundation (theme, Firebase client, AuthContext, useDoc/useCollection, routing shell) so Project Board work can begin
- **Folder:** dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/
- **Status:** active

## Source-of-Truth Docs

- Spec: `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` (V1 + V2 + V3, locked decisions)
- Deferred: `dev/DEFERRED.md` (V1 bootstrap + V2 backlog)
- Project rules: `CLAUDE.md`
- Archive (read-only PM reference): `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`

## V1 Scope Snapshot

Project Board end-to-end:
- Auth (Google SSO, `@vistamarconsulting.com`, domain-restricted)
- Firestore + security rules + real-time hooks (`useDoc`, `useCollection`)
- Collections: `users/{uid}`, `organizations/{slug}`, `items/{itemId}` (+ `comments` subcollection)
- Pages: SignIn, Dashboard (Mini Project Board), TaskBoard, ItemDetail, Members, Organizations, Settings, Profile
- TaskBoard surface: status columns 1–6 (Archive=7 hidden behind toggle), Organization filter chips, drag-and-drop reorder via fractional rank
- Threaded comments (subcollection), file attachments (Firebase Storage)
- MUI + Emotion port from Console (minus Guide editorial palette)
- Dev system port (audit feature_memory, slash commands, site-architecture.json)

## Pre-Implementation Blockers (open per `dev/DEFERRED.md`)

- `npm install` — not yet run
- Firebase project `vm-management` — not yet created in Firebase console (Andy owns)
- Vercel project — not yet linked (Andy owns)
- `firebase init` for functions/firestore/storage — pending Firebase project
- No `dev` branch yet — push workflow is `origin/dev` only; we'll need to create one before any feature work merges

## Plan for This Session (proposed, awaiting Andy approval)

1. `npm install` — populate `node_modules` + lockfile
2. `npm run dev` — boot Vite, confirm scaffold renders at `http://localhost:5173` via agent-browser (UI verification hard gate)
3. Stop here and re-align with Andy on the next slice (theme port? AuthContext skeleton? Firebase client init? site-architecture seed?)

## Files Modified

- `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — added active session entry
- `dev/HANDOFF_2026-05-12_V1_BOOTSTRAP.md` — written mid-session (Andy's VS Code became unresponsive; safe-state checkpoint)

## Current State (live, updated as work progresses)

**Slice 1 complete** — installed deps, wired Firebase SDK, smoke-tested via agent-browser.

- `npm install` completed on second attempt (first hit ECONNRESET); `node_modules/` + `package-lock.json` present.
- Firebase project `management-db9eb` created by Andy (auto-suffixed; spec's `vm-management` placeholder is dead).
  - Region: `us-west1` (Oregon) — permanent.
  - Plan: Spark.
  - Web app `vm-management-web` registered.
  - Google Auth provider enabled, public-facing name "Vistamar Management".
  - Firestore Native mode created in `us-west1`, production-mode locked rules.
- `src/firebase.js` created — initializes Web SDK, exports `app`/`auth`/`db`/`storage`/`googleProvider`. Hosted domain set to `vistamarconsulting.com`.
- `src/main.jsx` imports `./firebase.js` for boot-time init.
- `.env.local` populated with real config (gitignored).
- `CLAUDE.md` Firebase Project section updated with real values.
- Dev server boots cleanly on `localhost:5173`. Scaffold renders; Firebase init throws no errors.

**Slice 2a complete** — AuthContext + SignIn page wired and verified end-to-end.

- `src/contexts/AuthContext.jsx` — `onAuthStateChanged` subscription; exposes `{ user, loading, signIn, signOut }`.
- `src/pages/SignIn.jsx` — single Google button via `signInWithPopup`, surfaces auth errors (skips `auth/popup-closed-by-user`).
- `src/App.jsx` — loading spinner → SignIn (signed out) → placeholder Shell with name/email/UID/Sign-out (signed in).
- Andy verified Google OAuth round-trip in his own Chrome on 2026-05-13. UID captured: `P63r1qyS0vOQ4BovyRit6EwI5sk2` (saved to memory).
- Signed-in state is a placeholder — no Firestore subscription yet because rules are still deny-all by default.

**Slice 2b in progress (2026-05-14)** — Firestore foundation: rules + client-side user-doc bootstrap + first hooks.

- Branch: `dev` (created from `main` this session; first feature branch on the repo). Push deferred — confirm with Andy before pushing.
- Firebase config files written directly (skipped interactive `firebase init`):
  - `firebase.json` — firestore + storage sections.
  - `.firebaserc` — project alias `management-db9eb` → default.
  - `firestore.rules` — V1 ruleset per spec §5 with three documented deviations (see file header). Spec assumed an auth-onCreate Cloud Function bootstraps the user doc; we're on Spark so no Functions, hence client-side bootstrap.
  - `firestore.indexes.json` — empty; first composite indexes land with TaskBoard query needs.
  - `storage.rules` — V1 ruleset; agenda path included as V2 placeholder.
- `src/hooks/useDoc.js` — single-doc `onSnapshot` wrapper, returns `{data, loading, error}`. Falsy path disables.
- `src/hooks/useCollection.js` — collection-query `onSnapshot` wrapper with `constraints` array. Caller-owned memoization (domain wrappers will handle).
- `AuthContext` extended — after `onAuthStateChanged`, probes `users/{uid}` via `getDoc`; if missing, `setDoc` with defaults (`role: 'member'`, `active: true`, deterministic pastel `avatarColor`, `joinedAt: serverTimestamp()`). Then subscribes to the doc via `onSnapshot` for live role/active updates. Exposes new fields: `profile`, `error`, `isAdmin`.
- `App.jsx` — extended shell renders profile-aware UI (avatar swatch, role chip, inactive-account guard). Spinner caption when waiting on profile load.
- **Rules deployed** 2026-05-14 via `npx firebase deploy --only firestore:rules`. Storage rules pending Andy clicking "Get Started" on Storage in the Firebase console (the bucket isn't initialized yet).
- **End-to-end verified** via Playwright on Andy's existing browser session at `localhost:5173`:
  - Bootstrap fired on signed-in page load → `users/P63r1qyS0vOQ4BovyRit6EwI5sk2` created.
  - Doc fields verified: `email`, `displayName`, `firstName`/`lastName`, `avatarColor: '#ffaaa5'`, `role: 'member'`, `active: true`, `joinedAt: 2026-05-14T20:19:24.796Z`.
  - Shell renders: name, email, avatar swatch ("A"), role chip ("member"), UID, sign-out button.
  - Screenshot: `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/slice-2b-signed-in-shell.png`.
  - Console errors observed: 6 × `Cross-Origin-Opener-Policy policy would block window.closed/close` from `firebase_auth.js`. Pre-existing (originate from Slice 2a's `signInWithPopup` flow), not from this slice. Harmless during the post-auth bootstrap path. Worth a follow-up later to set proper COOP headers on Vite dev server.
- **Manual seeds done (2026-05-14):**
  - Andy's `users/{uid}.role` flipped to `'admin'` via Firebase console. Live `onSnapshot` in his open tab caught the change without refresh.
  - `organizations/vistamar` doc created: `name: 'Vistamar Consulting'`, `type: 'internal'`, `accentColor: '#2c5f7c'`, `active: true`, `archived: false`, `createdAt: 2026-05-14T20:36:40Z`.
- **Storage deferred (2026-05-14):** Firebase Storage now requires Blaze (Firebase reclassified it from Spark to Blaze-only in late 2025). Decision: don't upgrade yet — Storage is unused until the task-file-attachments slice or V2 (whichever lands first). `storage.rules` stays committed; one `npx firebase deploy --only storage` ships it when Blaze flips on. `firebase.json` still references storage but deploys are scoped via `--only firestore:rules` so it doesn't trip.

**Slice 3 complete (2026-05-14)** — App shell: theme port, React Router, ProtectedRoute, sidebar nav, top bar, page stubs.

- **Theme port from VMConsoleFrontEnd `src/theme/`:**
  - `src/theme/index.js` — single `createTheme()` (no variant switching).
  - `src/theme/palette.js` — default variant only; ported `customBlue` ramp + light-mode primary/secondary/background. Guide cream/copper explicitly excluded.
  - `src/theme/typography.js` — Inter font stack, 13px base, h1–h6 sizes verbatim.
  - `src/theme/breakpoints.js`, `shadows.js` — ported verbatim.
  - `src/theme/components.js` — MUI component overrides; dropped `MuiPickers*` (Console uses v5; we'll wire v6 fresh later) and fixed the broken `border: 1px solid red` MuiMenu hack.
  - Theme extended at module level with `theme.sidebar` (`width: 240`, navy `#233044`, brand color from customBlue ramp) and `theme.appBar` (`height: 56`, white bg, slate text). Used by `Sidebar` and `AppTopBar` via `sx={(theme) => ...}`.
- **Routing (`src/routes.jsx`):**
  - `/signin` — SignIn page, no auth required.
  - All other routes wrapped in `ProtectedRoute` → `SignedInLayout` → page outlet.
  - `/members` and `/organizations` double-wrapped in `<ProtectedRoute requireAdmin>` — non-admins get an admin-only Alert.
  - `/` → redirect to `/dashboard`. Unknown paths → redirect to `/dashboard`.
- **Components:**
  - `src/components/ProtectedRoute.jsx` — gates on AuthContext (`loading` → spinner, no `user` → redirect, no `profile` → spinner, `!profile.active` → disabled-account screen, `requireAdmin && !isAdmin` → admin-only alert). Replaces the inline gating that previously lived in `App.jsx`.
  - `src/components/Sidebar.jsx` — navy left rail with Lucide-react icons, NavLink-driven `.active` styling, per-item `requireAdmin` filter.
  - `src/components/AppTopBar.jsx` — white app bar with route-derived title, avatar dropdown menu (display name, email, sign-out).
  - `src/layouts/SignedInLayout.jsx` — flex container: Sidebar + (AppTopBar over `<Outlet />`).
- **Page stubs:**
  - `Dashboard.jsx` — welcomes user by firstName, "Mini Project Board lands here" placeholder.
  - `TaskBoard.jsx` — placeholder grid of 4 column cards (Assigned / In Progress / Review / Done).
  - `Members.jsx` — admin-only stub.
  - `Organizations.jsx` — admin-only, ALREADY WIRED to live `useCollection('organizations')` so the seeded `vistamar` doc renders.
  - `Settings.jsx`, `Profile.jsx` — Profile renders real fields from `AuthContext.profile`.
- **App.jsx** rewritten to wrap `<ThemeProvider><CssBaseline><BrowserRouter><AuthProvider><AppRoutes></...>`. Old inline shell removed entirely.
- **Verified (signed-out, via Playwright):** `/dashboard` → ProtectedRoute redirect to `/signin` → SignIn page rendered with theme applied. No JS errors from this slice (only the pre-existing Firebase Auth COOP popup-close noise). Screenshot: `slice-3-signin-page.png`.
- **Verified (signed-in, via Andy's Chrome at 2:08pm):** loaded `localhost:5173`, redirected from `/` to `/dashboard`, sidebar rendered with all 6 destinations + Members and Organizations visible (admin role gate passed), active-route highlight on Dashboard, top bar showed "Dashboard" title + admin chip + coral "A" avatar at far right, Dashboard card rendered "Welcome, Andy."
- **Layout fix mid-slice (2026-05-14):** initial top-bar render had the right-side cluster (admin chip + avatar) hugging the title at x=387 instead of pushed right. Root cause: `<Typography sx={{ flex: 1 }}>` doesn't reliably expand inside MUI's `<Stack>` because Typography's styled-component overrides interact with the flex shorthand. Fix: removed `flex: 1` from Typography and used `justifyContent="space-between"` on the parent Stack instead. Verified visually after Andy refreshed.

**Slice 4 complete (2026-05-14)** — items collection + first live TaskBoard render.

- **SQL pm.Items inspected** via mcp__sql-server to validate status IDs and item shape. Real-world findings:
  - V1 spec keeps status IDs `1=Assigned, 2=In Progress, 4=Review, 5=Done, 7=Archive`. SQL also has `3=On Hold, 6=Pending, 8=AI Gen` — V1 drops Pending and AI Gen entirely, and On Hold becomes a `onHold: boolean` flag rather than its own status (per spec §4).
  - Real items are organized around onboarding, account access transfer, migrations, SEO/analytics prep, etc. — informed the seed sample titles.
  - My placeholder TaskBoard had hardcoded the wrong column IDs (1, 2, 3, 6); fixed to (1, 2, 4, 5).
- **New files:**
  - `src/constants/itemStatuses.js` — `STATUS` enum, `BOARD_COLUMNS` table (id, label, color matching SQL Status_Color), `STATUS_LABEL`.
  - `src/hooks/useItems.js` — V1 wrapper around `useCollection('items', [orderBy('order','asc')])`. Server returns everything ordered by rank; caller filters in JS. Sidesteps composite-index requirements until item volume exceeds ~500.
  - `src/seed/sampleItems.js` — admin-callable seeder. Writes 11 realistic-flavored items (3 Assigned, 3 In Progress, 2 Review, 3 Done) all tagged `organizationId: 'vistamar'`, assigned to the current user, ranked via `fractional-indexing`. Idempotent via `_seedMarker` field check.
  - `src/components/ItemCard.jsx` — card UI: title, org pill (uses org's `accentColor`), optional `On hold` badge, optional due date with overdue red styling, assignee avatar circle. `opacity: 0.7` when `onHold` is true.
  - `src/pages/TaskBoard.jsx` rewritten — pulls all items + orgs + users via three `useCollection`/`useItems` subscriptions, builds in-memory lookup maps, filters client-side to `parentId==null && statusId != 7`, groups into 4 columns, renders.
- **Spec-deviation check (lean directive):**
  - `useItems` is deliberately a thin pass-through — does NOT yet expose filter args. Domain wrappers like `useOrgItems(orgId)` can layer on later when the Org filter chip slice lands. Avoided premature abstraction.
  - Seed action is gated to `isAdmin && totalItems === 0` so the button hides itself once items exist. Self-cleaning UX, no toggle needed.
- **Verified end-to-end via `/agent-browser` (the right tool — see [[drive-browser-yourself]]):**
  - Closed initial Playwright session, opened agent-browser with `--profile "Profile 10"` (Andy's Vistamar Chrome profile) → inherited his @vistamarconsulting.com auth without an interactive OAuth.
  - Navigated to `localhost:5173/board` → confirmed signed-in `Task Board` page with empty state and `Seed sample items` button.
  - Clicked seed → waited for snackbar text "Seeded" → re-snapshotted.
  - Final state: 11 items distributed (Assigned 3 / In Progress 3 / Review 2 / Done 3), titles match seed source, every card shows Vistamar Consulting org pill (`#2c5f7c`), every card has coral "A" assignee avatar, three cards show due dates (May 17/21/28), "Organization admin CRUD…" card shows the `On hold` badge and is correctly dimmed.
  - Screenshot: `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/slice-4-taskboard-seeded.png`.

**Rules deviations from spec §5 (documented for future maintainers, all noted in `firestore.rules` header):**

1. `users/{uid}` read allowed for SELF even when doc missing — required by Spark client-side bootstrap (probe-before-create).
2. `users/{uid}` create constrains `role == 'member'` and `active == true` so clients cannot self-promote.
3. `users/{uid}` self-update also blocks changes to `active` (spec only blocked `role`). Defense in depth — only an admin can deactivate.

## Decisions

- Session folder name `v0_1_0_Andrew_V1_BOOTSTRAP` chosen per Andy's suggestion; v0.1.0 because no `version_logs/` exists yet in this repo (Console's versioning hasn't been ported).
- Skipping the Console `/new-session` flow's prereq plugin check + version_logs lookup — neither applies here yet. Will revisit when we port the dev system.
- After install verifies + browser smoke-test passes, STOP and re-align with Andy on next slice (theme port vs. AuthContext skeleton vs. Firebase client init).

## Gotchas

- `@vistamarconsulting.com` Google Workspace is required for sign-in once Auth is wired. Service-account for V2 lives in the existing `Console-Meetings` GCP project (`console-meetings-service@console-meetings.iam.gserviceaccount.com`).
- Cross-stack naming parity rule (CLAUDE.md): FE field = Firestore field = Function payload field, lower-camelCase. Old SQL PascalCase is dead.
- "Do not kill running dev servers" — CLAUDE.md hard rule.

## Deferred

(track newly discovered items here; existing items live in `dev/DEFERRED.md`)

## Reviews

(none yet)

## API Plans

(none yet — Firestore-shaped plans replace the old SQL `/api-add-plan` flow; spec section 4 covers V1)
