# VMManagementFrontEnd — Project Spinout & Firebase Rebuild

**Date:** 2026-05-12
**Author:** Andrew Deemer (with Claude)
**Status:** Approved (brainstorm sections 1-4 reviewed live; sections 5-7 inlined per user direction)
**Original repo:** `~/Vistamar_Consulting/VMConsoleFrontEnd`
**New repo:** `~/Vistamar_Consulting/VMManagementFrontEnd`
**Conversational name:** "Management"

---

## 1. Decisions Locked In

| Decision | Choice |
|---|---|
| Who logs in | VM team only (`@vistamarconsulting.com` Google Workspace) |
| Repo strategy | Greenfield + selective copy (not fork-and-strip) |
| Microsoft Graph + Teams | Dropped entirely; Google Meet only |
| Deploy topology | FE on Vercel; Auth + Firestore + Functions + Storage on Firebase |
| Data migration | Selective migration of live data only |
| Data flow | Real-time Firestore listeners everywhere |
| Dev system | Audit + adapt (keep what's PM-relevant, drop SERP/Hugo cruft) |
| Auth provider | Google SSO only, domain-restricted to vistamarconsulting.com |
| Phasing | One spec, phased V1 → V2 → V3 |
| Organization model | First-class tag entity (clients + "Vistamar" itself); not a tenancy boundary |
| Items model | Unified `items` collection with `parentId` |
| Board ordering | Fractional rank |

---

## 2. Phasing

### V1 — Project Board + foundation (ship first)

- Auth (Google SSO, domain-restricted)
- Firestore + security rules
- Real-time data hooks (`useDoc`, `useCollection`)
- **Organizations** collection + admin UI (clients + "Vistamar")
- **Users** collection (canonical Member doc; Firebase Auth UID = doc ID)
- **Items** collection — full Project Board surface: Item-with-subtasks model, status lifecycle (Assigned → In Progress → Review → Done → Archive), Due_Date, On Hold, Overdue, `Status_Id 7 = Archive`, assignee by Member, **`organizationId` filter chip**
- TaskBoard, TaskBoardModal, TaskBoardRow, TaskBoardColumnHeader, TaskBoardFileModal — port shapes from current FE
- Mini Project Board (dashboard summary)
- Avatar Color System + Pastel Pill System
- Threaded Comments on tasks (Firestore subcollection)
- Task File Links (Firebase Storage)
- Member Management page
- Organization Management page (new — small CRUD)
- Settings + Profile (slim)
- Dev system ported

### V2 — Meetings + Agendas

- **calendar_series**, **agendas** (subcollection), **topics** (subcollection), agenda comments
- Calendar page + Agenda page + Manage Guests dialog + Send Meeting Invite button + Meeting Prep email
- Firebase Cloud Functions wrapping Google Calendar service-account API on `meetings@vistamarconsulting.com` (port from current `api/meetings/*`, drop Graph)
- Google Meet `conferenceData` on every event
- Gmail send via meetings@ service account (replaces both Graph sendMail and Postmark)
- Auto-bind agenda → calendar event preserved
- Org tag carries through every meeting/agenda
- Tate's recurring meetings migrated to meetings@ as part of V2 cutover

### V3 — Sketched only

Likely candidates: AI-assisted agenda drafting, client-facing read-only views, time tracking, reporting dashboards. Not designed now — data model leaves room.

---

## 3. Architecture Overview

Three runtime surfaces:

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser (Vite SPA on Vercel)                                     │
│  ─────────────────────────                                        │
│  • Firebase Auth (Google SSO, @vistamarconsulting.com)            │
│  • Firestore JS SDK — direct reads/writes via security rules      │
│  • Firebase Storage SDK — file uploads                            │
│  • React Query — only for HTTPS Function calls                    │
└──────────────┬───────────────────────────┬────────────────────────┘
               │                           │
               │ direct                    │ HTTPS callable
               ▼                           ▼
       ┌─────────────────┐       ┌──────────────────────────────┐
       │  Firestore      │       │  Firebase Cloud Functions    │
       │  Cloud Storage  │       │  (Node, in `functions/`)     │
       │  Firebase Auth  │       │  • Google Calendar mutations │
       │                 │       │  • Gmail send via meetings@  │
       │  All inside     │       │  • Migration script runner   │
       │  vm-management  │       │  • Auth-onCreate gate        │
       │  Firebase proj  │       │                              │
       └─────────────────┘       │  Secrets: GCP Secret Manager │
                                 └──────────────────────────────┘
```

**Principle:** the FE is the database client for ~90% of operations. Firestore security rules enforce access (signed-in `@vistamarconsulting.com` only). Cloud Functions exist only for work that *cannot* run in the browser — Google Calendar service-account API calls, Gmail send via meetings@, migration scripts.

No `api/meetings/` folder. Vercel functions are gone. Backend = Firebase Functions only.

**Frontend stack:** Vite + React 18 + MUI + Emotion + React Router v6. Drop Redux Toolkit. Drop Formik + Yup (use react-hook-form or plain `useState`). Keep MUI X, ApexCharts, Lucide React, date-fns, `@uidotdev/usehooks`.

**CORS:** every Firebase HTTPS Function must allow `https://*.vercel.app` and the eventual production domain.

---

## 4. Data Model (Firestore)

**AMENDED 2026-05-27** — original §4 below has been superseded by the actual shipped V1 model. Diffs from the 2026-05-12 original are called out inline.

```
firestore/
├── users/{uid}                          [V1]  uid = Firebase Auth UID
│     firstName, lastName, email, displayName, avatarColor,
│     role: 'admin' | 'member', active, joinedAt
│
├── organizations/{orgSlug}              [V1]  slug = 'vistamar', 'unio', 'bryn-mawr',
│     name,                                     'golden-vision', 'id-care'
│     type: 'internal' | 'client',
│     accentColor,
│     active, archived,
│     sortOrder,               ← AMENDED 2026-05-27: chip-row ordering
│     nextItemNumber,          ← AMENDED 2026-05-27: per-org sequential I-N counter
│     nextSubitemNumber,       ← AMENDED 2026-05-27: per-org SI-N counter
│     createdAt
│
├── items/{itemId}                       [V1]  unified projects + tasks
│     organizationId           ← the tag
│     parentId: string | null  ← null = top-level
│     hasChildren: bool        ← denormalized; client-side at write-time in V1
│                                (Cloud Function trigger when Blaze enables)
│     type: 'project' | 'task' ← derived
│     itemNumber: int          ← AMENDED 2026-05-27: per-org sequential; allocated
│                                via runTransaction off org doc counter
│     title, description
│     statusId: 1|2|4|5|6|7|8  ← AMENDED 2026-05-27: 8 = AI Gen (V3 placeholder);
│                                6 = Pending; 3 dropped (folded into onHold flag)
│     priorityId: 1|2|3|4 | null    ← AMENDED 2026-05-27: was missing
│     categoryId: string | null     ← AMENDED 2026-05-27: was missing; ref → /categories
│     tagIds: string[]               ← AMENDED 2026-05-27: was missing; refs → /tags
│     onHold: bool
│     dueDate: Timestamp | null
│     completedAt: Timestamp | null  ← AMENDED 2026-05-27: was missing
│     assigneeIds: uid[]             ← AMENDED 2026-05-27: was singular assigneeId; now
│                                      multi (multiple team members per item)
│     createdBy, createdAt, updatedAt
│     order: string             ← fractional rank (fractional-indexing library)
│   ├─ comments/{commentId}             [V1]
│   │     itemId,               ← AMENDED 2026-05-27: denormalized so collectionGroup
│   │                             queries can group locally for badge counts
│   │     authorId, body, parentCommentId: string | null, createdAt, updatedAt?
│   └─ files/{fileId}                   [V1] AMENDED 2026-05-27: NEW subcollection
│         itemId,               ← same denormalization
│         name, url,            ← URL-link only in V1 (Storage uploads when Blaze)
│         authorId, createdAt
│
├── categories/{categoryId}              [V1] AMENDED 2026-05-27: NEW top-level
│     name, color, sortOrder, createdAt
│     (Was originally per-org subcollections; promoted to global per 2026-05-27
│      decision — items reference by categoryId string, filter popovers reduce
│      to in-use values for the org-scoped view, row cell dropdowns show full
│      global list.)
│
├── tags/{tagId}                         [V1] AMENDED 2026-05-27: NEW top-level
│     name, color, createdAt
│     (Same global pattern as categories.)
│
├── calendar_series/{seriesId}           [V2]  AMENDED 2026-05-27: seriesId = Graph
│     organizationId,                          series eventId (not Google's)
│     title, recurrenceRule,
│     conferenceType: 'teams',           ← AMENDED 2026-05-27: was 'meet'
│     graphEventId,                      ← AMENDED 2026-05-27: marriage point with
│                                          Meeting Agendas + Graph for updates/
│                                          cancellations/attendee patches
│     googleEventId,                     ← AMENDED 2026-05-27: the Google ICS
│                                          mirror copy id
│     iCalUID,                           ← RFC 5545 stable
│     defaultAttendees: [{ email, displayName, memberId }],
│     googleCalendarId: 'meetings@vistamarconsulting.com'
│   └─ agendas/{agendaId}                [V2]
│         iCalUID, meetingDatetime: Timestamp, title, notes,
│         status: 'draft' | 'sent' | 'archived',
│         attendees: [{ email, displayName, memberId, responseStatus }]
│      └─ topics/{topicId}               [V2]
│            title, notes, order, ownerMemberId
│         └─ comments/{commentId}        [V2]  same shape as items/.../comments
│
└── _meta/                               [V1]
      schemaVersion, lastMigrationAt
```

**Storage:**
- `gs://management-db9eb.firebasestorage.app/items/{itemId}/{filename}` — task attachments (Blaze required)
- `gs://management-db9eb.firebasestorage.app/agendas/{agendaId}/{filename}` — meeting attachments (V2)

(Note bucket name uses new Firebase `.firebasestorage.app` scheme, not `.appspot.com` — original §4 was outdated.)

**Key denormalization decisions:**

- **`hasChildren`** on items — V1 maintained client-side at write time inside `runTransaction`. Cloud Function trigger lands at Blaze upgrade.
- **`itemNumber`** on items — per-org sequential N (I-1, I-2, ... / SI-1, SI-2, ...) allocated atomically via `runTransaction` against `organizations/{slug}.nextItemNumber` (or `nextSubitemNumber`). Stable across deletes — matches Console's `pm.Items.Item_Number`.
- **`itemId`** denormalized onto every comment + file doc — enables `collectionGroup("comments")` / `collectionGroup("files")` queries for per-row badge counts without N per-item subscriptions.
- **Attendees as array on agenda doc** (V2) — 5–15 per meeting, well under 1 MB.
- **Topics as subcollection** (V2) — they have their own threaded comments and can be long.
- **Members = `users/{uid}`** — no separate `members` collection. Firebase Auth UID is canonical. Task assignment stores `assigneeIds: uid[]` (multi-assignee). No denormalized names.
- **Organization always a real document.** Vistamar-internal is `organizations/vistamar`. Clients are `organizations/{slug}` with `type: 'client'`.
- **Categories + tags are global** (top-level collections), not per-org. Filter popovers reduce to in-use values within the org-scoped view; row dropdowns show full list. (Original §4 omitted these entirely.)

---

## 5. Auth + Security Rules

**Sign-in flow:**

1. Signed out → redirect to `/signin`
2. `/signin` shows "Continue with Google" button
3. `signInWithPopup(GoogleAuthProvider)` with `hd: 'vistamarconsulting.com'`
4. First sign-in triggers Cloud Function (`onCreate` auth trigger):
   - Verify email domain; if not `@vistamarconsulting.com`, delete auth user
   - Create `users/{uid}` with `active: true`, default `avatarColor`, role `member`
5. `AuthContext` exposes `{ user, signOut, isAdmin }`; subscribes to `users/{uid}` for live role/active updates
6. Sign-out: `firebase.auth().signOut()`. No localStorage to clear.

**Admin bootstrap:** first user (Andrew) gets `role: 'admin'` set manually in Firebase console after first sign-in. From there, admins promote others through Member Management.

**Firestore rules (V1 — full ruleset):**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null
          && request.auth.token.email.matches('.*@vistamarconsulting[.]com$')
          && request.auth.token.email_verified == true;
    }

    function isActiveUser() {
      return signedIn()
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.active == true;
    }

    function isAdmin() {
      return isActiveUser()
          && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    match /users/{uid} {
      allow read: if isActiveUser();
      allow create: if signedIn() && request.auth.uid == uid;
      allow update: if (isActiveUser() && request.auth.uid == uid
                        && !('role' in request.resource.data.diff(resource.data).affectedKeys()))
                     || isAdmin();
      allow delete: if isAdmin();
    }

    match /organizations/{orgId} {
      allow read: if isActiveUser();
      allow write: if isAdmin();
    }

    match /items/{itemId} {
      allow read, write: if isActiveUser();
      match /comments/{commentId} {
        allow read: if isActiveUser();
        allow create: if isActiveUser() && request.resource.data.authorId == request.auth.uid;
        allow update, delete: if isActiveUser() && resource.data.authorId == request.auth.uid;
      }
    }
  }
}
```

**Storage rules:**

```javascript
service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null
          && request.auth.token.email.matches('.*@vistamarconsulting[.]com$');
    }
    match /items/{itemId}/{filename} {
      allow read: if signedIn();
      allow write: if signedIn() && request.resource.size < 25 * 1024 * 1024;
    }
  }
}
```

Comment edit policy: **author-only**. Items themselves are any-active-user-write (3-person trust model).

---

## 6. Project Board V1 — UI Surface

**AMENDED 2026-05-27** — original §6 said "TaskBoard … columns by status" which led to a wrong kanban implementation in Slice 4. The shipped V1 is a Monday.com-style TABLE. See `docs/plans/2026-05-14-project-board-port.md` for the port brief.

**Pages (under `src/pages/`):**

- `SignIn.jsx` — Google Identity Services button (ID token → `signInWithCredential`). Domain-restricted to `@vistamarconsulting.com` via `AuthContext` guard + Firestore rules.
- `Dashboard.jsx` — placeholder. Mini Project Board lands in V2 alongside Agendas.
- `TaskBoard.jsx` — **Monday.com-style table** with three collapsible groups (Active / Completed / Archive), 14 columns, all CRUD inline. NOT a kanban.
- `KanbanBoard.jsx` — the original Slice-4 kanban grid, preserved at `/board/kanban` as a hidden URL-only alternate view. Not linked from the sidebar.
- `Members.jsx` — stub. Route still mounted at `/members` for the future Members admin page slice, but unlinked from the sidebar.
- `Organizations.jsx` — admin-only, nested under Settings in the sidebar. Currently read-only against live `useCollection('organizations')`; CRUD comes when needed.
- `Profile.jsx` — own user profile (read-only).
- `Settings.jsx` — stub page (route mounted; sidebar uses Settings only as an expandable parent group, not a navigable route).

**Project Board table columns (14):**
1. Expand chevron (also a click-to-toggle-all in the header)
2. Item (title — inline edit)
3. ID (`I-N` / `SI-N`, per-org sequential)
4. Priority (pill + dropdown)
5. Status (pill + dropdown — AI Gen / Assigned / In Progress / Pending / Review / Done / Archive)
6. Assigned (multi-assignee overlapping avatars + dropdown, `+N` overflow chip beyond 3)
7. Category (dot + text, click → dropdown with Add/Edit/Delete CRUD on column header)
8. Tags (stacked dot + text per tag, multi-select dropdown with Add/Edit/Delete CRUD)
9. Due (inline DatePicker — date text itself opens picker, no calendar icon)
10. Updated (relative time)
11. Created (date)
12. Notes (clickable icon with copper count badge; opens `TaskBoardModal`)
13. Files (clickable icon with copper count badge; opens `TaskBoardFilesModal`)
14. Action menu (vertical ellipsis: Add subtask, Delete with confirmation)

**Above the table:**
- "Project Board" heading + "New item" button (admin-only, disabled until an org filter is picked)
- **7 status scorecards** clickable as single-select filter: Assigned / In Progress / Review / On Hold / Done / Overdue / Due This Wk (Mon–Fri current business week)
- **Organization filter chip group** persisted via `useLocalStorage`. Sorted by `org.sortOrder`: All · Vistamar · Unio · Bryn Mawr · Golden Vision · ID Care.
- **Search bar** (standalone, below the chips) — matches title + description across both items and subtasks; same cascade as other filters.

**Filter cascade behavior** (all of column-filter + scorecard + search):
- Parents whose subtasks match are surfaced into view
- Matching parents auto-expand to show only the matching subtasks (sibling subtasks that don't match are hidden)
- Clears restore the full board

**Components shipped:**

- `MemberAvatar.jsx` — unified avatar (used in AppTopBar, Profile, assignee column, assignee dropdown). FL initials, near-black text on pastel `avatarColor`. Single + multi-overlap modes.
- `TaskBoardColumnHeader.jsx` — sort + filter Popover with search, checkboxes, edit/delete hover icons, "+ Add New" link.
- `TaskBoardRow.jsx` — full 14-cell row with inline edits + dropdowns + DnD-ready row scaffold.
- `TaskBoardModal.jsx` — Notes (threaded-ready, flat in V1) with author-only edit + delete.
- `TaskBoardFilesModal.jsx` — URL link attachments (file uploads when Blaze).
- `ColorPicker.jsx` — Free-form HSV + hex + curated preset palette. Used by category/tag dialogs.
- `Sidebar.jsx` — Dashboard / Task Board / Settings (collapsed group → Organizations + Profile when expanded).
- `AppTopBar.jsx` — route-derived title + admin chip + avatar dropdown menu.
- `ProtectedRoute.jsx` — loading spinner / unauth redirect / profile spinner / disabled-account screen / admin gate.

**Pastel Pill System** — `getPillBg(hex)` lightens 72% → background; `getTextColor(hex)` darkens 55% → text. Same hex stored on category / tag / priority / status; pill renders airy with readable dark text.

**Contexts:**

- `AuthContext` — replaces `LoginContext`; exposes `{ user, signOut, isAdmin }`
- `OrganizationFilterContext` — current Org filter (All / Vistamar / per-client); persists via `useLocalStorage`
- `QueryContext` — thin React Query wrapper for Firebase HTTPS Function calls only

**Data hooks (new, Firestore-native):**

- `useDoc(path)` — subscribes to a single Firestore doc, returns `{ data, loading, error }`
- `useCollection(path, queryConstraints)` — subscribes to a query, returns `{ data, loading, error }`
- `useUsers()`, `useOrganizations()`, `useItems(filters)`, `useItem(itemId)`, `useComments(itemId)` — thin wrappers over the above
- `useCreateItem`, `useUpdateItem`, `useDeleteItem`, `useReorderItem` — direct Firestore writes; optimistic updates supplied via Firestore's local cache

**Flow:**

1. Signed out → `/signin` → Google → `/dashboard`
2. Sidebar nav: Dashboard / Task Board / Members / Organizations / Settings
3. TaskBoard: top filter row (Organization chips: All • Vistamar • Total Vision • …; Status toggle; My Tasks toggle), columns Assigned / In Progress / Review / Done (Archive hidden behind a toggle)
4. Drag card between columns → write `statusId` + new `order` to Firestore → all clients see change in <1s via listener
5. Click card → open ItemDetail modal: title, description, assignee, due date, organization, status, subtasks, comments, attachments
6. Comments are threaded; only author can edit/delete their own
7. Attachments uploaded direct to Firebase Storage; reference stored on item doc

**Sidebar replaces** `dashboardItems.js` PM entries — no more Hugo-shaped Reports/SERP nav.

---

## 7. Meetings V2 — Sketch (not detailed; for shape only)

**Backend port:** `api/meetings/*` Vercel functions → `functions/src/meetings/*` Firebase Functions.

Survives the move (~60% of current code):
- `_lib/google-calendar.js` — service-account auth via GCP ADC (not DWD via Azure Key Vault); event create/update/delete; `events.move` for Tate migration
- `_lib/auth.js` — Firebase Auth token verification middleware
- Endpoint shapes: `create`, `cancel`, `list`, `rename`, `reschedule`, `attendees`, `send-prep`, `send-schedule`

Gets deleted:
- `_lib/graph-events.js`, `_lib/graph-mail.js`, `_lib/keyvault.js`
- M365 dual-system mirror logic everywhere
- Postmark relay (`_lib/relay-mail.js`)
- The "send invite + notify" header juggling
- Azure Key Vault dependency

Gets rewritten:
- `_lib/gmail-send.js` — Gmail API via meetings@ service-account (replaces Postmark + Graph sendMail)
- SQL writes → Firestore writes (Admin SDK)
- All endpoints become HTTPS callable Functions (auth context injected automatically)

**Calendar page** subscribes to `calendar_series` (filtered by Organization) + upcoming `agendas`. Drag/drop to reschedule calls a callable Function (because the Google Calendar mutation lives server-side).

**Send Meeting Invite button** (the explicit one from `project_explicit_send_invite_button`) calls a callable Function that:
1. Reads agenda + attendees from Firestore
2. Renders HTML invite body
3. Calls Gmail API to send from `meetings@vistamarconsulting.com`
4. Marks agenda `status: 'sent'` in Firestore (visible to all clients via listener)

**Tate migration:** one-shot script `functions/scripts/migrate-tate-meetings.js`, run during V2 cutover. Uses Google `events.move()` to transfer Tate's recurring series from his account to `meetings@`. Plan + template already exist in archived `dev/HANDOFF_2026-04-30_TATE_MIGRATION.md`.

---

## 8. Migration + Cutover + Dev System Port

### V1 data migration

Script: `functions/scripts/migrate-from-sql.js`

Reads (read-only) from the existing SQL Server `Console` DB and writes to the new Firestore. Scope:

- `con.Organizations` → `organizations/{slug}`. Slug from `Org_Name` (lowercased, hyphenated). Org_Id `-1` → `organizations/vistamar` with `type: 'internal'`.
- `pm.Members` (active only) → `users/{uid}` — but UIDs come from Firebase Auth, not SQL. **Two-step:** users sign in first to provision their UID, then the migration script matches by email and merges in SQL-side fields (avatar color, role hints). Or, simpler: skip member migration and let team members re-enter their preferences post-signin.
- `pm.Project_Items` (Status_Id != 7) → `items/{newId}`. Generate new IDs (Firestore auto-IDs). Map fields:
  - `Member_Id` (assignee) → resolve to `users/{uid}` by email lookup
  - `Org_Id` → resolve to `organizations/{slug}` by Org_Name lookup
  - `parentId` → resolved by matching SQL `Parent_Item_Id` to its mapped new ID (two-pass: first pass creates all items with `parentId: null`, second pass updates parents)
  - `Status_Id` → numeric, preserved
  - `Due_Date` → Firestore `Timestamp`
  - `order` → fractional rank generated from SQL ordering
- Subtasks captured in the same pass — they're just items with non-null `parentId`.

Skip: archived items (Status_Id 7), closed projects with no active subtasks, comments (V2 migration if anyone asks).

**Cutover:** when V1 ships, Andrew runs the migration script once. SQL Project Board edits are frozen at that moment. Team SOPs updated to point to Management URL. VMConsoleFrontEnd PM routes already gone (this session does it).

### V2 cutover (later)

Same shape, additional collections (`calendar_series`, `agendas`, `topics`). Plus Tate migration runs at the same time.

### Dev system port

Copy to VMManagementFrontEnd, then audit:

**feature_memory KEEP (port to new repo):**
Project_Board, Mini_Project_Board, Meeting_Agendas, Meeting_Agendas_Board_View, Member_Management, Calendar_Agenda_Sync, Agenda_Action_Bar, Agenda_Detail_View, Avatar_Color_System, Pastel_Pill_System, Topic_Cards, Threaded_Comments, Task_File_Links, Meeting_Prep_Email, Meetings_API, Monday_com_SOP_Analysis, Feature_Memory_System

**feature_memory DROP from both repos:** none — feature_memory in Console stays for Console-specific entries (API_Explorer_Page, GBP_Status_Badges, Guide_Page, Shared_SERP_Filters, Site_Architecture_Page, Version_Log_Page). They never move.

**REWRITE in new repo:**
- `site-architecture.json` — start clean; PM-only entries
- CLAUDE.md — Management-flavored
- `/api-add-plan` slash command — Firestore-shaped (not SQL-shaped); or replace with `/firestore-schema-add`

**RESET in new repo:**
- `dev/SESSION_INDEX.json` — empty
- `dev/sessions/` — empty
- `dev/HANDOFF_*.md` — none
- `dev/DEFERRED.md` — empty
- `dev/version_logs/` — empty (start fresh at v0.1.0)

**DELETE from new repo (carried over and then removed):**
- `dev/phase0-google-scope.mjs` — re-create when V2 starts, scoped for Firebase Functions
- `dev/probe-graph-*.mjs` — Graph is gone
- Any probe scripts that hit Hugo's API

**PORT:**
- `dev_onboarding/` — Management-flavored version

### Archive of PM artifacts from VMConsoleFrontEnd

Local archive: `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`

Contains a verbatim copy of everything removed from VMConsoleFrontEnd in this session, so the Firebase rebuild can reference the working PM UI code without git archaeology. Outside any git repo. Includes manifest.

---

## 9. Repo Bootstrap Sequence (this session, ~1 hour)

1. Write this spec into `VMConsoleFrontEnd/docs/superpowers/specs/`.
2. Create archive directory `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/` and copy all PM artifacts (source + dev/ + api/ + configs).
3. Create `~/Vistamar_Consulting/VMManagementFrontEnd/` with:
   - Fresh `.git` (verified `git rev-parse --show-toplevel` matches the project dir)
   - Minimal Vite + React 18 + SWC scaffold
   - `package.json` (no deps installed yet)
   - `CLAUDE.md` — Management-flavored
   - `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` — copy of this spec
   - Empty `dev/` skeleton, empty `site-architecture.json`
   - `.gitignore`, `.env.example`, `README.md`
4. Strip PM from `VMConsoleFrontEnd`:
   - Delete PM pages, hooks, helpers, contexts
   - Delete `api/meetings/` entirely
   - Delete `meetings-api-dev-server.mjs`
   - Strip PM routes from `src/routes.jsx`
   - Strip PM sidebar items from `dashboardItems.js`
   - Strip PM entries from `site-architecture.json`
   - Strip Meeting Scheduler section from CLAUDE.md
   - Remove `googleapis` from `package.json`
   - Strip `/api/meetings/*` rewrite from `vercel.json`
   - Delete PM feature_memory files
   - Move PM session folders + HANDOFFs to archive
5. Build `VMConsoleFrontEnd` (`npm run build`) — must complete clean.
6. Update `dev/sessions/.../context.md` for this spinout work (new session).
7. Commit + push `VMConsoleFrontEnd` to `origin/dev`.

V1 implementation begins in a separate session in the new repo.

---

## 10. Open Items Deferred to V1 Kickoff

- Firebase project creation (`vm-management` — Andrew creates via console)
- GCP service-account for meetings@ — already exists, will be reused; secrets move to GCP Secret Manager
- Vercel project creation for new repo
- Domain choice for production (vm-management.vercel.app initially)
- npm dep install on `VMManagementFrontEnd` (`react`, `react-dom`, `firebase`, `@mui/material`, `@emotion/*`, `react-router-dom@6`, `@tanstack/react-query`, `date-fns`, `@uidotdev/usehooks`, `lucide-react`, `fractional-indexing`)
- Theme port (MUI theme, palette, typography from Console — minus the Guide editorial cream/copper which doesn't apply here)

---

*End of spec.*
