# Live Collaborative Agenda Editing (Liveblocks + Yjs + TipTap)

- **Date:** 2026-06-02
- **Author:** Andrew (design w/ Claude)
- **Status:** Draft for review
- **Slice type:** Feature — agenda real-time collaboration (boards are a separate fast-follow slice)
- **Backlog:** #1

## 1. Problem & goal

Agenda topic bodies are edited single-user: `RichBodyEditor` loads its HTML once on mount, ignores external updates after that, and writes debounced full-HTML snapshots (last-write-wins). Two people on the same agenda don't see each other's edits and silently clobber each other. Vistamar edits agendas **live, together, in the meeting**.

**Goal:** true concurrent (Google-Docs-style) editing of agenda topic bodies + Open Floor — edits merge character-by-character across users in real time, with presence avatars and live cursors. Boards already sync via Firestore `onSnapshot`; board presence is a separate later slice and is **out of scope here**.

**Transport (decided):** **Liveblocks** (hosted CRDT; Yjs under the hood). Chosen over a self-hosted socket (no always-on server in our Vercel/Firebase model) and a DIY Firebase-native provider (far more engineering; cursors/avatars become real work). Liveblocks delivers presence + cursors nearly free.

## 2. Scope

**In:** topic bodies (both Overview and Working views) + Open Floor become collaborative; presence avatars in the agenda header; live cursors inside editors; a new `/api/liveblocks-auth` endpoint; Sync Meeting flush + presence-aware apply warning.

**Out:** Pre-Brief (being deprecated, backlog #4 — stays on the existing single-user `RichBodyEditor`); board / mini-board presence (next slice); comments/threads; offline editing; durable topic doc ids (unchanged — Sync Meeting still destroy-recreates, which gives a clean per-topic fragment reset by construction).

## 3. Architecture

### 3.1 Rooms, docs, fragments
- **One Liveblocks room per agenda:** `agenda:{agendaId}` (the agenda doc id is stable across Sync Meeting).
- **One shared `Y.Doc` per room**, supplied by the Liveblocks Yjs provider.
- **One Yjs `XmlFragment` per editable field**, keyed by Firestore id:
  - each topic body → fragment key = the topic's Firestore doc id (`topic.id`)
  - Open Floor → fragment key `openFloor`
- Because Overview and Working mount **separate** editor instances for the same topic (`AgendaDetail.jsx:455` shared-mode, `:1423` inline-mode), and both will bind to the **same fragment key** (`topic.id`), edits sync across views and across users through the one Y.Doc.
- Sync Meeting destroy-recreates topics → new doc ids → new fragment keys → each new topic auto-seeds fresh (orphaned old fragments are harmless room storage; negligible for a 5-person team).

### 3.2 Canonical mirror (Firestore stays the source of record)
The live source for the *editing experience* is the Y.Doc (persisted by Liveblocks). Firestore `topics/{id}.bodyHtml` / `agenda.openFloorHtml` remain the **canonical mirror** so AI Gen (`assembleGenInputs`/`prepare`), `composeAgendaHtml`, Overview's `RichBodyView`, and export keep working **unchanged**.
- The collab editor writes `editor.getHTML()` → the existing Firestore `updateDoc` path (the current `onChangeHtml` handlers at `AgendaDetail.jsx:455-466`, `1423-1433`, `504-515` are reused verbatim), debounced.
- **Mirror on LOCAL edits only.** TipTap's `onUpdate` fires for remote Yjs changes too; writing on remote changes would make all N clients write the same HTML repeatedly. The mirror must fire only when the local user originated the transaction (filter via the y-sync transaction meta / `transaction.local`). Result: exactly one client (the editor) writes each change; all clients converge so the HTML is identical regardless.
- **Operational consequence (document in code + the explainer):** once collab is live, an existing topic's body must be edited *through the app*. A raw out-of-band Firestore write to an existing topic's `bodyHtml` will NOT appear in the live Y.Doc (the fragment is already initialized) and will be overwritten by the next local mirror. Sync Meeting is unaffected (it creates new topic docs → new fragments).

### 3.3 Seeding (race-free)
A fragment must be seeded from Firestore `bodyHtml` the first time a topic with existing content is opened (Sync-Meeting-created or migrated topics). Brand-new manual topics start empty (no seed). To avoid two simultaneous openers double-seeding:
- Guard with a **Firestore transaction** on a new `topics/{id}.collabSeeded` boolean (and `agenda.openFloorCollabSeeded`). The client that wins the transaction seeds the Yjs fragment from `bodyHtml` via `editor.commands.setContent(html, false)` after the provider reports `synced`; losers skip seeding and receive the content via Yjs sync (sub-second). This serializes seeding through existing Firebase infra — no duplicate inserts.
- Seed only when the fragment is empty AND the field has non-empty `bodyHtml`. (Empty body → nothing to seed.)

### 3.4 Auth
New Vercel function **`api/liveblocks-auth.js`**:
- `import { applyCors } from "../meetings/_lib/cors.js"` and `import { requireAuth } from "../meetings/_lib/auth.js"` (same helpers `api/ai/*` use). `applyCors` first; then `await requireAuth(req,res)` (Firebase ID token via `X-User-Token` + `@vistamarconsulting.com` + verified-email gate). `req.authUser` = `{uid,email,displayName}`.
- Read `users/{uid}` (Firebase Admin, already initialized by the auth helper) for `displayName` + `avatarColor`.
- `new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY })` → `liveblocks.prepareSession(uid, { userInfo: { name, color, avatarColor } })` → `session.allow("agenda:*", session.FULL_ACCESS)` → return `await session.authorize()`.
- **Secret:** `LIVEBLOCKS_SECRET_KEY` in Vercel env (Andy provides the `sk_...`). The client uses the **auth-endpoint** pattern (no public key needed), so the `@vistamar` gate is enforced server-side.

### 3.5 Client wiring
- `createClient({ authEndpoint })` where `authEndpoint` is a function that attaches the Firebase token: `await auth.currentUser.getIdToken()` → `fetch("/api/liveblocks-auth", { method:"POST", headers:{ "X-User-Token": token }, body: JSON.stringify({ room }) })` → returns the Liveblocks token JSON.
- `@liveblocks/react` `createRoomContext(client)` → `RoomProvider`, `useRoom`, `useOthers`, `useSelf`.
- `@liveblocks/yjs` provider bound to the room → the shared `Y.Doc` + awareness.
- **`RoomProvider` placement:** wrap the view-mode conditional in `AgendaDetail.jsx` (~line 1782) with `<RoomProvider id={`agenda:${agendaId}`} initialPresence={{}}>` so BOTH Overview and Working live in the room and presence persists across the view toggle. (The existing `EditorFocusProvider` at `:1786` stays Overview-only — unchanged.)

### 3.6 Collaborative editor component
Add a dedicated **`CollabBodyEditor`** (sibling of `RichBodyEditor`; keeps `RichBodyEditor` for the soon-to-be-removed Pre-Brief and any non-collab use). It reuses the existing `proseBase` styles, `EditorToolbar`/shared-toolbar focus mechanism, placeholder CSS, and `linkHelper`. Differences from `RichBodyEditor`:
- Extensions: `StarterKit.configure({ history: false, … })` (Yjs supplies undo) + `Collaboration.configure({ document: ydoc, field: fragmentKey })` + the v3 collaboration-cursor extension configured with the Liveblocks Yjs awareness + the current user's `{ name, color }`. **Verify the exact TipTap v3 package name** — in v3 the cursor extension is `@tiptap/extension-collaboration-caret` (renamed from `-collaboration-cursor`); confirm against installed `@tiptap/*@3.23.x` and use whichever resolves.
- No `content` prop / no `valueHtml`-once load (Yjs is the source); seeding per §3.3.
- Keeps `mode` (`inline` for Working = own toolbar+border; `shared` for Overview = chromeless + `onFocus → setActiveEditor`).
- Keeps the debounced `onChangeHtml(getHTML())` mirror, **gated to local-origin updates** (§3.2).
- `Placeholder` extension retained.

The three current collab consumers switch from `RichBodyEditor` to `CollabBodyEditor`, passing `fragmentKey` (topic.id or `"openFloor"`) instead of `valueHtml`:
- `OverviewTopic` topic body (`AgendaDetail.jsx:455`) — `mode="shared"`, `fragmentKey={topic.id}`
- `AgendaTopicCard` topic body (`:1423`) — `mode="inline"`, `fragmentKey={topic.id}`
- `OpenFloorSection` (`:504`) — `mode="shared"`, `fragmentKey="openFloor"`
Each keeps its existing `onChangeHtml` Firestore-mirror handler.

### 3.7 Presence — avatars + cursors
- **Avatars:** new `AgendaPresence` component using `useOthers()` + `useSelf()` → an avatar stack in the agenda header (near the Sync Meeting button, `AgendaDetail.jsx:~1745`). Each avatar uses `userInfo.name` + `avatarColor` (matching the app's existing `profile.avatarColor`).
- **Cursors:** the collaboration-caret extension renders remote carets/selections inside each editor, labeled with `userInfo.name` in `userInfo.color`.
- User identity flows from the auth endpoint's `userInfo` (so others see correct names/colors) and from `useAuth().profile` locally.

### 3.8 Sync Meeting integration
Both pieces live in/around `SyncMeetingDialog` (rendered inside the RoomProvider at `AgendaDetail.jsx:1961`, so it can use Liveblocks hooks):
- **Flush before generate:** the Sync Meeting button (`:1750`) must ensure pending live edits are mirrored to Firestore before `prepareMeeting` reads the `topics` prop (Firestore-derived). Add a lightweight **flush registry**: each `CollabBodyEditor` registers a `flush()` (force its debounced mirror to write now) via a small context; the Sync Meeting onClick calls `flushAll()` and awaits the writes, then opens the dialog. (Avoids a brittle fixed `wait` and guarantees the AI reads current content.)
- **Presence-aware apply warning:** in `SyncMeetingDialog`, before `applyUnified`, read `useOthers()`. If others are present, show a confirm: *"N other people are editing this agenda right now. Applying replaces all topics. Continue?"* Admin-only (Sync Meeting is already admin-gated); no hard block. On apply, the destroy-recreate propagates via `onSnapshot`; new topic docs → new fragments → seed from the regenerated `bodyHtml`; all clients see the new agenda live.

## 4. Packages
Add: `@liveblocks/client`, `@liveblocks/react`, `@liveblocks/yjs`, `@liveblocks/node` (server), `yjs`, `@tiptap/extension-collaboration`, and the v3 collaboration-caret extension (verify exact name §3.6). All client-side except `@liveblocks/node`.

## 5. Failure modes & mitigations
- **Liveblocks unreachable / auth fails:** the editor should degrade to read-only-ish rather than crash the agenda page; surface a non-blocking "reconnecting" state. (Liveblocks reconnects automatically.) The Firestore mirror means no data is lost on the canonical side.
- **Seed race:** handled by the Firestore `collabSeeded` transaction (§3.3).
- **Write storm:** handled by local-origin mirror gating (§3.2).
- **Stale out-of-band Firestore writes:** documented operational constraint (§3.2); Sync Meeting (the main writer) is safe by construction.
- **Free-tier limits:** Liveblocks Starter MAU limit far exceeds 5 internal users; note in the explainer.

## 6. Testing
- **Unit:** any pure helper extracted (e.g. a `fragmentKey(topic)` or the local-origin predicate) gets a vitest. Most of this slice is integration (Liveblocks + Firestore + DOM) verified live.
- **Manual / prod (Vercel, UI hard gate) — requires TWO authed browser contexts:**
  1. Open the same agenda in two contexts; type in topic A in context 1 → appears live in context 2 (both Overview and Working).
  2. Concurrent edit of the SAME topic body from both → character-level merge, no clobber.
  3. Presence: both contexts show each other's avatar; cursors/carets appear with correct names/colors.
  4. Reload a context → content persists (from Liveblocks/Firestore); no duplication (seed guard).
  5. Canonical mirror: after edits settle, Firestore `bodyHtml` matches; Overview `RichBodyView` (non-editor) renders it; AI Gen reads current content.
  6. Sync Meeting: with a second person present, Apply shows the presence warning; on apply, both clients see the regenerated agenda live; titles still sticky (prior slice) and board creates land.

## 7. Rollout
- Andy provisions the Liveblocks account + `sk_...`; add `LIVEBLOCKS_SECRET_KEY` to Vercel env.
- Additive — no data migration (bodyHtml already exists; `collabSeeded` defaults falsy → first open seeds).
- Deploy FE + the new auth function together; verify on Vercel prod per §6 (two contexts); push `origin/dev` + repoint the prod alias.
- This slice is the foundation for the queued **board-presence** slice (reuses the Liveblocks client + auth endpoint, presence only, no Yjs).
