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
