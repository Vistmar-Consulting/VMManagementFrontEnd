# Live Collaborative Agenda Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agenda topic bodies + Open Floor truly collaborative (Google-Docs-style, real-time, with presence avatars + live cursors) via Liveblocks + Yjs + TipTap, while keeping Firestore `bodyHtml` as the canonical mirror.

**Architecture:** One Liveblocks room per agenda (`agenda:{agendaId}`); one shared Y.Doc; one Yjs `XmlFragment` per editable field keyed by Firestore id (topic body → `topic.id`, Open Floor → `"openFloor"`). A new `CollabBodyEditor` (TipTap + `Collaboration` + `CollaborationCaret`, `undoRedo: false`) replaces the single-user editor at the topic-body and Open-Floor mount sites; Pre-Brief stays on the existing `RichBodyEditor` (it's being deprecated). The editor mirrors `getHTML()` → Firestore on local-origin edits only, so AI Gen / Overview render / export keep working unchanged. A `/api/liveblocks-auth` endpoint reuses the existing `@vistamar` `requireAuth` gate.

**Tech Stack:** React 18 + MUI, Vite, Firebase Web SDK 11, Vercel serverless, TipTap v3.23, Liveblocks (`@liveblocks/client|react|yjs|node`), Yjs, `y-prosemirror`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-agenda-live-collaboration-design.md` (read it).

**Prerequisite (DONE by Andy):** `LIVEBLOCKS_SECRET_KEY` is set in Vercel env (Production + Preview).

---

## File Structure

- **Create** `api/liveblocks-auth.js` — server auth endpoint (mints Liveblocks session, `@vistamar`-gated).
- **Create** `src/lib/liveblocks.js` — Liveblocks client (authEndpoint) + room context exports.
- **Create** `src/components/editor/collabSync.js` — pure helper `isLocalEditTransaction` (+ vitest).
- **Create** `src/components/editor/CollabFlushRegistry.jsx` — context to force-flush pending editor mirrors before Sync Meeting.
- **Create** `src/components/editor/CollabBodyEditor.jsx` — the collaborative editor.
- **Create** `src/components/AgendaPresence.jsx` — avatar stack from Liveblocks presence.
- **Modify** `src/pages/AgendaDetail.jsx` — RoomProvider + FlushRegistry wrap; swap 3 editors; presence; flush on Sync Meeting open.
- **Modify** `src/components/SyncMeetingDialog.jsx` — presence-aware apply warning.
- **Modify** `package.json` — deps.
- **Check/maybe-modify** `firestore.rules` — allow new `collabSeeded` / `openFloorCollabSeeded` fields.

---

## Task 1: Install dependencies

**Files:** Modify `package.json` (+ lockfile).

- [ ] **Step 1: Install**

```bash
npm install @liveblocks/client @liveblocks/react @liveblocks/yjs @liveblocks/node yjs @tiptap/extension-collaboration @tiptap/extension-collaboration-caret
```

- [ ] **Step 2: Verify the caret package resolved**

Run: `node -e "require.resolve('@tiptap/extension-collaboration-caret'); require.resolve('@tiptap/extension-collaboration'); console.log('ok')"`
Expected: `ok`. If `-collaboration-caret` does NOT exist for the installed TipTap line, check the installed `@tiptap/*` major (`npm ls @tiptap/react`) and use the matching caret/cursor package (v3 = `-collaboration-caret`). Also confirm `y-prosemirror` is present (transitive of `@tiptap/extension-collaboration`): `node -e "require.resolve('y-prosemirror'); console.log('y-prosemirror ok')"` — if not, `npm install y-prosemirror`.

- [ ] **Step 3: Build sanity**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(collab): add Liveblocks + Yjs + TipTap collaboration deps"
```

---

## Task 2: `collabSync.js` pure helper (TDD)

**Files:** Create `src/components/editor/collabSync.js`; Test `src/components/editor/__tests__/collabSync.test.js`.

- [ ] **Step 1: Write the failing test**

`src/components/editor/__tests__/collabSync.test.js`:
```js
import { describe, it, expect } from "vitest";
import { ySyncPluginKey } from "y-prosemirror";
import { isLocalEditTransaction } from "../collabSync.js";

// y-prosemirror tags transactions it applies from a REMOTE Yjs update with
// { isChangeOrigin: true } under ySyncPluginKey. A local user edit has no such tag.
const tr = (syncMeta) => ({ getMeta: (k) => (k === ySyncPluginKey ? syncMeta : undefined) });

describe("isLocalEditTransaction", () => {
  it("local edit (no y-sync meta) → true", () => {
    expect(isLocalEditTransaction(tr(undefined))).toBe(true);
  });
  it("remote edit (isChangeOrigin true) → false", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: true }))).toBe(false);
  });
  it("y-sync meta present but not a change-origin → true", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: false }))).toBe(true);
  });
  it("malformed transaction (no getMeta) → true (treat as local, fail safe to mirror)", () => {
    expect(isLocalEditTransaction({})).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/components/editor/__tests__/collabSync.test.js`
Expected: FAIL (`isLocalEditTransaction is not a function`).

- [ ] **Step 3: Implement**

`src/components/editor/collabSync.js`:
```js
import { ySyncPluginKey } from "y-prosemirror";

// TipTap's onUpdate hands a ProseMirror transaction. y-prosemirror tags any
// transaction it applies from a REMOTE Yjs update with { isChangeOrigin: true }
// under ySyncPluginKey. Return true only for genuine LOCAL user edits, so the
// Firestore mirror writes once (from the originating client) instead of N times.
export function isLocalEditTransaction(transaction) {
  const meta = transaction?.getMeta?.(ySyncPluginKey);
  return !meta?.isChangeOrigin;
}
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run src/components/editor/__tests__/collabSync.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/collabSync.js src/components/editor/__tests__/collabSync.test.js
git commit -m "feat(collab): isLocalEditTransaction helper (local-origin mirror gate)"
```

---

## Task 3: `api/liveblocks-auth.js` endpoint

**Files:** Create `api/liveblocks-auth.js`. (No unit test; verified on prod in Task 10.)

- [ ] **Step 1: Confirm the auth helper shape**

Read `api/meetings/_lib/cors.js` and `api/meetings/_lib/auth.js`. Confirm `applyCors(req,res)` returns truthy on a handled preflight, and `await requireAuth(req,res)` returns truthy on success and attaches `req.authUser = { uid, email, displayName }`. (It verifies the Firebase ID token from `X-User-Token` via the identitytoolkit REST endpoint — NO firebase-admin, NO Firestore handle. So identity for presence comes from the request body, not a server read.)

- [ ] **Step 2: Write the endpoint**

`api/liveblocks-auth.js`:
```js
import { Liveblocks } from "@liveblocks/node";
import { applyCors } from "./meetings/_lib/cors.js";
import { requireAuth } from "./meetings/_lib/auth.js";

const liveblocks = new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY });

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return res.status(500).json({ error: "LIVEBLOCKS_SECRET_KEY not configured" });
  }
  if (!(await requireAuth(req, res))) return; // sends its own 401/403

  const { uid, displayName, email } = req.authUser;
  // Display identity for OTHERS' presence comes from the client (post-gate, display-only).
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(body.name || displayName || email || "User");
  const color = String(body.avatarColor || "#888888");

  const session = liveblocks.prepareSession(uid, { userInfo: { name, color } });
  session.allow("agenda:*", session.FULL_ACCESS);
  const { status, body: authBody } = await session.authorize();
  return res.status(status).send(authBody);
}
```
Note: `prepareSession` requires Liveblocks "access tokens" enabled (default). `session.FULL_ACCESS` and the `"agenda:*"` wildcard scope all rooms named `agenda:…`.

- [ ] **Step 3: Build sanity**

Run: `npm run build` (api/ isn't bundled, but this catches syntax/import errors elsewhere). Expected: success.

- [ ] **Step 4: Commit**

```bash
git add api/liveblocks-auth.js
git commit -m "feat(collab): /api/liveblocks-auth — @vistamar-gated Liveblocks session"
```

---

## Task 4: `src/lib/liveblocks.js` client + room context

**Files:** Create `src/lib/liveblocks.js`.

- [ ] **Step 1: Write it**

`src/lib/liveblocks.js`:
```js
import { createClient } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

// authEndpoint is a plain function (not a hook): it reads the current Firebase
// user for the token + the users/{uid} doc for display identity, then calls our
// gated /api/liveblocks-auth. Others see this user's name/color via the token.
const client = createClient({
  authEndpoint: async (room) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    const token = await user.getIdToken();

    let name = user.displayName || user.email || "User";
    let avatarColor = "#888888";
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        name = d.displayName || name;
        avatarColor = d.avatarColor || avatarColor;
      }
    } catch {
      // non-fatal — fall back to auth.currentUser values
    }

    const res = await fetch("/api/liveblocks-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Token": token },
      body: JSON.stringify({ room, name, avatarColor }),
    });
    if (!res.ok) throw new Error(`Liveblocks auth failed: ${res.status}`);
    return await res.json();
  },
});

export const { RoomProvider, useRoom, useOthers, useSelf } = createRoomContext(client);
```
**Version note:** if the installed `@liveblocks/react` has removed `createRoomContext` in favor of the global API, instead do: `export { useRoom, useOthers, useSelf } from "@liveblocks/react";` and export a `LiveblocksRoot` that renders `<LiveblocksProvider authEndpoint={...}>`, then wrap `RoomProvider` (from `@liveblocks/react`) under it in AgendaDetail. Check `npm ls @liveblocks/react` + the package's exports before choosing. Prefer `createRoomContext` if present (simplest).

- [ ] **Step 2: Build sanity**

Run: `npm run build`. Expected: success (module is unused so far — fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/liveblocks.js
git commit -m "feat(collab): Liveblocks client + room context (authEndpoint with Firebase token)"
```

---

## Task 5: `CollabFlushRegistry.jsx`

**Files:** Create `src/components/editor/CollabFlushRegistry.jsx`.

Purpose: each `CollabBodyEditor` registers a `flush()` (force its pending debounced mirror to write now). Sync Meeting calls `flushAll()` + awaits, so the AI reads current content.

- [ ] **Step 1: Write it**

`src/components/editor/CollabFlushRegistry.jsx`:
```js
import { createContext, useContext, useCallback, useRef, useMemo } from "react";

const FlushRegistryContext = createContext(null);

export function CollabFlushRegistryProvider({ children }) {
  const flushersRef = useRef(new Set());

  const register = useCallback((fn) => {
    flushersRef.current.add(fn);
    return () => flushersRef.current.delete(fn);
  }, []);

  // Call every registered flush; await any promises they return.
  const flushAll = useCallback(async () => {
    await Promise.all([...flushersRef.current].map((fn) => {
      try { return Promise.resolve(fn()); } catch { return Promise.resolve(); }
    }));
  }, []);

  const value = useMemo(() => ({ register, flushAll }), [register, flushAll]);
  return <FlushRegistryContext.Provider value={value}>{children}</FlushRegistryContext.Provider>;
}

// Returns { register, flushAll }. Safe no-op shape when outside a provider.
export function useCollabFlushRegistry() {
  return useContext(FlushRegistryContext) || { register: () => () => {}, flushAll: async () => {} };
}
```

- [ ] **Step 2: Build sanity**

Run: `npm run build`. Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/CollabFlushRegistry.jsx
git commit -m "feat(collab): flush registry context (force mirror before Sync Meeting)"
```

---

## Task 6: `CollabBodyEditor.jsx` — the collaborative editor

**Files:** Create `src/components/editor/CollabBodyEditor.jsx`. Reference the existing `src/components/editor/RichBodyEditor.jsx` for the `proseBase` styles, inline/shared rendering, placeholder CSS, toolbar, link handler, and the guarded unmount-flush — replicate those parts.

**Props:** `fragmentKey` (string), `valueHtml` (string, seed content), `seedDocPath` (string Firestore doc path holding the seed flag), `seedFlagField` (string), `onChangeHtml` (mirror callback), `placeholder`, `mode` ("inline" | "shared"), `debounceMs` (default 1500).

- [ ] **Step 1: Write the component**

Key requirements (mirror RichBodyEditor where noted):
- `useRoom()` → `getYjsProviderForRoom(room)` (memoized on room) → `yProvider.getYDoc()`.
- `useEditor` with: `immediatelyRender: false`; extensions:
  - `StarterKit.configure({ undoRedo: false, heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: { openOnClick:false, autolink:true, HTMLAttributes:{ rel:"noopener noreferrer", target:"_blank" } }, underline: {} })` — **`undoRedo: false` is mandatory** (Collaboration owns history; `history:false` is ignored in v3).
  - `Placeholder.configure({ placeholder })`
  - `Collaboration.configure({ document: ydoc, field: fragmentKey })`
  - `CollaborationCaret.configure({ provider: yProvider, user: { name: profile.displayName, color: profile.avatarColor } })` (from `useAuth().profile`).
  - **No `content`** (Yjs is the source).
- `onUpdate({ editor, transaction })`: if `isLocalEditTransaction(transaction)` (from `collabSync.js`), debounce → `onChangeHtmlRef.current(editor.getHTML())` (same debounced-mirror pattern as RichBodyEditor). Remote transactions do NOT schedule a write.
- `onFocus`: in shared mode, `focusRef.current?.setActiveEditor(ed)` (keep the EditorFocusContext integration so SharedEditorToolbar still works).
- **Seeding effect** (run once the provider has synced):
  ```js
  // After editor + yProvider exist:
  const seededRef = useRef(false);
  useEffect(() => {
    if (!editor) return undefined;
    let cancelled = false;
    const attemptSeed = async () => {
      if (seededRef.current || cancelled) return;
      const frag = ydoc.get(fragmentKey, Y.XmlFragment);
      if (frag.length > 0) { seededRef.current = true; return; }      // already has content
      if (!valueHtml) { seededRef.current = true; return; }            // nothing to seed
      try {
        const seedRef = doc(db, ...seedDocPath.split("/"));            // build DocumentReference from path
        const won = await runTransaction(db, async (tx) => {
          const snap = await tx.get(seedRef);
          if (snap.data()?.[seedFlagField]) return false;
          tx.update(seedRef, { [seedFlagField]: true });
          return true;
        });
        if (won && !cancelled && ydoc.get(fragmentKey, Y.XmlFragment).length === 0) {
          editor.commands.setContent(sanitizeHtml(valueHtml) || "", false); // sanitize for parity with RichBodyEditor
        }
      } catch {
        // best-effort; another client will have seeded
      } finally {
        seededRef.current = true;
      }
    };
    if (yProvider.synced) attemptSeed();
    const onSync = (isSynced) => { if (isSynced) attemptSeed(); };
    yProvider.on("sync", onSync);                                       // verify event name; some versions use "synced"
    return () => { cancelled = true; yProvider.off("sync", onSync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, yProvider, ydoc]);
  ```
  Imports: `import * as Y from "yjs"; import { doc, runTransaction } from "firebase/firestore"; import { db } from "../../firebase.js"; import { getYjsProviderForRoom } from "@liveblocks/yjs"; import { sanitizeHtml } from "../../lib/agendaHtml.js"; import { useRoom } from "../../lib/liveblocks.js"; import { isLocalEditTransaction } from "./collabSync.js"; import { useCollabFlushRegistry } from "./CollabFlushRegistry.jsx";` (plus the TipTap/MUI imports mirrored from RichBodyEditor, `Collaboration`, `CollaborationCaret`, and `useAuth` from the auth context).
  **Verify** the provider sync API against the installed `@liveblocks/yjs` (event name `"sync"` vs `"synced"`, and whether a `.synced`/`.isSynced` boolean exists). Use whichever the installed version exposes.
- **Guarded unmount-flush** (replicate `RichBodyEditor.jsx:128-145`): on unmount, if a debounced mirror is pending (`debounceRef.current` set), flush it (write current HTML) — ONLY if pending, so unmount/view-toggle never writes spurious `<p></p>`.
- **Flush registry:** `const { register } = useCollabFlushRegistry();` — register a `flush()` that, if a debounce is pending, clears the timer and writes immediately (returns the write promise). Unregister on unmount.
- Render: same as RichBodyEditor — shared mode = chromeless `<EditorContent>`; inline mode = bordered Box + `<EditorToolbar editor={editor} onLink={handleLink}/>` + `<EditorContent>`. Reuse `proseBase`. Add caret CSS if needed (CollaborationCaret injects its own cursor markup; add minimal styles for `.collaboration-cursor__caret` / `__label` so labels are legible — see TipTap caret docs).

- [ ] **Step 2: Build sanity**

Run: `npm run build`. Expected: success (component defined but not yet used).

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/CollabBodyEditor.jsx
git commit -m "feat(collab): CollabBodyEditor (TipTap+Yjs, seed guard, local-origin mirror, presence caret)"
```

---

## Task 7: `AgendaPresence.jsx` — avatar stack

**Files:** Create `src/components/AgendaPresence.jsx`.

- [ ] **Step 1: Write it**

```js
import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import { useOthers, useSelf } from "../lib/liveblocks.js";

const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function AgendaPresence() {
  const others = useOthers();
  const self = useSelf();
  const people = [
    ...(self ? [{ id: "self", info: self.info, me: true }] : []),
    ...others.map((o) => ({ id: o.connectionId, info: o.info, me: false })),
  ].filter((p) => p.info);
  if (people.length === 0) return null;
  return (
    <Stack direction="row" spacing={-0.75} alignItems="center">
      {people.map((p) => (
        <Tooltip key={p.id} title={p.info.name + (p.me ? " (you)" : "")}>
          <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: p.info.color, border: "2px solid #fff" }}>
            {initials(p.info.name)}
          </Avatar>
        </Tooltip>
      ))}
    </Stack>
  );
}
```

- [ ] **Step 2: Build sanity**

Run: `npm run build`. Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/AgendaPresence.jsx
git commit -m "feat(collab): AgendaPresence avatar stack"
```

---

## Task 8: Wire into `AgendaDetail.jsx`

**Files:** Modify `src/pages/AgendaDetail.jsx`. Also check `firestore.rules`.

- [ ] **Step 1: Imports**

Add near the existing editor imports:
```js
import { RoomProvider } from "../lib/liveblocks.js";
import { CollabFlushRegistryProvider, useCollabFlushRegistry } from "../components/editor/CollabFlushRegistry.jsx";
import CollabBodyEditor from "../components/editor/CollabBodyEditor.jsx";
import AgendaPresence from "../components/AgendaPresence.jsx";
```

- [ ] **Step 2: Wrap header + both views + dialogs in RoomProvider + FlushRegistry (authoritative)**

The providers must wrap **everything that uses Liveblocks**: the header (presence avatars + Sync Meeting button), BOTH view branches, AND the `SyncMeetingDialog` (it calls `useOthers()` in Task 9). Verified structure: the single top-level `return (` is at ~line 1729 (after the `agendaLoading`/`agendaError` early-returns, so `agenda`/`agendaId` are defined); the outer `<Box sx={{ maxWidth: 1280 … }}>` opens there; the header is ~1730-1771; the view ternary is ~1782-1946; `SyncMeetingDialog` is ~1961-1974; the Box closes ~1975.

Open the providers **immediately inside that outer Box** (just after it opens, ~line 1729) and close them **just before that Box closes** (~line 1975), so they wrap header + hero + both views + ManageGuests/History/SyncMeeting dialogs:
```jsx
<Box sx={{ maxWidth: 1280, … }}>
  <RoomProvider id={`agenda:${agendaId}`} initialPresence={{}}>
    <CollabFlushRegistryProvider>
      {/* …existing header, hero, the viewMode ternary, and all dialogs… */}
    </CollabFlushRegistryProvider>
  </RoomProvider>
</Box>
```
The view ternary stays a true ternary (only one branch renders) — widening the provider does NOT mount both views, so the single-instance-per-fragment invariant (§3.1) holds. The existing `EditorFocusProvider` inside the Overview branch stays as-is. **Do NOT** wrap only the ternary — presence + the dialog would fall outside the room.

- [ ] **Step 3: Swap the three editors to `CollabBodyEditor`**

For each, replace `<RichBodyEditor … />` with `<CollabBodyEditor … />`, keeping the SAME `onChangeHtml` handler (the canonical mirror) and `mode`/`placeholder`, and adding `fragmentKey` + the seed props:

- Overview topic body (~line 455): `mode="shared"`, `fragmentKey={topic.id}`, `valueHtml={topic.bodyHtml || ""}`, `seedDocPath={`agendas/${agendaId}/topics/${topic.id}`}`, `seedFlagField="collabSeeded"`.
- Working topic body (~line 1423): same props but `mode` default ("inline").
- Open Floor (~line 504): `mode="shared"`, `fragmentKey="openFloor"`, `valueHtml={agenda?.openFloorHtml || ""}`, `seedDocPath={`agendas/${agendaId}`}`, `seedFlagField="openFloorCollabSeeded"`.

**Pre-Brief stays on `RichBodyEditor`** (do NOT swap it). The three sites live inside child components (`OverviewTopic`, `AgendaTopicCard`, `OpenFloorSection`) — add the `CollabBodyEditor` import to `AgendaDetail.jsx` (Step 1 already does). `CollabBodyEditor` calls `useRoom()`, so it only works mounted under the `RoomProvider` from Step 2 — all three sites are inside it. Keep each editor's existing `onChangeHtml` mirror handler verbatim.

- [ ] **Step 4: Add the presence avatars to the header**

Near the Sync Meeting button (~line 1750, inside the header row — already inside the providers per Step 2), render `<AgendaPresence />`. It uses `useOthers()`/`useSelf()`, which resolve because Step 2 wraps the header.

- [ ] **Step 5: Flush pending edits when opening Sync Meeting (MANDATORY child extraction)**

`AgendaDetail` itself renders the providers (Step 2), so it CANNOT call `useCollabFlushRegistry()` and get the real registry — it would get the no-op fallback (context value is only visible to children). Therefore you MUST extract a small child component rendered inside the providers:
```jsx
function SyncMeetingHeaderButton({ onOpen }) {
  const { flushAll } = useCollabFlushRegistry();
  return (
    <Button size="small" startIcon={<AutoAwesomeIcon fontSize="small" />} sx={{ /* keep existing styles */ }}
      onClick={async () => { try { await flushAll(); } catch {} onOpen(); }}>
      Sync Meeting
    </Button>
  );
}
```
Replace the inline admin-gated Sync Meeting button (~line 1750) with `{isAdmin && <SyncMeetingHeaderButton onOpen={() => setSyncMeetingOpen(true)} />}`. (`AgendaPresence` is likewise a child, so it works without extraction.)

- [ ] **Step 6: Check Firestore rules for the new fields**

Read `firestore.rules`. Confirm the write rules for `agendas/{id}` and `agendas/{id}/topics/{tid}` allow any active `@vistamar` user to write (no strict field whitelist that would reject `collabSeeded` / `openFloorCollabSeeded`). The codebase convention is active-user doc-level writes (no field whitelist) — if so, NO change needed. If a field whitelist exists, add the two fields and deploy: `./node_modules/.bin/firebase deploy --only firestore:rules --project management-db9eb` (re-auth with `npx firebase login --reauth` if creds lapsed). Note in the commit whether a rule change was needed.

- [ ] **Step 7: Build + smoke**

Run: `npm run build`. Expected: success. (Full runtime behavior is verified on prod in Task 10 — local dev can't render this app per project notes.)

- [ ] **Step 8: Commit**

```bash
git add src/pages/AgendaDetail.jsx firestore.rules
git commit -m "feat(collab): wire RoomProvider + collab editors + presence + Sync Meeting flush into AgendaDetail"
```

---

## Task 9: `SyncMeetingDialog.jsx` — presence-aware apply warning

**Files:** Modify `src/components/SyncMeetingDialog.jsx`. (It renders inside the `RoomProvider`, so Liveblocks hooks work here.)

- [ ] **Step 1: Add the warning**

Import `useOthers` from `../lib/liveblocks.js`. In the component, `const others = useOthers();`. In the Apply handler (where `applyUnified` is called), before applying, if `others.length > 0`, require a confirm:
```js
if (others.length > 0) {
  const ok = window.confirm(`${others.length} other ${others.length === 1 ? "person is" : "people are"} editing this agenda right now. Applying Sync Meeting replaces all topics. Continue?`);
  if (!ok) return;
}
```
(Keep it minimal; a MUI confirm dialog is nicer but `window.confirm` is acceptable for an admin-only safety gate. If the team prefers, render an inline confirm state instead — optional.)

- [ ] **Step 2: Build sanity**

Run: `npm run build`. Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(collab): presence-aware Sync Meeting apply warning"
```

---

## Task 10: Full verification + prod deploy

**Files:** none.

- [ ] **Step 1: Unit suite + build**

Run: `npx vitest run` (expect all pass incl. `collabSync`); then `npm run build` (expect clean).

- [ ] **Step 2: Deploy**

```bash
git push origin main:dev
```
Wait for the Vercel deploy to be Ready (`vercel inspect <new-url>` → `status ● Ready`), then repoint the prod alias: `vercel alias set <new-deploy>.vercel.app vm-management-front-end.vercel.app`. (Confirm `LIVEBLOCKS_SECRET_KEY` is present: `vercel env ls` should list it for Production.)

- [ ] **Step 3: Prod verification — TWO authed browser contexts (UI hard gate)**

Drive via agent-browser. You need two independent authed sessions on `vm-management-front-end.vercel.app` (e.g. two profiles, or two CDP contexts). On the same agenda (e.g. GV – Biweekly):
1. **Live propagation:** type in topic A in context 1 → it appears in context 2 within ~1s, in BOTH Overview and Working.
2. **Concurrent same-topic:** both type into the SAME topic body at once → character-level merge, no clobber.
3. **Presence:** both contexts show each other's avatar (header) + a labeled caret in the editor with the right name/color.
4. **Persistence + no double-seed:** reload context 2 → content intact, no duplication. Open a fresh Sync-Meeting-created topic from both contexts near-simultaneously → seeded once (no duplicated bullets).
5. **Toggle-stress:** while context 2 edits, rapidly toggle Overview↔Working in context 1 → no cursor flicker / awareness storm / duplicate carets.
6. **Canonical mirror:** after edits settle, the topic still renders in Overview's read-only `RichBodyView`; confirm a subsequent Sync Meeting "reads" current content (the AI summary reflects recent edits) — then Discard.
7. **Sync Meeting presence warn:** with context 2 present, click Apply in context 1 → the "N people editing" confirm appears.

Clean up any test edits (revert via version history; Sync Meeting snapshots before apply).

- [ ] **Step 4: Update session context + push**

Mark the live-collaboration item DONE + prod-verified in `dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md` with commit refs + the verification results; note the board-presence fast-follow remains queued.
```bash
git add dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md
git commit -m "chore(session): live collaborative agenda editing shipped + prod-verified"
git push origin main:dev
```

---

## Notes for the implementer

- **Local dev cannot render this app** (date-fns/MUI ESM-interop, per project notes) — verify on Vercel prod, never localhost. Unit tests (vitest) DO run locally.
- **`undoRedo: false`** in StarterKit for collab editors (NOT `history: false`).
- **Mirror only on local edits** via `isLocalEditTransaction` — never write to Firestore on remote-applied transactions.
- **Verify library APIs against installed versions** where flagged: the caret package name, the `@liveblocks/yjs` provider sync event, and `@liveblocks/react`'s `createRoomContext` vs the newer provider API. Resolve against `node_modules`, don't guess.
- **Don't touch** Pre-Brief (stays single-user `RichBodyEditor`), the `topicId`/board-create logic, or the sticky-titles apply path shipped earlier.
- **Secret handling:** `LIVEBLOCKS_SECRET_KEY` is already in Vercel env — never put it in a committed file or a shell command.
