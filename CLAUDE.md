# Vistamar Management — Frontend

Internal-only Project Management app for Vistamar Consulting. Spun out from `VMConsoleFrontEnd` on 2026-05-12. Firebase-native (no Hugo .NET API, no SQL Server, no Microsoft Graph).

## Spec

Source of truth: `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`. Read at the start of every conversation in this repo.

## Deployment & Environment

- **Primary test surface:** the deployed **Vercel site**. Design and QA happen directly against Vercel (FE) with the live `/api/*` serverless functions and Firestore — not against a local dev server.
- **Dev server:** `npm run dev` → `http://localhost:5173` (available for quick local checks; proxies `/api/*` to the deployed backend).
- **Build:** `npm run build` → `/dist`
- **Hosting:** Vercel (FE) + Firebase project `management-db9eb` (Auth, Firestore, Functions, Storage)
- **Auth:** Google SSO restricted to `@vistamarconsulting.com`

**Dev server is Claude-managed.** Claude may freely start, restart, force-rebuild (`npm run dev -- --force`), or kill the local dev server as needed — e.g. to clear a corrupt Vite `.vite/deps` optimized-dependency cache (symptom: app renders blank at every route with CJS-interop errors like `… does not provide an export named 'default'`). No need to ask first. Since the dev server isn't the primary test surface, killing it has no shared-state cost.

## Tech Stack

React 18.3 + Vite 5.2 (SWC), React Router v6, MUI 5.15, Emotion, TanStack React Query 5 (only for callable Cloud Functions), Firebase Web SDK 11, Lucide React, date-fns, `@uidotdev/usehooks`, `fractional-indexing`, `react-beautiful-dnd`.

**Dropped from VMConsoleFrontEnd:** Redux Toolkit, Formik, Yup, Auth0/Cognito/JWT contexts, axios, all Hugo API code paths, Microsoft Graph, Postmark, Azure Identity/Key Vault, FullCalendar (Calendar V2 will use a different lib).

## Phasing

- **V1** — Project Board, Members, Organizations, Auth, dev system port
- **V2** — Meetings + Agendas (Firebase Functions + Google Calendar service-account on `meetings@vistamarconsulting.com`)
- **V3** — TBD

V1 ships first. Spec covers all three.

## Organization Model

Every domain entity (item, meeting, agenda) has an `organizationId` field. Organizations are first-class: clients (`organizations/total-vision`, etc.) **plus** Vistamar itself (`organizations/vistamar`, `type: 'internal'`). Org is a **tag**, not a tenancy boundary — every signed-in user sees every document.

## Data Model

See spec section 4. Key collections:

- `users/{uid}` — Firebase Auth UID = doc ID; canonical Member
- `organizations/{orgSlug}` — clients + Vistamar
- `items/{itemId}` — unified projects + tasks (parentId, hasChildren, fractional `order`)
- `items/{itemId}/comments/{commentId}` — threaded
- `calendar_series/{seriesId}` (V2)
- `calendar_series/{seriesId}/agendas/{agendaId}` (V2)

## Real-time Data Flow

Components subscribe via Firestore `onSnapshot` through thin hooks (`useDoc`, `useCollection`, plus domain wrappers like `useItems(filters)`). React Query is **only** for HTTPS Cloud Function calls.

## Security Rules

See spec section 5. Single role gate: signed-in `@vistamarconsulting.com` + `users/{uid}.active == true`. `isAdmin()` check gated by `users/{uid}.role == 'admin'`. Comments are author-only edit; items are any-active-user write.

## File Organization

**Never create files in the project root.** Root = config only.

| Content | Location |
|---|---|
| Source code | `src/` |
| Cloud Functions | `functions/` |
| Specs | `docs/superpowers/specs/` |
| Implementation plans | `docs/plans/` |
| Session folders | `dev/sessions/` |
| Dev onboarding | `dev_onboarding/` |
| Unit/integration tests | `src/{path}/__tests__/` |
| E2E tests | `e2e/` |

## Workflow Discipline

1. **When something breaks → invoke `superpowers:systematic-debugging` immediately.** No guess-and-retry.
2. **When approach needs to change → back to `superpowers:brainstorming` or `superpowers:writing-plans`.** No mid-code pivots.
3. **UI VERIFICATION HARD GATE — verify yourself before asking Andy.** When developing/fixing anything that produces UI behavior, drive the dev server via `/agent-browser` or Playwright. Code change → open browser → click through → screenshot/DOM snapshot → only then report.
4. **AI Integration page must stay in sync.** Any change to the Sync Meeting workflow or system prompts (`api/ai/prepare.js`, `api/ai/refine.js`) must also update the `HOW_IT_WORKS` constant in `src/pages/AIIntegration.jsx`. New guardrail, new format rule, new input source, changed behavior — add or update the relevant row. This is how the team sees what the AI actually does.

## Session Context — THE BRAIN

Every session has `dev/sessions/{folder}/context.md`. **Single source of truth for session state — no separate HANDOFF or DEFERRED files.**

Check `dev/SESSION_INDEX.json` at session start. If active session exists, read its `context.md` and maintain it. If no active session, infer task from developer's first message and start one via `/new-session`.

`context.md` owns:
- Live state (what's shipped, what's in flight, what's blocked)
- **Deferred items** — anything not done this session that needs to survive into the next. Maintained as a running tracker inside the file (e.g. a "## Deferred" section), updated as items are added or closed.
- Session close summary written at the end of the session (in-place, not as a separate file)

When a session closes and a new one starts, the next session's `context.md` carries forward whatever deferred items are still live. The old session's `context.md` stays in its folder as an archive.

**Do not create** `dev/HANDOFF_*.md`, `dev/DEFERRED.md`, or `dev/DEFERRED_PLAYBOOK.md`. These were a prior convention; retired 2026-05-29 because they redundantly captured what `context.md` already tracks.

## Push Workflow

- Push target: **`origin/dev`** always (matches console convention)
- **Local stays local — no local feature branches.** Work on local `main`, push that to `origin/dev` (`git push origin main:dev`).
- Never push `main`/`stage` directly to remote
- Pre-push: `superpowers:requesting-code-review`, address findings before push

## Cross-Stack Naming Parity

FE field name = Firestore field name = Cloud Function payload field name. Lower-camelCase throughout. No SQL-style PascalCase / underscore_case anywhere — that was a Hugo-API artifact.

## Coding Conventions

- Functional components + hooks only
- Emotion `styled()` wrapping MUI; import as `Mui`-prefixed, re-export styled (port pattern from Console)
- Filter state: `useLocalStorage` from `@uidotdev/usehooks`
- Heavy pages: `async()` wrapper for code splitting
- File naming: PascalCase components, camelCase utilities
- No `console.log` in committed code
- No commented-out code
- Server-only secrets live in Firebase Functions environment / GCP Secret Manager — never `VITE_` env vars

## Firebase Project

- Project ID: `management-db9eb` (created 2026-05-13; Firebase auto-suffixed because `management` was taken)
- Display name: `Management`; user-facing sign-in name: `Vistamar Management`
- Web app: `vm-management-web` (app ID `1:206947368406:web:7e7fd576ad64ea2b8a7877`)
- Region: `us-west1` (Oregon) — Firestore Native mode, permanent. Cloud Functions for V2 deploy to same region.
- Plan: Spark (no-cost). V2 will require Blaze upgrade for Cloud Functions.
- Auth: Google provider enabled, public-facing name "Vistamar Management"
- Storage bucket: `management-db9eb.firebasestorage.app` (new Firebase bucket scheme; not `.appspot.com`)
- Service account for Google Calendar (V2): reuses existing `console-meetings-service@console-meetings.iam.gserviceaccount.com` (in GCP project `Console-Meetings`)
- Secrets: GCP Secret Manager (`meetings-service-account-key`, etc.)
- Client SDK config: `VITE_FIREBASE_*` env vars in `.env.local` (gitignored). Web `apiKey` is public-by-design — protected via Firestore security rules + Auth domain restriction, not key secrecy.
