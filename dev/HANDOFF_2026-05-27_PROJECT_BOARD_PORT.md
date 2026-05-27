# HANDOFF — 2026-05-27 — Project Board (Monday-style table) port

Written at session close. The next Claude session in this repo picks up the **Project Board table port**, which is the highest-priority unfinished V1 work.

## TL;DR for the next session

1. **Read `docs/plans/2026-05-14-project-board-port.md` end-to-end.** It is the 640-line approved implementation brief for this work. Authoritative over spec §6 phrasing where they conflict (the spec called the Project Board "TaskBoard" loosely; in reality it's a Monday.com-style table, not the Kanban that currently lives at `/board`).
2. **Read the PM archive at `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`** for the source TaskBoard / TaskBoardRow / TaskBoardColumnHeader / TaskBoardModal — that's the canonical UI to port.
3. **Don't delete the current Kanban.** Rename `src/pages/TaskBoard.jsx` → `src/pages/KanbanBoard.jsx` and `src/components/ItemCard.jsx` → `src/components/KanbanCard.jsx`, mount the Kanban at `/board/kanban` (NOT linked in sidebar). The new table replaces the Kanban at `/board`.
4. **A V2 Meetings spec sits at `docs/superpowers/specs/2026-05-20-meetings-v2-design.md`.** V2 Meetings work is happening in a **separate Claude Code session** in this same repo folder. **Do not touch V2 files** unless the developer explicitly asks. Stay in the V1 lane.

## Live state at handoff (2026-05-27)

### Dev server

- `http://localhost:5173` is **already running**, owned by the other CC session (PID 88364 at handoff time).
- **DO NOT kill it** — CLAUDE.md hard rule. If you need a separate dev server for verification, use `npx vite --port 5174` or coordinate with the developer first.

### Git

- Branch: `main` (local) tracked against `origin/dev` (remote). Push workflow: `git push origin main:dev`.
- Last commit: see `git log --oneline -10` — slices 1 → 4 all committed.
- Untracked / uncommitted at handoff time **were committed as part of this handoff** (see commit message).

### Firestore (`management-db9eb`)

- `users/P63r1qyS0vOQ4BovyRit6EwI5sk2` — Andy, `role: 'admin'`, `active: true`, `avatarColor: '#ffaaa5'`. Live.
- `organizations/vistamar` — `name: 'Vistamar Consulting'`, `type: 'internal'`, `accentColor: '#2c5f7c'`. Live.
- `items/*` — 11 seeded sample items, all `parentId: null`, all `organizationId: 'vistamar'`, assigned to Andy. Status distribution: Assigned ×3 / In Progress ×3 / Review ×2 / Done ×3. Seeded by `src/seed/sampleItems.js` (idempotent via `_seedMarker`).

### Firebase

- Firestore rules deployed 2026-05-14 per spec §5 (with three documented deviations in `firestore.rules` header — required by client-side bootstrap on Spark plan).
- Storage rules **not** deployed — Firebase reclassified Storage as Blaze-only in late 2025; deferred until Blaze upgrade or until we actually need attachments.
- Auth: Google provider enabled, restricted via `hd: vistamarconsulting.com` hint at signin time.
- Cloud Functions: **none** — Spark plan. `users/{uid}` doc creation is client-side in `AuthContext` until Blaze.

## What's done (don't rebuild)

Foundation, all working and verified:

- `src/firebase.js`, `src/contexts/AuthContext.jsx` (Google SSO + client-side user-doc bootstrap)
- `src/hooks/{useDoc,useCollection,useItems}.js`
- `src/theme/*` (ported from Console, minus Guide cream/copper)
- `src/routes.jsx` with `<ProtectedRoute requireAdmin>`
- `src/components/{Sidebar,AppTopBar,ProtectedRoute}.jsx`
- `src/layouts/SignedInLayout.jsx`
- `src/constants/itemStatuses.js`
- `src/seed/sampleItems.js`
- `firestore.rules`, `firebase.json`, `.firebaserc`, `firestore.indexes.json`, `storage.rules`
- Page stubs for Members, Organizations, Settings, Profile, Dashboard

The current `/board` route renders a **Kanban** with 11 live items — read-only proof that the data layer works. It is the wrong layout; the next slice replaces it.

## What's NOT done

- **The Project Board table itself.** This is the entire next slice. Plan: `docs/plans/2026-05-14-project-board-port.md`.
- All Project Board interactivity: inline edit, drag-and-drop reorder via `fractional-indexing`, status/priority pill dropdowns, multi-assignee, subitems (expand/collapse), threaded comments, status scorecards, organization filter chips, action menus, item create/delete.
- Members admin page (promote/demote/deactivate UI — stub only)
- Organizations admin page (CRUD UI — already wired to live `useCollection('organizations')` but no edit forms)
- Mini Project Board (Dashboard) — **V2 only**, defer
- Task File Links — **deferred to Blaze upgrade**
- Migration script from SQL — fresh-start V1, only build later if needed
- GitHub repo (does not exist — see `docs/plans/2026-05-14-project-board-port.md` §"Operational Setup")
- Vercel project (does not exist — same)

## Read order for the next session

1. `CLAUDE.md` (project root)
2. `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/context.md` (the BRAIN — has slice 1 → 4 history)
3. `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` (architecture, V1+V2+V3)
4. **`docs/plans/2026-05-14-project-board-port.md` (THE PLAN — read end-to-end)**
5. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/feature_memory/Project_Board.md` (why the table looks the way it does)
6. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoard.jsx` (1094 lines — the source)
7. `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/src/pages/pages/TaskBoardRow.jsx` (1069 lines — the row)

## Things to verify with the developer before coding

The 2026-05-14 plan brief itself lists 7 open questions at §"Open Questions to Confirm with Andy Before Coding." Don't start the port until those are answered.

## What did this session actually do (2026-05-27)?

Almost nothing functional. Sequence:

1. Andy returned from a 2-week gap, re-authenticated the Firebase CLI (`npx firebase login --reauth`).
2. He asked where the live app was and what was done.
3. I oriented on the repo state, drove the browser to `/board` via agent-browser, captured a screenshot of the current Kanban + 11 live Firestore items.
4. I summarized the done/not-done split honestly, including flagging that the current Kanban is the *wrong* layout per the 5/14 plan brief.
5. He chose to close the session and continue Project Board work in a separate Claude session. This handoff is the wrap.

No production code touched. Only this handoff doc, the context.md exit note, and the commit of the three loose files (`.gitignore` `.vercel` entry, the 5/14 plan brief, the 5/20 V2 spec).
