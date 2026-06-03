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
- **Load-bearing invariant:** binding *two* ProseMirror editors to one `Y.XmlFragment` *simultaneously* causes a documented awareness/cursor loop (yjs/y-prosemirror #85, tiptap #5271). We avoid it because the view toggle at `AgendaDetail.jsx:1782` is a `viewMode === "overview" ? (…) : (…)` **ternary that conditionally renders (unmounts)** the other view — so only ONE editor instance is ever live on a given fragment at a time. This must stay an unmount (never a CSS hide-both), and the collaboration-caret/awareness extension attaches only to the currently-mounted instance. Document this in code comments; cover it with the toggle-stress test in §6.
- Sync Meeting destroy-recreates topics → new doc ids → new fragment keys → each new topic auto-seeds fresh (orphaned old fragments are harmless room storage; negligible for a 5-person team).

### 3.2 Canonical mirror (Firestore stays the source of record)
The live source for the *editing experience* is the Y.Doc (persisted by Liveblocks). Firestore `topics/{id}.bodyHtml` / `agenda.openFloorHtml` remain the **canonical mirror** so AI Gen (`assembleGenInputs`/`prepare`), `composeAgendaHtml`, Overview's `RichBodyView`, and export keep working **unchanged**.
- The collab editor writes `editor.getHTML()` → the existing Firestore `updateDoc` path (the current `onChangeHtml` handlers at `AgendaDetail.jsx:455-466`, `1423-1433`, `504-515` are reused verbatim), debounced.
- **Mirror on LOCAL edits only.** TipTap's `onUpdate` fires for remote Yjs changes too; writing on remote changes would make all N clients write the same HTML repeatedly. `onUpdate` hands a **ProseMirror** transaction (which has NO `.local` field — that's a Yjs `Transaction` property, a different object). The correct test: y-prosemirror tags transactions it applies *from a remote Yjs update* with meta under `ySyncPluginKey` carrying `{ isChangeOrigin: true }`. So mirror to Firestore **only when** `transaction.getMeta(ySyncPluginKey)?.isChangeOrigin` is falsy (a genuine local edit). Import `ySyncPluginKey` from `y-prosemirror`. (Undo/redo also carries `isUndoRedoOperation`; mirroring on undo is harmless since state converges.) Result: exactly one client (the editor) writes each change; all clients converge so the HTML is identical regardless.
- **Operational consequence (document in code + the explainer):** once collab is live, an existing topic's body must be edited *through the app*. A raw out-of-band Firestore write to an existing topic's `bodyHtml` will NOT appear in the live Y.Doc (the fragment is already initialized) and will be overwritten by the next local mirror. Sync Meeting is unaffected (it creates new topic docs → new fragments).

### 3.3 Seeding (race-free)
A fragment must be seeded from Firestore `bodyHtml` the first time a topic with existing content is opened (Sync-Meeting-created or migrated topics). Brand-new manual topics start empty (no seed). To avoid two simultaneous openers double-seeding:
- Guard with a **Firestore transaction** on a new `topics/{id}.collabSeeded` boolean (and `agenda.openFloorCollabSeeded`). The client that wins the transaction seeds; losers skip and receive the content via Yjs sync (sub-second). The Firestore transaction genuinely serializes the decision across simultaneous clients — no double-seed.
- **The flag is necessary but not sufficient by itself** — combine it with a write-time empty-fragment check: only seed when `ydoc.get(fragmentKey, Y.XmlFragment).length === 0` AND the field has non-empty `bodyHtml` AND this client won the `collabSeeded` transaction AND the provider has reported `synced`. Seed via `editor.commands.setContent(html, false)` (documented here as the seed mechanism; it runs only on the empty-fragment + flag-winner path, so it initializes rather than races). Empty body → nothing to seed.
- (A Liveblocks-native alternative — gating on a room `useStorage`/LiveObject flag instead of a Firestore round-trip — keeps the decision co-located with the doc and avoids cross-service latency; the Firestore approach is chosen for reusing existing infra. Either is acceptable.)

### 3.4 Auth
New Vercel function **`api/liveblocks-auth.js`**:
- `import { applyCors } from "../meetings/_lib/cors.js"` and `import { requireAuth } from "../meetings/_lib/auth.js"` (same helpers `api/ai/*` use). `applyCors` first; then `await requireAuth(req,res)` (Firebase ID token via `X-User-Token` + `@vistamarconsulting.com` + verified-email gate). `req.authUser` = `{uid,email,displayName}`.
- **Identity source:** `requireAuth` does NOT use firebase-admin (it verifies the token via the identitytoolkit REST `accounts:lookup`; no Firestore handle, no `avatarColor`). So there is NO server-side Firestore read here. Instead, the **client POSTs its own `displayName` + `avatarColor`** (from `useAuth().profile`) in the request body; the server uses them for `userInfo` only AFTER the `@vistamar` gate passes (the values are display-only presence labels, not a trust boundary). Use `req.authUser.uid` as the Liveblocks user id.
- `new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY })` → `liveblocks.prepareSession(uid, { userInfo: { name: <displayName from body, fallback req.authUser.displayName>, color: <avatarColor from body> } })` → `session.allow("agenda:*", session.FULL_ACCESS)` → `const { body, status } = await session.authorize(); return res.status(status).send(body)`.
- **Secret:** `LIVEBLOCKS_SECRET_KEY` in Vercel env (Andy provides the `sk_...`). The client uses the **auth-endpoint** pattern (no public key needed), so the `@vistamar` gate is enforced server-side. (`cors.js` already allowlists the `X-User-Token` header.)

### 3.5 Client wiring
- `createClient({ authEndpoint })` where `authEndpoint` is a function that attaches the Firebase token + the user's display identity: `token = await auth.currentUser.getIdToken()`; `profile = useAuth().profile` (read at call time); → `fetch("/api/liveblocks-auth", { method:"POST", headers:{ "Content-Type":"application/json", "X-User-Token": token }, body: JSON.stringify({ room, name: profile.displayName, avatarColor: profile.avatarColor }) })` → returns the Liveblocks token JSON.
- `@liveblocks/react` `createRoomContext(client)` → `RoomProvider`, `useRoom`, `useOthers`, `useSelf`.
- `@liveblocks/yjs`: get the room's Yjs provider via **`getYjsProviderForRoom(room)`** → `provider.getYDoc()` (the shared `Y.Doc`) + `provider.awareness`. (Use this, NOT the legacy `new LiveblocksYjsProvider(...)`, which Liveblocks discourages for room-switching/cleanup reasons; `getYjsProviderForRoom` auto-cleans on room destroy.)
- **`RoomProvider` placement:** wrap the view-mode conditional in `AgendaDetail.jsx` (~line 1782) with `<RoomProvider id={`agenda:${agendaId}`} initialPresence={{}}>` so BOTH Overview and Working live in the room and presence persists across the view toggle. (The existing `EditorFocusProvider` at `:1786` stays Overview-only — unchanged.)

### 3.6 Collaborative editor component
Add a dedicated **`CollabBodyEditor`** (sibling of `RichBodyEditor`; keeps `RichBodyEditor` for the soon-to-be-removed Pre-Brief and any non-collab use). It reuses the existing `proseBase` styles, `EditorToolbar`/shared-toolbar focus mechanism, placeholder CSS, and `linkHelper`. Differences from `RichBodyEditor`:
- Extensions: `StarterKit.configure({ undoRedo: false, … })` — **`undoRedo: false`, NOT `history: false`.** StarterKit v3.23 bundles the `UndoRedo` extension (from `@tiptap/extensions`); the configure gate is `undoRedo` (verified in `@tiptap/starter-kit@3.23.6`). `history: false` is silently ignored → UndoRedo stays on → double-undo/cross-client undo desync. Collaboration brings its own history, so UndoRedo MUST be disabled here. (The single-user `RichBodyEditor` keeps UndoRedo on — correct, it has no Collaboration.)
- `Collaboration.configure({ document: ydoc, field: fragmentKey })` (binds to `ydoc.getXmlFragment(fragmentKey)`).
- `CollaborationCaret` from **`@tiptap/extension-collaboration-caret`** (v3 name, renamed from `-collaboration-cursor` — confirmed correct for v3), configured with `provider` (the `getYjsProviderForRoom` provider, whose `.awareness` it uses) and `user: { name: profile.displayName, color: profile.avatarColor }`.
- No `content` prop / no `valueHtml`-once load (Yjs is the source); seeding per §3.3.
- Keeps `mode` (`inline` for Working = own toolbar+border; `shared` for Overview = chromeless + `onFocus → setActiveEditor`).
- Keeps the debounced `onChangeHtml(getHTML())` mirror, **gated to local-origin updates** (§3.2), AND keeps `RichBodyEditor`'s **guarded unmount-flush** (flush a pending debounced save on unmount ONLY if one is pending — `RichBodyEditor.jsx:128-145` — so toggling views / unmounting a topic never writes spurious `<p></p>`). Per-editor debounce-timer cleanup remains; provider cleanup is automatic via `getYjsProviderForRoom`.
- `Placeholder` extension retained.

The three current collab consumers switch from `RichBodyEditor` to `CollabBodyEditor`, passing `fragmentKey` (topic.id or `"openFloor"`) instead of `valueHtml`:
- `OverviewTopic` topic body (`AgendaDetail.jsx:455`) — `mode="shared"`, `fragmentKey={topic.id}`
- `AgendaTopicCard` topic body (`:1423`) — `mode="inline"`, `fragmentKey={topic.id}`
- `OpenFloorSection` (`:504`) — `mode="shared"`, `fragmentKey="openFloor"`
Each keeps its existing `onChangeHtml` Firestore-mirror handler.

### 3.7 Presence — avatars + cursors
- **Avatars:** new `AgendaPresence` component using `useOthers()` + `useSelf()` → an avatar stack in the agenda header (near the Sync Meeting button, `AgendaDetail.jsx:~1745`). Each avatar uses `userInfo.name` + `userInfo.color`.
- **Cursors:** the collaboration-caret extension renders remote carets/selections inside each editor, labeled with `userInfo.name` in `userInfo.color`.
- **Identity field mapping:** `AuthContext` exposes `profile.{id, displayName, avatarColor}` — there is NO `profile.color`. Map `avatarColor → userInfo.color` (single source) and `displayName → userInfo.name` at the auth endpoint. Others see correct names/colors via `userInfo`; the local user's caret identity comes from `useAuth().profile` (also mapped `avatarColor → color`).

### 3.8 Sync Meeting integration
Both pieces live in/around `SyncMeetingDialog` (rendered inside the RoomProvider at `AgendaDetail.jsx:1961`, so it can use Liveblocks hooks):
- **Flush before generate:** the Sync Meeting button (`:1750`) must ensure pending live edits are mirrored to Firestore before `prepareMeeting` reads the `topics` prop (Firestore-derived). Add a lightweight **flush registry**: each `CollabBodyEditor` registers a `flush()` (force its debounced mirror to write now) via a small context; the Sync Meeting onClick calls `flushAll()` and awaits the writes, then opens the dialog. (Avoids a brittle fixed `wait` and guarantees the AI reads current content.)
- **Presence-aware apply warning:** in `SyncMeetingDialog`, before `applyUnified`, read `useOthers()`. If others are present, show a confirm: *"N other people are editing this agenda right now. Applying replaces all topics. Continue?"* Admin-only (Sync Meeting is already admin-gated); no hard block. On apply, the destroy-recreate propagates via `onSnapshot`; new topic docs → new fragments → seed from the regenerated `bodyHtml`; all clients see the new agenda live.

## 4. Packages
Add: `@liveblocks/client`, `@liveblocks/react`, `@liveblocks/yjs`, `@liveblocks/node` (server), `yjs`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret` (v3 — the caret/cursor extension; NOT the old `-collaboration-cursor`). All client-side except `@liveblocks/node`. (`y-prosemirror` is a transitive dep of `@tiptap/extension-collaboration`; `ySyncPluginKey` is imported from it for the local-origin mirror gate, §3.2.) Remember `undoRedo: false` in StarterKit for collab editors (§3.6).

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
  4. Reload a context → content persists (from Liveblocks/Firestore); no duplication (seed guard). Open a brand-new Sync-Meeting-created topic from two contexts near-simultaneously → no double-seed.
  4b. **Toggle-stress:** while context 2 is actively editing a topic, rapidly toggle Overview↔Working in context 1 → no cursor flicker / awareness storm / duplicate carets (validates the single-instance-per-fragment invariant, §3.1).
  5. Canonical mirror: after edits settle, Firestore `bodyHtml` matches; Overview `RichBodyView` (non-editor) renders it; AI Gen reads current content.
  6. Sync Meeting: with a second person present, Apply shows the presence warning; on apply, both clients see the regenerated agenda live; titles still sticky (prior slice) and board creates land.

## 7. Rollout
- Andy provisions the Liveblocks account + `sk_...`; add `LIVEBLOCKS_SECRET_KEY` to Vercel env.
- Additive — no data migration (bodyHtml already exists; `collabSeeded` defaults falsy → first open seeds).
- Deploy FE + the new auth function together; verify on Vercel prod per §6 (two contexts); push `origin/dev` + repoint the prod alias.
- This slice is the foundation for the queued **board-presence** slice (reuses the Liveblocks client + auth endpoint, presence only, no Yjs).
