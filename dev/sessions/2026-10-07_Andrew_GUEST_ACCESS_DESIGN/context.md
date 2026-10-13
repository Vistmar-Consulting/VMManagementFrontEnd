# Session — Client guest access (design, paused)

**Date:** 2026-10-07 · **Developer:** Andrew · **Status:** paused (design not started; no code)
**Branch:** worktree `.claude/worktrees/guest-agenda-access` on `guest-agenda-access`, cut from local `main` at `28f889f`
**Folder name:** no version number — this is a design session and no release is cut yet.

## Ask

Let an external client contact (first case: David Embleton, Unio) open a link to a Unio meeting agenda (the biweekly) and take part in it live.

## Decisions (Andy, 2026-10-07)

- A guest sees **only their own organization's** data: that org's Task Board and that org's meeting agendas. Nothing from Vistamar or any other client.
- A guest can **view and manually edit both** the org's Task Board items and its agendas.
- A guest **cannot** use Sync Meeting, Manage Guests, send invites or any meeting-admin action.
- Do **not** solve this by giving the guest a `@vistamarconsulting.com` account: org is a tag, not a tenancy boundary, and `isAdmin()` == `isActiveUser()`, so that would expose every client's data with full write.

## Open question (blocking the design)

How a guest is granted access. Recommended: a "Portal access" toggle per contact in each org's Settings member directory (`organizations/{slug}/members/{email}`), so Andy switches David on under Unio and any other client works later with no code change. Alternative: hard-code David's email. Andy has not answered.

## Current state of access (mapped 2026-10-07, file:line on `28f889f`)

A non-Vistamar account is rejected at six layers:
1. GIS/Google provider `hd: "vistamarconsulting.com"` — `src/firebase.js:21`; also check the GIS `initialize` call at `src/pages/SignIn.jsx:59`.
2. AuthContext force sign-out — `src/contexts/AuthContext.jsx:68-81` (`REQUIRED_EMAIL_DOMAIN`, line 10). It also bootstraps `users/{uid}` with `role:"member", active:true` on first sign-in (86-108).
3. `ProtectedRoute` → `/signin` — `src/components/ProtectedRoute.jsx:25`. Agenda route `/agendas/:agendaId` sits inside `<ProtectedRoute><SignedInLayout/></ProtectedRoute>` (`src/routes.jsx:25-39`). SignIn returns to `location.state.from`, so deep links survive sign-in.
4. Firestore `signedIn()` domain regex — `firestore.rules:21-26`. Every collection is gated on `isActiveUser()`.
5. Storage `signedIn()` — `storage.rules:9-14`.
6. Server `requireAuth` 403 "Vistamar domain required" — `api/meetings/_lib/auth.js:86-89`; gates every `/api/meetings/*` endpoint and `api/liveblocks-auth.js`.

No guest/viewer role, share token or external-user code exists anywhere.

## What the design must handle

- **Fireflies key exposure.** `PastMeetingsCard` calls Fireflies from the browser with `VITE_FIREFLIES_KEY` (`src/lib/fireflies.js:13-35`). Guests must not load that card or that bundle code.
- **Unscoped subscriptions.** `AgendaDetail` subscribes to all of `items` (`useItems()`), `users`, `organizations`, `categories`, `tags` (`AgendaDetail.jsx:1682-1698`). Firestore rules are not filters: a guest query must itself be constrained to `organizationId == <guest org>` or the whole read is denied. Same applies to the Task Board page.
- **Liveblocks scope.** `api/liveblocks-auth.js:21` grants `agenda:*` FULL_ACCESS to any authed user and ignores the requested room. Guests need only their org's agenda rooms (`agendaRoomId()` in `src/lib/agendaRoom.js:27-33`; long ids are hashed, so the server must map room → agenda → org, not parse the room string).
- **Collab mirror writes.** `CollabBodyEditor` debounces Firestore writes of `bodyHtml` / `openFloorHtml` (`CollabBodyEditor.jsx:181-195`), so guest editors need update on `agendas/{id}` and `topics/{tid}` for their org.
- **Item numbering.** `MiniProjectBoard` and Task Board create items in a transaction that updates `organizations/{org}.nextItemNumber` (and parent `nextSubitemNumber`). Guests need a narrow, field-limited write on the counter.
- **Agenda org resolution.** An agenda's org comes from `calendar_series/{id}.organizationId` (or the agenda itself when unbound — `AgendaDetail.jsx:242-246`). Rules need a field they can read directly; check whether every agenda carries `organizationId`.
- **Attendees are not rule-checkable.** `agendas/{id}.attendees` is an array of `{email, name, status}` maps; rules can't do `email in attendees`. Granting by org contact (open question above) avoids this.
- **Guest UI.** Guests get a stripped shell (no full sidebar, no other orgs, no Sync Meeting / Manage Guests / invite / cancel / reschedule / org-assign / history-restore controls). Hiding controls is UX only; rules and `requireAuth` are the real gate.
- Item comments/files rules (`items/{id}/comments`, `/files`) and storage paths need guest-org scoping if guests get those.

## Next step

1. Get Andy's answer on the grant mechanism.
2. Propose 2-3 architectures (e.g. guest role on `users/{uid}` with `guestOrgId` set server-side from the org member directory vs. Firebase custom claims vs. a server-proxied guest API), recommend one.
3. Present the design section by section, then write the spec to `docs/superpowers/specs/` and run the spec review loop (superpowers:brainstorming flow).

## Deferred

- **Server `requireAuth` never checks `users/{uid}.active`** (`api/meetings/_lib/auth.js`): a deactivated Vistamar user still passes every `/api/*` endpoint and Liveblocks auth. Found 2026-10-07; outside this task's scope; Andy has not yet said whether to fix it separately. Pick up when guest roles are designed (the same helper will need a role/org check) or sooner on request.
