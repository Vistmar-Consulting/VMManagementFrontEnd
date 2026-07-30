# Session: v0.4.6 — Scheduler Attendee Picker Roster Fix

**Developer:** Andrew
**Date:** 2026-07-27 → 2026-07-30
**Branch:** main → origin/dev
**Status:** CLOSED — code pushed to `origin/dev`, **not deployed to production**

---

## Origin

Session opened with a calendar question (was there a BMD meeting on Tue 2026-07-28 with Abigail, Denni and Diana — answer: no, and it had never been scheduled). Andy then moved to making an ad-hoc Vistamar meeting through the front end and asked why the meeting scheduler's attendee dropdown didn't list the whole Vistamar team.

## Root Cause

Two dropdowns in `NewMeetingDialog` were reading two different Firestore collections:

- **Teammate dropdown** → `users` collection (`Calendar.jsx:249` `useCollection("users")` → `internalChoices`).
- **Client dropdown** → `organizations/{orgId}/members`.

A `users/{uid}` doc is only minted on that person's **first Google SSO sign-in** (`src/contexts/AuthContext.jsx:86-108`), and `src/pages/Members.jsx` is still a 14-line stub with no provisioning path — `grep` finds no other write to `users`. So the teammate dropdown was really "people who have logged into the app at least once."

Bill Lewis and Hugo Furth have never signed in. They exist only in `organizations/vistamar/members`, which on the deployed build fed **only the client dropdown** — so they surfaced as *client attendees of Vistamar* while being absent from the teammate list. That inversion is what Andy spotted.

## What Shipped

Commit **`caccf88`** on `origin/dev` — `fix(meetings): scheduler teammate picker reads the full Vistamar roster`.

### 1. Shared roster helper — `src/lib/orgMembers.js`

New exports: `VISTAMAR_ORG_ID`, `isVistamarTeamEmail()`, `vistamarTeamChoices()`.

`vistamarTeamChoices()` **unions** `organizations/vistamar/members` with `users`, because neither source is complete alone — the directory misses anyone never added, `users` misses anyone never signed in. Deduped by lowercased email (curated directory name wins), sorted by display name. The list was previously in Firestore doc-id order, which read as random.

Used by **both** `NewMeetingDialog` and `ManageGuestsDialog` so the two pickers cannot drift.

### 2. The domain gate is load-bearing

The union is filtered by `isVistamarTeamEmail` (VM domain, not a bot/proxy). This is not defensive decoration — the pre-push code review caught that `handleCreate` auto-captures non-VM attendees into the meeting's org directory. Without the gate, an external guest on a Vistamar meeting would land in `organizations/vistamar/members` and then be offered as a "Vistamar teammate" permanently, in both dialogs, for every user.

Also stopped at the source: auto-capture is now **skipped for the Vistamar org** in both dialogs, alongside the existing `isMaster` skip.

### 3. Client dropdown no longer offers teammates as clients

`showClientSection = !!orgId && orgId !== VISTAMAR_ORG_ID`. Fixed a related staleness bug the review found: selecting a client then switching org left the pick attachable through the greyed-out dropdown, misfiling that contact onto the new org. `clientPick` now resets on org change and the Add button honours `showClientSection`.

### 4. `seo@` is no longer pickable — intended

It is a silent proxy that `api/meetings/create.js:61` prepends to every event via `withSilentProxies`. Fireflies coverage is unaffected. Verified `MEETINGS_SKIP_FIREFLIES_FOR_TESTS` is **absent from the Vercel production environment** (`vercel env ls production`), so server-side prepend is the only path and it is intact.

---

## Verification

- **128 tests pass** (was 106) — 15 new on `vistamarTeamChoices`/`isVistamarTeamEmail`, 7 on the dialog wiring.
- **Verified the dialog tests actually catch the bug**: reverted the fix, re-ran, 3 failed red, restored.
- Production **build clean** (`npm run build`, 49s).
- Pre-push code review run per CLAUDE.md — found 1 Critical + 3 Important, all addressed above.
- ❌ **UI HARD GATE NOT MET.** The rendered dropdown was never driven in a browser. The saved agent-browser session for `localhost:5173` had expired and re-auth hits Google SSO requiring Andy's password. Covered by component tests instead. The underlying data is corroborated by Andy's own Settings > Organizations screenshot, which reads the same collection through the same hook and shows all five teammates.

---

## Deployment State

| | |
|---|---|
| `origin/dev` | `caccf88` — has the fix |
| Production alias | `vm-management-front-end.vercel.app` → `vm-management-front-pgy27dw5d` (**2 days old, pre-fix**) |

Vercel is **not** auto-deploying from `dev` on this project. `git-dev` resolves to the same stale deployment, so there is no preview carrying the fix either. **Andy has not yet seen this working.**

---

## Deferred

### 1. Deploy `caccf88` to production — BLOCKING
**Why deferred:** a prod deploy puts the change in front of the whole team, not just Andy; he authorized the push but not the deploy, and the session closed before he called it.
**Trigger:** next session, first action. `npx vercel deploy --prod` then `npx vercel alias set <new-url> vm-management-front-end.vercel.app`.

### 2. Fix `Scot Robinsons` typo in `organizations/vistamar/members`
**Why deferred:** data edit, not code; Andy's call.
**Trigger:** before the deploy above. Display names now come from that directory and flow into outgoing Teams invites, so the typo becomes client-visible. Fix in Settings > Organizations.

### 3. UI browser verification of the teammate dropdown
**Why deferred:** blocked on Google SSO re-auth for `localhost:5173`; would have required handling Andy's credentials.
**Trigger:** after deploy — open the deployed Calendar → + New Meeting → confirm all five teammates list and the client dropdown is disabled for Vistamar.

### 4. Mixed avatar row in the attendee list
**Why deferred:** cosmetic; identical to already-shipped `ManageGuestsDialog` behaviour.
**Trigger:** if it reads as a rendering bug in use. `MemberAvatar` falls back to grey `DEFAULT_BG` for teammates with no `users/` doc (correct initials, no `avatarColor`), so a roster mixes coloured and grey avatars.

### 5. `NewMeetingDialog.attendees.test.jsx` dominates suite runtime
**Why deferred:** not incorrect, just slow — `vi.setConfig({ testTimeout: 30000 })` gives headroom for a genuine ~5s render.
**Trigger:** when that file grows. Stub `@mui/x-date-pickers` (no test touches the date/time fields) or render once per `describe`. 7 tests currently cost ~36s of the suite's ~28s baseline.

### 6. `npm run lint` is broken repo-wide
**Why deferred:** pre-existing, unrelated to this work, untouched per scope discipline.
**Trigger:** any session that wants lint in the loop. ESLint 8.57 exits with "couldn't find a configuration file" — there is no eslint config in the repo.

### 7. Members admin page is still a stub
**Why deferred:** out of scope; the union helper works around it.
**Trigger:** when someone needs to grant/revoke access or deactivate a user without the Firebase console. `src/pages/Members.jsx` is 14 lines and says role changes happen in the Firebase console. This is the real reason `users` was never a complete roster.

### 8. Studio API proxy is merged but inert
**Why deferred:** feature is unfinished; no FE caller exists.
**Trigger:** when Studio integration resumes. `api/content/clients.js` + `api/content/_lib/studio.js` are now on `main` via the branch merge below, but `STUDIO_API_URL` and `INTEGRATION_API_SECRET` are **not set in Vercel production**, so those endpoints will fail if called. See `docs/studio-integration-guide.md`.

---

## Session Close

Merged `studio-integration-proxy` into `main` and deleted the branch, per Andy's close-out instruction to leave nothing unmerged. That merge carries the Studio API proxy, the BMD strand-fix diagnostic scripts, and the v0.4.5 session record onto `main` — **so the next `git push origin main:dev` ships the Studio proxy endpoints to dev/prod alongside this fix.** They are inert without the env vars above.

Only one git worktree has ever existed (the repo root); nothing to prune.
