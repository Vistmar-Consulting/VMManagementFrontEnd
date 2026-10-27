# Board Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Task Board "Sync Board" action (Andy only) that proposes and applies board changes for every org in one run, from transcripts a shared ledger marks as new per org, without touching any agenda.

**Architecture:** Pure helpers in `src/lib/boardSyncCore.js` (classification, ledger filter, promotions — unit-tested). Firebase data layer in `src/lib/boardSync.js` (gather, per-org run, atomic apply). One new Vercel handler `api/ai/_handlers/syncBoard.js` behind the existing `/api/ai/:action` dispatcher, one model call per org. Sync Meeting's only change: it stamps the ledger on apply.

**Tech Stack:** React 18 + MUI 5, Firebase Web SDK 11 (Firestore transactions), Vitest + jsdom, Anthropic SDK (`claude-sonnet-4-6`, structured outputs), Fireflies GraphQL.

**Spec:** `docs/superpowers/specs/2026-10-26-board-sync-design.md` — read it first.

---

## Ground rules for the implementer

- Work only in the worktree `.claude/worktrees/board-sync`. `node_modules` and `.env.local` are symlinks to the main checkout — never read `.env.local`.
- Run tests one file at a time while iterating: `npx vitest run <path>`. Run the full suite (`npm test`) only at the checkpoints called out, never in parallel with `npm run build`.
- No `console.log` in committed code. No commented-out code. Match the comment style of the file you're editing.
- Stage with explicit paths only. Never `git add -A`.
- Do NOT deploy Firestore rules, push, or run a live AI call. Those are Task 11 and need Andy's go-ahead.
- Known gotcha (2026-10-13): `npm run dev` may render a blank page from a stale Vite cache. If `npm run dev -- --force` doesn't fix it, use `npx vite build && npx vite preview --port 5173`.

## File map

| File | Responsibility |
|---|---|
| `src/lib/boardSyncCore.js` (new) | Pure: access constant, transcript classification + bucketing, ledger/backfill filter, Sync Meeting stamp list, Fireflies pagination, board context per org, create promotions. |
| `src/lib/__tests__/boardSyncCore.test.js` (new) | Unit tests for the above, incl. every row of spec table 3.2. |
| `src/lib/syncMeeting.js` (modify) | `validateProposal` gets `{ requireTopic }` option; `inferAssigneeIds` moved here from the dialog. |
| `src/lib/boardSync.js` (new) | Firestore/Fireflies/API: `gatherBoardSyncInputs`, `runOrgSync`, `applyBoardSync`. |
| `api/ai/_lib/boardRules.js` (new) | Board-change prompt rules shared by `prepare.js` and `syncBoard.js`. |
| `api/ai/_handlers/prepare.js` (modify) | Use `boardRules.js` (output byte-identical, locked by snapshot). Export `buildSystem` for the snapshot test. |
| `api/ai/_handlers/syncBoard.js` (new) | `/api/ai/sync-board`: Andy gate, per-org prompt, structured output, normalization. |
| `api/ai/dispatch.js` (modify) | Route `"sync-board"`. |
| `api/ai/_handlers/__tests__/prepare.snapshot.test.js` (new) | Locks `prepare.buildSystem` output across the extraction. |
| `api/ai/_handlers/__tests__/syncBoard.test.js` (new) | Gate, constant parity, prompt shape, normalization. |
| `src/lib/aiAgenda.js` (modify) | Transcripts carry `id`/`mapped`; `applyUnified` stamps the ledger; `tagSlug` re-exported from core. |
| `src/components/SyncMeetingDialog.jsx` (modify) | Thread transcripts + org slugs into `applyUnified`; import `inferAssigneeIds`. |
| `firestore.rules` (modify) | `syncedTranscripts`, `boardSyncLog`. |
| `src/components/SyncBoardDialog.jsx` (new) | Pre-flight → per-org review → apply → result. |
| `src/pages/TaskBoard.jsx` (modify) | "Sync Board" button (Andy only) + dialog. |
| `src/pages/AIIntegration.jsx` (modify) | `HOW_IT_WORKS` Board Sync group + Sync Meeting ledger row. |
| `dev/sessions/v0_4_19_Andrew_BOARD_SYNC/context.md` | Session state (already created with this plan). |

---

### Task 1: `validateProposal` topic-optional + move `inferAssigneeIds`

**Files:**
- Modify: `src/lib/syncMeeting.js`
- Modify: `src/components/SyncMeetingDialog.jsx:52-66` (remove local `inferAssigneeIds`, import it)
- Test: `src/lib/__tests__/syncMeeting.test.js`

- [ ] **Step 1: Write the failing tests** — append to `src/lib/__tests__/syncMeeting.test.js` (add `inferAssigneeIds` to its import from `../syncMeeting.js`):

```js
describe("validateProposal requireTopic:false (Board Sync)", () => {
  const existingTasks = [{ id: "i1", title: "Existing" }];
  it("accepts a create with no topicId", () => {
    const v = validateProposal({
      topics: [],
      boardChanges: { creates: [{ title: "New task", note: "n" }], moves: [], notes: [] },
      existingTasks,
      requireTopic: false,
    });
    expect(v.acceptedCreates).toHaveLength(1);
    expect(v.hasRejections).toBe(false);
  });
  it("still enforces parentRef rules", () => {
    const v = validateProposal({
      topics: [],
      boardChanges: { creates: [{ title: "Child", parentRef: "missing" }], moves: [], notes: [] },
      existingTasks,
      requireTopic: false,
    });
    expect(v.rejectedCreates[0].reason).toBe("parentRef itemId not found on board");
  });
  it("defaults to requiring a topic", () => {
    const v = validateProposal({
      topics: [],
      boardChanges: { creates: [{ title: "New task" }], moves: [], notes: [] },
      existingTasks,
    });
    expect(v.rejectedCreates[0].reason).toBe("owning topic no longer in proposal");
  });
});

describe("inferAssigneeIds", () => {
  const users = [{ id: "u1", displayName: "Cedric Smith" }, { id: "u2", displayName: "Bill Jones" }];
  it("matches Owner: first name", () => {
    expect(inferAssigneeIds("Source 10/20. Owner: Cedric", users)).toEqual(["u1"]);
  });
  it("matches Action item for full name", () => {
    expect(inferAssigneeIds("Action item for Bill Jones.", users)).toEqual(["u2"]);
  });
  it("returns [] when no name", () => {
    expect(inferAssigneeIds("No owner here", users)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/__tests__/syncMeeting.test.js` → fails: `inferAssigneeIds is not a function` and the requireTopic:false create is rejected.

- [ ] **Step 3: Implement** in `src/lib/syncMeeting.js`:

Change the signature and the topic check:

```js
// Validate a proposal against current topics + the live board. Runs on receipt
// and again at apply (topics may have been refined between). `topics` MUST
// already carry topicId (call mintTopicIds first). Board Sync has no topics and
// passes requireTopic:false — every other rule still applies.
export function validateProposal({ topics, boardChanges, existingTasks, requireTopic = true }) {
```

```js
    const t = byId[c.topicId];
    if (requireTopic && !t) {
```

Append at the end of the file (moved verbatim from `SyncMeetingDialog.jsx`):

```js
// Parse "Owner: <name>" or "Action item for <name>" from a create note and
// return the matching user's id, if found. Shared by Sync Meeting + Board Sync.
export function inferAssigneeIds(note, users) {
  if (!note || !users?.length) return [];
  const ownerMatch = note.match(/\bOwner:\s*([^;,.\n]+)/i);
  const actionMatch = note.match(/\bAction item for\s+([^;,.\n]+)/i);
  const rawName = (ownerMatch?.[1] || actionMatch?.[1] || "").trim();
  if (!rawName) return [];
  const lower = rawName.toLowerCase();
  const matched = users.find((u) => {
    const dn = (u.displayName || "").toLowerCase();
    const firstName = dn.split(" ")[0];
    return dn === lower || firstName === lower;
  });
  return matched ? [matched.id] : [];
}
```

In `SyncMeetingDialog.jsx`: delete the local `inferAssigneeIds` function and its two comment lines, and change the import to:

```js
import { validateProposal, normalizeTopicRefs, classifyTopicChanges, inheritKeysForCreate, inferAssigneeIds } from "../lib/syncMeeting.js";
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/__tests__/syncMeeting.test.js`, then `npx vitest run src/components/__tests__/ProposedBoardRow.test.jsx` (dialog-adjacent, must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncMeeting.js src/lib/__tests__/syncMeeting.test.js src/components/SyncMeetingDialog.jsx
git commit -m "refactor(sync): validateProposal requireTopic option; share inferAssigneeIds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure core `boardSyncCore.js`

**Files:**
- Create: `src/lib/boardSyncCore.js`
- Test: `src/lib/__tests__/boardSyncCore.test.js`

- [ ] **Step 1: Write the failing tests** — `src/lib/__tests__/boardSyncCore.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import {
  BOARD_SYNC_EMAIL,
  canBoardSync,
  tagSlug,
  bucketTranscripts,
  splitBucket,
  syncMeetingStamps,
  groupStamps,
  fetchTranscriptsSince,
  boardContextForOrg,
  initPromotion,
} from "../boardSyncCore.js";

const DAY = 86400000;
const NOW = Date.parse("2026-10-26T12:00:00Z");
const resolveOrg = (att) => att?.[0]?.org || null; // test double: org carried on the attendee row
const tr = (id, title, org, daysAgo) => ({
  id, title, date: new Date(NOW - daysAgo * DAY).toISOString(), meeting_attendees: org ? [{ org }] : [],
});
const opts = (extra = {}) => ({
  orgSlugs: ["unio", "id-care", "vistamar"],
  masterTitles: new Set(["vm weekly touch base"]),
  titleOrgs: new Map([["platform dev", "vistamar"], ["id care sync", "id-care"]]),
  resolveOrg,
  sinceMs: NOW - 30 * DAY,
  ...extra,
});

describe("access", () => {
  it("allows only Andy, case-insensitive", () => {
    expect(BOARD_SYNC_EMAIL).toBe("adeemer@vistamarconsulting.com");
    expect(canBoardSync("ADeemer@VistamarConsulting.com")).toBe(true);
    expect(canBoardSync("hugo@vistamarconsulting.com")).toBe(false);
    expect(canBoardSync(null)).toBe(false);
  });
});

describe("tagSlug", () => {
  it("slugifies", () => expect(tagSlug("  Laser Launch Q4! ")).toBe("laser-launch-q4"));
});

describe("bucketTranscripts — spec table 3.2 scopes", () => {
  it("this-org: attendee-classified client meeting goes only to that client", () => {
    const { buckets } = bucketTranscripts([tr("a", "Unio weekly", "unio", 2)], opts());
    expect(buckets.unio.map((t) => [t.id, t.scope])).toEqual([["a", "this-org"]]);
    expect(buckets["id-care"]).toEqual([]);
    expect(buckets.vistamar).toEqual([]);
  });
  it("cross-org: master-mapped title fans into every org", () => {
    const { buckets } = bucketTranscripts([tr("m", "VM Weekly Touch Base", "vistamar", 1)], opts());
    for (const o of ["unio", "id-care", "vistamar"]) expect(buckets[o][0].scope).toBe("cross-org");
  });
  it("vistamar-internal: Vistamar meeting is this-org for vistamar, context for clients", () => {
    const { buckets } = bucketTranscripts([tr("v", "Platform dev", null, 3)], opts());
    expect(buckets.vistamar[0].scope).toBe("this-org");
    expect(buckets.unio[0].scope).toBe("vistamar-internal");
  });
  it("an explicit title→org mapping wins over the attendee classification", () => {
    const { buckets } = bucketTranscripts([tr("t", "ID Care Sync", "unio", 2)], opts());
    expect(buckets["id-care"].map((t) => [t.id, t.scope])).toEqual([["t", "this-org"]]);
    expect(buckets.unio).toEqual([]);
  });
  it("normalizes master/title keys so callers cannot mis-case them", () => {
    const { buckets } = bucketTranscripts([tr("m", "VM Weekly Touch Base", null, 1), tr("p", "Platform Dev", null, 1)], opts({
      masterTitles: new Set([" VM Weekly Touch Base "]), titleOrgs: new Map([["  Platform Dev", "vistamar"]]),
    }));
    expect(buckets.unio.map((t) => t.scope)).toEqual(["cross-org", "vistamar-internal"]);
  });
  it("counts undated rows as unclassified", () => {
    const { unclassified } = bucketTranscripts([{ id: "u", title: "Unio weekly", date: null, meeting_attendees: [{ org: "unio" }] }], opts());
    expect(unclassified).toBe(1);
  });
  it("drops out-of-window and counts unclassified", () => {
    const { buckets, unclassified } = bucketTranscripts(
      [tr("old", "Unio weekly", "unio", 40), tr("x", "Random", null, 1)],
      opts(),
    );
    expect(buckets.unio).toEqual([]);
    expect(unclassified).toBe(1);
  });
});

describe("splitBucket — ledger + backfill", () => {
  // Epoch after NOW so backfill applies to these fixtures unless a test overrides it.
  const ctxBase = { ledger: new Map(), thresholds: {}, masterThreshold: 0, epochMs: NOW + DAY };
  const bucketOf = (list, org) => bucketTranscripts(list, opts()).buckets[org];

  it("unstamped this-org is new", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", ctxBase);
    expect(s.fresh.map((t) => t.id)).toEqual(["a"]);
  });
  it("stamped for this org → already-synced context", () => {
    const ledger = new Map([["a", { orgs: { unio: { by: "agenda" } } }]]);
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.fresh).toEqual([]);
    expect(s.context[0].scope).toBe("already-synced");
  });
  it("already-synced cross-org row keeps the crossOrg flag", () => {
    const ledger = new Map([["m", { orgs: { unio: { by: "board" } } }]]);
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 1)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.context[0]).toMatchObject({ scope: "already-synced", crossOrg: true });
  });
  it("already-synced this-org row is not flagged crossOrg", () => {
    const ledger = new Map([["a", { orgs: { unio: { by: "agenda" } } }]]);
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.context[0].crossOrg).toBe(false);
  });
  it("cross-org stamped for another org is still new for this one", () => {
    const ledger = new Map([["m", { orgs: { vistamar: { by: "board" } } }]]);
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 1)], "unio"), "unio", { ...ctxBase, ledger });
    expect(s.fresh.map((t) => t.id)).toEqual(["m"]);
  });
  it("vistamar-internal never counts as new for a client", () => {
    const s = splitBucket(bucketOf([tr("v", "Platform dev", null, 3)], "unio"), "unio", ctxBase);
    expect(s.fresh).toEqual([]);
    expect(s.context[0].scope).toBe("vistamar-internal");
  });
  it("backfill: transcript before the org's last Sync Meeting counts as synced", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 5)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - 2 * DAY },
    });
    expect(s.fresh).toEqual([]);
  });
  it("backfill: cross-org uses the master agenda's last sync", () => {
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 5)], "unio"), "unio", {
      ...ctxBase, masterThreshold: NOW - 2 * DAY,
    });
    expect(s.fresh).toEqual([]);
  });
  it("backfill: a client's own later Sync Meeting does NOT hide a cross-org transcript", () => {
    const s = splitBucket(bucketOf([tr("m", "VM Weekly Touch Base", "vistamar", 5)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - DAY },
    });
    expect(s.fresh.map((t) => t.id)).toEqual(["m"]);
  });
  it("after the ledger epoch, only the ledger counts (no backfill)", () => {
    const s = splitBucket(bucketOf([tr("a", "Unio weekly", "unio", 2)], "unio"), "unio", {
      ...ctxBase, thresholds: { unio: NOW - DAY }, epochMs: NOW - 3 * DAY,
    });
    expect(s.fresh.map((t) => t.id)).toEqual(["a"]);
  });
  it("context cap keeps already-synced rows ahead of newer vistamar-internal rows", () => {
    const vi = Array.from({ length: 12 }, (_, i) => tr(`v${i}`, "Platform dev", null, i + 1));
    const old = Array.from({ length: 3 }, (_, i) => tr(`s${i}`, "Unio weekly", "unio", 20 + i));
    const ledger = new Map(old.map((t) => [t.id, { orgs: { unio: { by: "agenda" } } }]));
    const s = splitBucket(bucketOf([...vi, ...old], "unio"), "unio", { ...ctxBase, ledger }, { maxContext: 10 });
    expect(s.context).toHaveLength(10);
    expect(s.context.filter((t) => t.scope === "already-synced")).toHaveLength(3);
  });
  it("caps new at maxNew and reports the overflow", () => {
    const list = Array.from({ length: 4 }, (_, i) => tr(`t${i}`, "Unio weekly", "unio", i + 1));
    const s = splitBucket(bucketOf(list, "unio"), "unio", ctxBase, { maxNew: 3 });
    expect(s.fresh.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
    expect(s.droppedNew).toBe(1);
  });
});

describe("syncMeetingStamps — Sync Meeting writer rule", () => {
  const t = (id, scope, extra = {}) => ({ id, scope, org: extra.org || null, mapped: !!extra.mapped });
  it("per-org stamps this-org only, never vistamar-internal", () => {
    const out = syncMeetingStamps([t("a", "this-org"), t("v", "vistamar-internal", { org: "vistamar" })], {
      targetOrg: "unio", master: false, orgSlugs: [],
    });
    expect(out).toEqual([{ id: "a", org: "unio" }]);
  });
  it("master stamps mapped transcripts for every org, others for their own org", () => {
    const out = syncMeetingStamps([t("m", "vistamar-internal", { org: "vistamar", mapped: true }), t("c", "this-org", { org: "unio" })], {
      targetOrg: null, master: true, orgSlugs: ["unio", "vistamar"],
    });
    expect(out).toEqual([
      { id: "m", org: "unio" }, { id: "m", org: "vistamar" }, { id: "c", org: "unio" },
    ]);
  });
  it("skips transcripts without an id", () => {
    expect(syncMeetingStamps([{ scope: "this-org" }], { targetOrg: "unio", master: false, orgSlugs: [] })).toEqual([]);
  });
  it("groupStamps merges orgs per transcript id", () => {
    expect(groupStamps([{ id: "m", org: "unio" }, { id: "m", org: "vistamar" }, { id: "m", org: "unio" }]))
      .toEqual({ m: ["unio", "vistamar"] });
  });
});

describe("fetchTranscriptsSince", () => {
  const page = (startDay, n) => ({
    transcripts: Array.from({ length: n }, (_, i) => ({ id: `${startDay + i}`, date: new Date(NOW - (startDay + i) * DAY).toISOString() })),
  });
  it("stops at a short page", async () => {
    const q = vi.fn().mockResolvedValueOnce(page(0, 10));
    const rows = await fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 50 });
    expect(rows).toHaveLength(10);
    expect(q).toHaveBeenCalledWith("Q", { limit: 50, skip: 0 });
  });
  it("pages until the oldest row passes the cutoff", async () => {
    const q = vi.fn().mockResolvedValueOnce(page(0, 2)).mockResolvedValueOnce(page(2, 2)).mockResolvedValueOnce(page(40, 2));
    const rows = await fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 2 });
    expect(rows).toHaveLength(6);
    expect(q).toHaveBeenCalledTimes(3);
  });
  it("dedupes rows that shift between pages", async () => {
    const q = vi.fn().mockResolvedValueOnce(page(0, 2)).mockResolvedValueOnce({ transcripts: [{ id: "1", date: page(1, 1).transcripts[0].date }, ...page(40, 1).transcripts] });
    const rows = await fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 2 });
    expect(rows.map((r) => r.id)).toEqual(["0", "1", "40"]);
  });
  it("throws if it never reaches the cutoff", async () => {
    const q = vi.fn().mockResolvedValue(page(0, 2));
    await expect(fetchTranscriptsSince(q, "Q", NOW - 30 * DAY, { pageSize: 2, maxPages: 2 })).rejects.toThrow(/did not reach/);
  });
});

describe("boardContextForOrg", () => {
  const items = [
    { id: "p", title: "Parent", name: "Parent", organizationId: "unio", statusId: 2, updatedAt: NOW - DAY, createdAt: NOW - 60 * DAY },
    { id: "c", title: "Child", name: "Child", organizationId: "unio", parentId: "p", statusId: 1, updatedAt: NOW - DAY, createdAt: NOW - DAY },
    { id: "o", title: "Other org", organizationId: "id-care", statusId: 1, updatedAt: NOW, createdAt: NOW },
  ];
  it("existingTasks = this org's top-level items; projectBoard = recent activity", () => {
    const { existingTasks, projectBoard } = boardContextForOrg(items, "unio", NOW - 30 * DAY);
    expect(existingTasks.map((t) => t.id)).toEqual(["p"]);
    expect(projectBoard.map((b) => [b.name, b.isNew, b.project])).toEqual([["Parent", false, null], ["Child", true, "Parent"]]);
  });
});

describe("initPromotion", () => {
  const categories = [{ id: "website", name: "Website" }, { id: "seo", name: "SEO" }];
  const tags = [{ id: "hipaa", name: "hipaa" }, { id: "gbp", name: "GBP" }];
  it("first resolvable category; known tags resolved; unknown tags kept as new", () => {
    const p = initPromotion({ categories: ["nope", "SEO", "website"], tags: ["GBP", "laser launch", "hipaa"], note: "" }, { categories, tags, users: [] });
    expect(p).toEqual({ statusId: 8, categoryId: "seo", tagIds: ["gbp", "hipaa"], newTags: ["laser launch"] });
  });
  it("dedupes new tags by slug and skips empty slugs", () => {
    const p = initPromotion({ categories: [], tags: ["Laser Launch", "laser launch", "!!!"], note: "" }, { categories, tags, users: [] });
    expect(p.newTags).toEqual(["Laser Launch"]);
  });
  it("no category → null; infers assignee from the note", () => {
    const p = initPromotion({ categories: [], tags: [], note: "Owner: Bill" }, { categories, tags, users: [{ id: "u2", displayName: "Bill Jones" }] });
    expect(p.categoryId).toBeNull();
    expect(p.assigneeIds).toEqual(["u2"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/__tests__/boardSyncCore.test.js` → `Failed to resolve import "../boardSyncCore.js"`.

- [ ] **Step 3: Implement** `src/lib/boardSyncCore.js`:

```js
// Pure helpers for Board Sync — the Task Board's all-org sync (spec
// docs/superpowers/specs/2026-10-26-board-sync-design.md). No Firebase/React
// imports; unit-tested in __tests__/boardSyncCore.test.js. boardSync.js does the
// I/O and calls these.
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { AI_GEN_STATUS } from "./itemStatusMap.js";
import { inferAssigneeIds } from "./syncMeeting.js";

// Twin: api/ai/_handlers/syncBoard.js BOARD_SYNC_EMAIL (api/ can't import src/).
// A test asserts the two match.
export const BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com";

const DAY_MS = 24 * 60 * 60 * 1000;
export const LOOKBACK_MS = 30 * DAY_MS;
export const MAX_NEW_TRANSCRIPTS = 25;
export const MAX_CONTEXT_TRANSCRIPTS = 10;
const MAX_BOARD_ITEMS = 40;

// Scopes that can create tasks for an org (spec 3.2). vistamar-internal and
// already-synced are context only.
const NEW_SCOPES = new Set(["this-org", "cross-org"]);

const norm = (s) => String(s || "").toLowerCase().trim();

export function toMs(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v.toMillis) return v.toMillis(); // Firestore Timestamp
  const p = Date.parse(v);
  return Number.isNaN(p) ? 0 : p;
}

export function canBoardSync(email) {
  return norm(email) === BOARD_SYNC_EMAIL;
}

// slugify a coined tag name → a stable lowercase-hyphenated id.
export function tagSlug(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Put each in-window Fireflies row into every org bucket it belongs to, tagged
// with its scope for that org (spec table 3.2):
//   master-mapped title      → cross-org in EVERY bucket
//   Vistamar meeting         → this-org for vistamar, vistamar-internal for clients
//   client meeting           → this-org for that client only
// Org resolution order: master title, then titleOrgs (explicit title→org agenda
// mapping, any non-master agenda), then attendee classification. Keys of
// masterTitles/titleOrgs are normalized here. Rows that are undated or that no
// rule claims are counted as unclassified, not silently dropped; out-of-window
// rows are dropped silently.
export function bucketTranscripts(list, { orgSlugs, masterTitles, titleOrgs, resolveOrg, sinceMs }) {
  const buckets = Object.fromEntries(orgSlugs.map((o) => [o, []]));
  const masters = new Set([...masterTitles].map(norm));
  const mapped = new Map([...titleOrgs].map(([k, v]) => [norm(k), v]));
  let unclassified = 0;
  for (const t of list || []) {
    const ms = toMs(t.date);
    if (!ms) {
      unclassified += 1;
      continue;
    }
    if (ms < sinceMs) continue;
    const title = norm(t.title);
    const row = { ...t, _ms: ms };
    if (masters.has(title)) {
      orgSlugs.forEach((o) => buckets[o].push({ ...row, scope: "cross-org" }));
      continue;
    }
    const org = mapped.get(title) || resolveOrg(t.meeting_attendees) || null;
    if (org === "vistamar") {
      orgSlugs.forEach((o) => buckets[o].push({ ...row, scope: o === "vistamar" ? "this-org" : "vistamar-internal" }));
    } else if (org && buckets[org]) {
      buckets[org].push({ ...row, scope: "this-org" });
    } else {
      unclassified += 1;
    }
  }
  return { buckets, unclassified };
}

// The moment Sync Meeting started stamping the ledger (rules + FE deploy). Set
// to the real deploy time at ship (morning checklist). Transcripts after it are
// judged by the ledger alone; backfill only covers history before it.
export const LEDGER_EPOCH_MS = Date.parse("2026-10-27T12:00:00Z");

// Ledger stamp, or — for pre-ledger transcripts only — backfill: it counts as
// synced for org X if it predates X's latest Sync Meeting. A cross-org meeting
// was only ever a SOURCE for the master agenda's sync (a client's Sync Meeting
// saw it as context), so it uses the master threshold alone. Spec 3.4.
function isSyncedFor(t, org, { ledger, thresholds, masterThreshold, epochMs = LEDGER_EPOCH_MS }) {
  if (ledger.get(t.id)?.orgs?.[org]) return true;
  if (t._ms >= epochMs) return false;
  const th = t.scope === "cross-org" ? masterThreshold || 0 : thresholds[org] || 0;
  return t._ms <= th;
}

// Split one org's bucket into new sources (may create tasks) and context.
export function splitBucket(bucket, org, ctx, { maxNew = MAX_NEW_TRANSCRIPTS, maxContext = MAX_CONTEXT_TRANSCRIPTS } = {}) {
  const sorted = [...(bucket || [])].sort((a, b) => b._ms - a._ms);
  const fresh = [];
  const synced = [];
  const internal = [];
  for (const t of sorted) {
    if (!NEW_SCOPES.has(t.scope)) internal.push(t);
    else if (isSyncedFor(t, org, ctx)) synced.push({ ...t, scope: "already-synced", crossOrg: t.scope === "cross-org" });
    else fresh.push(t);
  }
  // already-synced is the do-not-duplicate signal, so it survives the cap first.
  return {
    fresh: fresh.slice(0, maxNew),
    context: [...synced, ...internal].slice(0, maxContext),
    droppedNew: Math.max(0, fresh.length - maxNew),
  };
}

// Which (transcript, org) pairs a Sync Meeting apply stamps (spec 3.3).
// `transcripts` come from assembleGenInputs ({ id, org, scope, mapped }).
export function syncMeetingStamps(transcripts, { targetOrg, master, orgSlugs }) {
  const out = [];
  for (const t of transcripts || []) {
    if (!t?.id) continue;
    if (master) {
      if (t.mapped) orgSlugs.forEach((o) => out.push({ id: t.id, org: o }));
      else if (t.org) out.push({ id: t.id, org: t.org });
    } else if (t.scope === "this-org" && targetOrg) {
      out.push({ id: t.id, org: targetOrg });
    }
  }
  return out;
}

// A Fireflies id usable as a syncedTranscripts doc id. doc() throws on these
// inside the transaction, which would abort the whole apply over one stamp.
export function isLedgerId(id) {
  return typeof id === "string" && id !== "" && id !== "." && id !== ".." && !id.includes("/") && !/^__.*__$/.test(id);
}

// [{ id, org }] → { [id]: [org, …] } so each ledger doc is written once per tx.
// Ids Firestore can't use are skipped (that transcript stays unstamped = new).
export function groupStamps(stamps) {
  const out = {};
  for (const { id, org } of stamps || []) {
    if (!isLedgerId(id)) continue;
    if (!out[id]) out[id] = [];
    if (!out[id].includes(org)) out[id].push(org);
  }
  return out;
}

// Page the Fireflies list (newest first) until it passes sinceMs. Fails loudly
// rather than returning a silently truncated window.
export async function fetchTranscriptsSince(queryFn, listQuery, sinceMs, { pageSize = 50, maxPages = 10 } = {}) {
  const all = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const data = await queryFn(listQuery, { limit: pageSize, skip: page * pageSize });
    const rows = data?.transcripts || [];
    // Offset paging can shift when a transcript lands mid-run; keep each id once.
    for (const row of rows) if (!seen.has(row.id)) { seen.add(row.id); all.push(row); }
    if (rows.length < pageSize) return all;
    const dates = rows.map((r) => toMs(r.date)).filter(Boolean);
    if (dates.length && Math.min(...dates) < sinceMs) return all;
  }
  throw new Error(`Fireflies list did not reach ${new Date(sinceMs).toISOString().slice(0, 10)} within ${maxPages} pages`);
}

const statusLabel = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "?";

// One org's board inputs — same shapes as assembleGenInputs' per-org output.
export function boardContextForOrg(items, org, sinceMs) {
  const own = (items || []).filter((it) => it.organizationId === org);
  const nameById = new Map((items || []).map((it) => [it.id, it.name]));
  const projectBoard = own
    .filter((it) => toMs(it.createdAt) >= sinceMs || toMs(it.updatedAt) >= sinceMs)
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
    .slice(0, MAX_BOARD_ITEMS)
    .map((it) => ({
      name: it.name || "",
      status: statusLabel(it.statusId),
      isNew: toMs(it.createdAt) >= sinceMs,
      project: it.parentId ? nameById.get(it.parentId) || null : null,
    }));
  const existingTasks = own
    .filter((it) => !it.parentId)
    .map((it) => ({ id: it.id, title: it.title || "", status: statusLabel(it.statusId), category: it.categoryId || null, organizationId: org }))
    .filter((t) => t.title);
  return { projectBoard, existingTasks };
}

function resolveTagId(raw, tags) {
  const name = String(raw || "").trim();
  if (!name) return null;
  const byId = tags.find((t) => t.id === name);
  if (byId) return byId.id;
  const byName = tags.find((t) => norm(t.name) === norm(name));
  if (byName) return byName.id;
  const slug = tagSlug(name);
  return tags.find((t) => t.id === slug)?.id || null;
}

// Initial review state for one create (spec 7, "Create mapping"): AI Gen status,
// first resolvable category, known tags as ids, unknown tags kept to coin at apply.
export function initPromotion(create, { categories, tags, users }) {
  const catIds = new Set((categories || []).map((c) => c.id));
  const catByName = new Map((categories || []).map((c) => [norm(c.name), c.id]));
  const categoryId = (create.categories || [])
    .map((c) => (catIds.has(String(c).trim()) ? String(c).trim() : catByName.get(norm(c)) || null))
    .find(Boolean) || null;
  const tagIds = [];
  const newTags = [];
  for (const raw of create.tags || []) {
    const id = resolveTagId(raw, tags || []);
    if (id) {
      if (!tagIds.includes(id)) tagIds.push(id);
    } else if (tagSlug(raw) && !newTags.some((n) => tagSlug(n) === tagSlug(raw))) {
      newTags.push(String(raw).trim());
    }
  }
  const assigneeIds = inferAssigneeIds(create.note, users || []);
  return { statusId: AI_GEN_STATUS, categoryId, tagIds, newTags, ...(assigneeIds.length ? { assigneeIds } : {}) };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/__tests__/boardSyncCore.test.js`. If `boardContextForOrg` ordering differs, fix the implementation, not the test (Parent and Child have equal `updatedAt`; stable sort keeps input order).

- [ ] **Step 5: Make `aiAgenda.js` use the shared `tagSlug`** — in `src/lib/aiAgenda.js` replace the local `tagSlug` function (lines 376-379) with:

```js
// slugify a coined tag name → a stable lowercase-hyphenated id (shared with Board Sync).
export { tagSlug } from "./boardSyncCore.js";
```

and add `import { tagSlug } from "./boardSyncCore.js";` to its imports (it's used inside `applyUnified`). Run `npx vitest run src/lib/__tests__/syncMeeting.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boardSyncCore.js src/lib/__tests__/boardSyncCore.test.js src/lib/aiAgenda.js
git commit -m "feat(board-sync): pure core — scope buckets, ledger filter, stamps, promotions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extract shared board rules from `prepare.js` (snapshot-locked)

**Files:**
- Create: `api/ai/_lib/boardRules.js`
- Modify: `api/ai/_handlers/prepare.js:149, 190-234`
- Test: `api/ai/_handlers/__tests__/prepare.snapshot.test.js`

- [ ] **Step 1: Export `buildSystem`** — in `prepare.js` change `function buildSystem(` to `export function buildSystem(`. No other change yet.

- [ ] **Step 2: Write the snapshot test** — `api/ai/_handlers/__tests__/prepare.snapshot.test.js`:

```js
import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const { buildSystem } = await import("../prepare.js");

const categories = [{ slug: "website", name: "Website", description: "Site work", sop: "Bill executes." }];
const tagVocab = [{ name: "hipaa" }];
const orgMeta = [{ slug: "unio", name: "Unio", type: "client" }, { slug: "vistamar", name: "Vistamar", type: "internal" }];

// Locks the Sync Meeting system prompt byte-for-byte across the boardRules.js
// extraction (Board Sync plan Task 3).
describe("prepare buildSystem", () => {
  it("client", () => expect(buildSystem("P {{meetingStyle}}", "working", categories, tagVocab, false, false, [])).toMatchSnapshot());
  it("internal", () => expect(buildSystem("P", "executive", categories, tagVocab, true, false, [])).toMatchSnapshot());
  it("master", () => expect(buildSystem("P", "working", categories, tagVocab, false, true, orgMeta)).toMatchSnapshot());
});
```

- [ ] **Step 3: Record the baseline** — `npx vitest run api/ai/_handlers/__tests__/prepare.snapshot.test.js` → PASS, writes `__snapshots__/prepare.snapshot.test.js.snap` (3 snapshots written). This is against the UNCHANGED prompt.

- [ ] **Step 4: Create `api/ai/_lib/boardRules.js`** — move the text VERBATIM out of `prepare.js` (copy-paste from the file, don't retype; these must be character-identical):

```js
// api/ai/_lib/boardRules.js
//
// Project Board change rules shared by Sync Meeting (_handlers/prepare.js) and
// Board Sync (_handlers/syncBoard.js), so the two features never drift on what
// belongs on a board or how moves/notes/subitems work. prepare.js's output is
// locked byte-for-byte by __tests__/prepare.snapshot.test.js.

// Vistamar board scope — prepended to the board rules for Vistamar (internal)
// and master runs.
export const VISTAMAR_BOARD_SCOPE = `## SCOPE — what belongs on the Vistamar board
Vistamar's board covers ONLY Vistamar's own work: (1) platform/product development of Vistamar's own apps and internal tooling, and (2) business development — promoting Vistamar's company & services AND outreach to PROSPECTIVE clients for new-business acquisition. Work that delivers services to an EXISTING client org (Unio, Bryn Mawr, Golden Vision, ID Care) does NOT belong here — it lives on that client's board, so do NOT propose it as a Vistamar create. Outreach to a PROSPECTIVE (not-yet) client IS Vistamar business development → include it.`;

export const CREATE_BASE_RULES = `- Propose ONLY work that genuinely surfaced in the record and is NOT already on the board (don't duplicate existing tasks).
- Each create: a concrete action-oriented title; a one-line note citing the source (meeting/date) + naming the owner/contact (use the SOPs — e.g. Bill = website, Cedric = technical).`;

export const PARENT_REF_RULES = `- OPTIONAL: set \`parentRef\` when this task is a subitem.
  - Nest under an **existing** board item: set \`parentRef\` to that item's \`itemId\` (from the task list below).
  - Nest under a **newly proposed** task in this run: set \`parentRef\` to \`"new:N"\` where N is the 0-based index of the parent create in this \`creates\` array (e.g. \`"new:0"\` nests under the first proposed task).
  - One level deep only — never set \`parentRef\` on a task whose intended parent itself has a \`parentRef\`.
  - Leave \`parentRef\` empty or omit for top-level tasks.`;

export const MOVES_RULES = `### boardChanges.moves — STATUS MOVES on EXISTING tasks
- When the record clearly indicates an existing task progressed, propose a move. Set itemId (exact, from the existing list), title (copy the existing title), toStatus (one of: Assigned, In Progress, Blocked, Review, Done), and a one-line reason citing the source.
- Examples: transcript says something shipped/aired/published → toStatus "Done"; work actively underway → "In Progress"; awaiting sign-off → "Review"; blocked/waiting → "Blocked". Only move when the record is clear — when unsure, omit.`;

export const NOTES_RULES = `### boardChanges.notes — context on EXISTING tasks
- When the record adds useful context to an existing task without changing its status, propose a note: itemId, title (copy existing), and the note text (cite the source).`;
```

- [ ] **Step 5: Rewire `prepare.js`** — add `import { VISTAMAR_BOARD_SCOPE, CREATE_BASE_RULES, PARENT_REF_RULES, MOVES_RULES, NOTES_RULES } from "../_lib/boardRules.js";`, then:

```js
  const boardScope = internal || master
    ? `${VISTAMAR_BOARD_SCOPE}

`
    : "";
```

and replace the section from `${boardScope}### boardChanges.creates — NEW tasks` through the end of the return template literal (including the `Be precise…` line and the `${buildCategorization(…)}` tail) with:

```js
${boardScope}### boardChanges.creates — NEW tasks
${CREATE_BASE_RULES}
- CRITICAL: For each new task in boardChanges.creates, set \`topicIndex\` to the 0-based index (in the \`topics\` array) of the topic it belongs under. The task will INHERIT that topic's category and tags — do NOT assign categories/tags to tasks yourself. Every create must reference a real topic index.
${PARENT_REF_RULES}

${MOVES_RULES}

${NOTES_RULES}

Be precise, not exhaustive. Return empty arrays for any boardChanges kind with nothing to propose.${buildCategorization(categories, tagVocab)}`;
```

(Note the original `boardScope` ended with a blank line then `\n` before `###` — the snapshot tells you if the whitespace is off.)

- [ ] **Step 6: Run, expect PASS with no snapshot change** — `npx vitest run api/ai/_handlers/__tests__/prepare.snapshot.test.js`. Must PASS with "3 passed", **not** "snapshots updated". If it fails, diff and fix `prepare.js` / `boardRules.js` whitespace. NEVER run with `-u`.

- [ ] **Step 7: Commit**

```bash
git add api/ai/_lib/boardRules.js api/ai/_handlers/prepare.js api/ai/_handlers/__tests__/prepare.snapshot.test.js api/ai/_handlers/__tests__/__snapshots__/prepare.snapshot.test.js.snap
git commit -m "refactor(ai): share board-change prompt rules; snapshot-lock Sync Meeting prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `/api/ai/sync-board` handler

**Files:**
- Create: `api/ai/_handlers/syncBoard.js`
- Modify: `api/ai/dispatch.js:29-37`
- Test: `api/ai/_handlers/__tests__/syncBoard.test.js`

- [ ] **Step 1: Write the failing tests** — `api/ai/_handlers/__tests__/syncBoard.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { BOARD_SYNC_EMAIL as FE_EMAIL } from "../../../../src/lib/boardSyncCore.js";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const { BOARD_SYNC_EMAIL, isBoardSyncAllowed, buildSystem, buildUserMessage, normalizeBoardChanges } = await import("../syncBoard.js");

describe("access gate", () => {
  it("server and FE constants match", () => expect(BOARD_SYNC_EMAIL).toBe(FE_EMAIL));
  it("allows only Andy", () => {
    expect(isBoardSyncAllowed("adeemer@vistamarconsulting.com")).toBe(true);
    expect(isBoardSyncAllowed("scot@vistamarconsulting.com")).toBe(false);
    expect(isBoardSyncAllowed(undefined)).toBe(false);
  });
});

describe("handler", () => {
  it("returns 403 for a signed-in non-Andy account before any model call", async () => {
    vi.resetModules();
    vi.doMock("../../../meetings/_lib/auth.js", () => ({
      requireAuth: async (req) => { req.authUser = { email: "hugo@vistamarconsulting.com" }; return true; },
    }));
    vi.doMock("../../../meetings/_lib/cors.js", () => ({ applyCors: () => false }));
    const { default: handler } = await import("../syncBoard.js");
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: "POST", headers: {}, body: { org: { slug: "unio" } } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("buildSystem", () => {
  const base = { orgPrompt: "Org prompt {{meetingStyle}}", categories: [{ slug: "website", name: "Website", description: "", sop: "" }], tagVocab: [{ name: "hipaa" }] };
  it("client: no Vistamar scope block, no agenda output, style filled", () => {
    const s = buildSystem({ ...base, org: { slug: "unio", name: "Unio", type: "client" } });
    expect(s).not.toContain("## SCOPE — what belongs on the Vistamar board");
    expect(s).toContain("You are NOT writing a meeting agenda");
    expect(s).toContain("Org prompt working");
    expect(s).not.toContain("topicIndex");
  });
  it("vistamar: includes scope block", () => {
    const s = buildSystem({ ...base, org: { slug: "vistamar", name: "Vistamar", type: "internal" } });
    expect(s).toContain("## SCOPE — what belongs on the Vistamar board");
  });
});

describe("buildUserMessage", () => {
  it("separates NEW and CONTEXT transcripts and flags cross-org", () => {
    const m = buildUserMessage({
      org: { slug: "unio", name: "Unio" },
      transcripts: [{ title: "Touch Base", date: "2026-10-26", scope: "cross-org", overview: "o", actionItems: "a" }],
      contextTranscripts: [{ title: "Platform dev", date: "2026-10-20", scope: "vistamar-internal", overview: "x", actionItems: "" }],
      projectBoard: [], existingTasks: [{ id: "i1", title: "Fix hero", status: "Assigned" }], orgAgendas: [], extraContext: "Blog A published",
    });
    const newIdx = m.indexOf("## NEW meeting transcripts");
    const ctxIdx = m.indexOf("## CONTEXT-ONLY transcripts");
    expect(newIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeGreaterThan(newIdx);
    expect(m).toContain("Touch Base (2026-10-26) [cross-org — take only Unio's parts]");
    expect(m).toContain("[Vistamar internal] Platform dev");
    expect(m).toContain("[itemId:i1] Fix hero [Assigned]");
    expect(m).toContain("Blog A published");
  });
});

describe("buildUserMessage — synced cross-org", () => {
  it("keeps the cross-org suffix on an already-synced Touch Base", () => {
    const m = buildUserMessage({
      org: { slug: "unio", name: "Unio" }, transcripts: [],
      contextTranscripts: [{ title: "Touch Base", date: "2026-10-26", scope: "already-synced", crossOrg: true, overview: "o", actionItems: "" }],
    });
    expect(m).toContain("[Already synced] Touch Base (2026-10-26) [cross-org — take only Unio's parts]");
  });
});

describe("buildSystem — categories", () => {
  const org = { slug: "unio", name: "Unio", type: "client" };
  it("omits the categories section when there are none", () => {
    const s = buildSystem({ orgPrompt: "", org, categories: [], tagVocab: [] });
    expect(s).not.toContain("## Categories");
    expect(s).not.toContain("(none)\n\n## Tag");
  });
  it("tells the model to use exactly one slug", () => {
    const s = buildSystem({ orgPrompt: "", org, categories: [{ slug: "website", name: "Website", description: "", sop: "" }], tagVocab: [] });
    expect(s).toContain("an array with exactly ONE category SLUG");
  });
});

describe("normalizeBoardChanges", () => {
  it("coerces and drops incomplete rows", () => {
    const out = normalizeBoardChanges({
      boardChanges: {
        creates: [{ title: "T", note: "n", categories: ["seo", 3], tags: ["x"] }, { title: "", note: "n" }],
        moves: [{ itemId: "i1", title: "a", toStatus: "Done", reason: "r" }, { itemId: "", toStatus: "Done" }],
        notes: [{ itemId: "i1", title: "a", note: "z" }, { itemId: "i1", note: "" }],
      },
    });
    expect(out.creates).toEqual([{ title: "T", note: "n", parentRef: "", categories: ["seo", "3"], tags: ["x"] }]);
    expect(out.moves).toHaveLength(1);
    expect(out.notes).toHaveLength(1);
  });
  it("tolerates a missing boardChanges", () => {
    expect(normalizeBoardChanges({})).toEqual({ creates: [], moves: [], notes: [] });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run api/ai/_handlers/__tests__/syncBoard.test.js` → cannot resolve `../syncBoard.js`.

- [ ] **Step 3: Implement** `api/ai/_handlers/syncBoard.js`:

```js
// api/ai/sync-board.js (dispatched)
//
// Board Sync — Project Board changes (creates / moves / notes) for ONE org,
// from the transcripts the ledger marks new for that org. No agenda output.
// The Task Board fires one request per selected org in parallel and merges the
// results into one review (spec docs/superpowers/specs/2026-10-26-board-sync-design.md).
//
// Auth: requireAuth (Firebase ID token, @vistamarconsulting.com) PLUS an
// Andy-only email check — Board Sync is restricted to adeemer@.
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../../meetings/_lib/cors.js";
import { requireAuth } from "../../meetings/_lib/auth.js";
import { VISTAMAR_BOARD_SCOPE, CREATE_BASE_RULES, PARENT_REF_RULES, MOVES_RULES, NOTES_RULES } from "../_lib/boardRules.js";

// Same model as prepare.js.
const MODEL = "claude-sonnet-4-6";

// Twin: src/lib/boardSyncCore.js BOARD_SYNC_EMAIL (api/ can't import src/).
// __tests__/syncBoard.test.js asserts the two match.
export const BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com";

export function isBoardSyncAllowed(email) {
  return String(email || "").toLowerCase().trim() === BOARD_SYNC_EMAIL;
}

// Board changes only. Unlike prepare.js, creates carry their own categories +
// tags — there is no topic to inherit from.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    boardChanges: {
      type: "object",
      additionalProperties: false,
      properties: {
        creates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              note: { type: "string" },
              parentRef: { type: "string" },
              categories: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["title", "note", "categories", "tags"],
          },
        },
        moves: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              itemId: { type: "string" },
              title: { type: "string" },
              toStatus: { type: "string" },
              reason: { type: "string" },
            },
            required: ["itemId", "title", "toStatus", "reason"],
          },
        },
        notes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              itemId: { type: "string" },
              title: { type: "string" },
              note: { type: "string" },
            },
            required: ["itemId", "title", "note"],
          },
        },
      },
      required: ["creates", "moves", "notes"],
    },
  },
  required: ["boardChanges"],
};

function categorizationBlock(categories, tagVocab) {
  const cats = Array.isArray(categories) ? categories : [];
  const tags = Array.isArray(tagVocab) ? tagVocab : [];
  if (cats.length === 0) return "";
  const catList = cats.map((c) => `- ${c.slug} — ${c.name}: ${c.description || ""}`).join("\n");
  const tagList = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).join(", ");
  const sops = cats.filter((c) => c.sop).map((c) => `### ${c.name} (${c.slug})\n${c.sop}`).join("\n\n");
  return `

## Categories (slugs)
${catList}

## Tag vocabulary
${tagList || "(none)"}${sops ? `\n\n## Category SOPs (how each kind of work gets done + who to contact)\n${sops}` : ""}`;
}

export function buildSystem({ orgPrompt, org, categories, tagVocab }) {
  const internal = org?.type === "internal" || org?.slug === "vistamar";
  const orgContext = String(orgPrompt || "").replaceAll("{{meetingStyle}}", "working");
  return `You maintain the Vistamar Project Board for ONE organization: ${org?.name || org?.slug} (${org?.slug}${internal ? ", Vistamar internal" : ", client"}).
You are NOT writing a meeting agenda. Your only output is boardChanges for this organization's board.

## Organization context
This is the organization's meeting-agenda prompt. Use it for knowledge of the org, its people and priorities; ignore any instructions in it about agenda format or topics.
${orgContext || "(none)"}

## How to use the inputs
- NEW transcripts are meetings not yet turned into board changes for this org. Create tasks ONLY from these.
- CONTEXT-ONLY transcripts are internal Vistamar meetings or meetings already synced for this org. Never create a task from them alone; use them to justify moves and notes and to avoid duplicates.
- A cross-org meeting (e.g. the Monday Touch Base) covers every organization: take ONLY the parts about ${org?.name || org?.slug}.
- Use the existing tasks, recent board activity, this org's current agendas (planning context) and any user-provided context to stay consistent and avoid duplicates.

${internal ? `${VISTAMAR_BOARD_SCOPE}\n\n` : ""}### boardChanges.creates — NEW tasks
${CREATE_BASE_RULES}
- Set categories to an array with exactly ONE category SLUG from the list below (use the slug exactly), and tags from the vocabulary. Coin a NEW lowercase-hyphenated tag ONLY when nothing fits and it will recur.
${PARENT_REF_RULES}

${MOVES_RULES}

${NOTES_RULES}

Be precise, not exhaustive. Return empty arrays for any boardChanges kind with nothing to propose.${categorizationBlock(categories, tagVocab)}`;
}

const SCOPE_TAG = { "vistamar-internal": "Vistamar internal", "already-synced": "Already synced" };

function transcriptLines(lines, list, orgName, tagged) {
  list.forEach((tr) => {
    const tag = tagged ? `[${SCOPE_TAG[tr.scope] || "Context"}] ` : "";
    const cross = tr.crossOrg || tr.scope === "cross-org" ? ` [cross-org — take only ${orgName}'s parts]` : "";
    lines.push(`### ${tag}${tr.title || "Meeting"}${tr.date ? ` (${tr.date})` : ""}${cross}`);
    if (tr.overview) lines.push(`Overview: ${tr.overview}`);
    if (tr.actionItems) lines.push(`Action items: ${tr.actionItems}`);
    lines.push("");
  });
}

export function buildUserMessage({ org, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext }) {
  const orgName = org?.name || org?.slug || "this org";
  const lines = [`Propose the Project Board changes for ${orgName} from the record below.`, ""];

  lines.push("## Existing board tasks (don't duplicate for new creates; reference itemId for moves/notes)");
  (existingTasks || []).forEach((t) => lines.push(`- [itemId:${t.id}] ${t.title}${t.status ? ` [${t.status}]` : ""}${t.category ? ` (${t.category})` : ""}`));
  if (!existingTasks?.length) lines.push("(none)");
  lines.push("");

  lines.push("## NEW meeting transcripts (create tasks from these)");
  if (transcripts?.length) transcriptLines(lines, transcripts, orgName, false);
  else lines.push("(none — propose moves/notes only if the context clearly supports them)", "");

  if (contextTranscripts?.length) {
    lines.push("## CONTEXT-ONLY transcripts (never create tasks from these alone)");
    transcriptLines(lines, contextTranscripts, orgName, true);
  }

  if (projectBoard?.length) {
    lines.push("## Recent Project Board activity (last 30 days)");
    projectBoard.forEach((it) => lines.push(`- [${it.isNew ? "NEW" : "updated"}] ${it.name || "(untitled)"} (status: ${it.status || "?"})${it.project ? ` — ${it.project}` : ""}`));
    lines.push("");
  }
  if (orgAgendas?.length) {
    lines.push("## This org's current meeting agendas (planning context, don't copy)");
    orgAgendas.forEach((oa) => {
      lines.push(`### ${oa.title || "Meeting"}`);
      (oa.topics || []).forEach((t) => lines.push(`- ${t.name || ""}${t.bodyHtml ? `: ${t.bodyHtml}` : ""}`));
      lines.push("");
    });
  }
  if (extraContext && String(extraContext).trim()) {
    lines.push("## Additional context the user provided for this sync");
    lines.push(String(extraContext).trim());
  }
  return lines.join("\n");
}

export function normalizeBoardChanges(parsed) {
  const bc = parsed?.boardChanges || {};
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x)) : []);
  return {
    creates: (Array.isArray(bc.creates) ? bc.creates : [])
      .map((c) => ({
        title: String(c?.title || ""),
        note: String(c?.note || ""),
        parentRef: typeof c?.parentRef === "string" ? c.parentRef : "",
        categories: strs(c?.categories),
        tags: strs(c?.tags),
      }))
      .filter((c) => c.title),
    moves: (Array.isArray(bc.moves) ? bc.moves : [])
      .map((m) => ({ itemId: String(m?.itemId || ""), title: String(m?.title || ""), toStatus: String(m?.toStatus || ""), reason: String(m?.reason || "") }))
      .filter((m) => m.itemId && m.toStatus),
    notes: (Array.isArray(bc.notes) ? bc.notes : [])
      .map((n) => ({ itemId: String(n?.itemId || ""), title: String(n?.title || ""), note: String(n?.note || "") }))
      .filter((n) => n.itemId && n.note),
  };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;
  if (!isBoardSyncAllowed(req.authUser?.email)) {
    return res.status(403).json({ error: "Board Sync is restricted to adeemer@vistamarconsulting.com" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { org, orgPrompt, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext, categories, tagVocab } = req.body || {};
  if (!org?.slug) return res.status(400).json({ error: "Missing required field: org" });

  try {
    const client = new Anthropic({ apiKey });
    // Streamed for the same reason as prepare.js (long max_tokens trips the
    // SDK's non-streaming guard). Board-only output is smaller than Sync Meeting.
    const message = await client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: buildSystem({ orgPrompt, org, categories, tagVocab }),
      messages: [{ role: "user", content: buildUserMessage({ org, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext }) }],
    }).finalMessage();

    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "Generation was cut off (hit token limit). Retry this org." });
    if (message.stop_reason === "refusal") return res.status(502).json({ error: "The model declined this sync." });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) return res.status(502).json({ error: "The model returned no content." });

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed JSON." });
    }
    return res.status(200).json({
      boardChanges: normalizeBoardChanges(parsed),
      // Real token counts so per-run cost can be measured (logged in boardSyncLog).
      usage: { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null },
    });
  } catch (err) {
    console.error("ai/sync-board failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Board Sync failed" });
  }
}
```

- [ ] **Step 4: Route it** — in `api/ai/dispatch.js`:

```js
import generate from "./_handlers/generate.js";
import prepare from "./_handlers/prepare.js";
import refine from "./_handlers/refine.js";
import syncBoard from "./_handlers/syncBoard.js";
```

```js
const ROUTES = { generate, prepare, refine, "sync-board": syncBoard };
```

Also update the header comment line "URLs are unchanged — /api/ai/prepare, /api/ai/refine, /api/ai/generate all" to append "(+ /api/ai/sync-board, Board Sync)". Confirm `vercel.json` already rewrites `/api/ai/:action` → `grep -n "api/ai" vercel.json` (no change expected).

- [ ] **Step 5: Run, expect PASS** — `npx vitest run api/ai/_handlers/__tests__/syncBoard.test.js` and `npx vitest run api/ai/_handlers/__tests__/prepare.snapshot.test.js`.

- [ ] **Step 6: Commit**

```bash
git add api/ai/_handlers/syncBoard.js api/ai/_handlers/__tests__/syncBoard.test.js api/ai/dispatch.js
git commit -m "feat(board-sync): /api/ai/sync-board per-org handler, Andy-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Firestore rules

**Files:**
- Modify: `firestore.rules` (insert after the `/categories` / `/tags` blocks, before `match /items/{itemId}`)

- [ ] **Step 1: Add the rules**

```
    // Board Sync transcript ledger (spec 2026-10-26 §3): which Fireflies
    // transcripts each org's Sync Meeting / Board Sync already used. Written by
    // whoever runs Sync Meeting, so any active user. Never deleted.
    match /syncedTranscripts/{transcriptId} {
      allow read, create, update: if isActiveUser();
    }

    // Board Sync run log — Andy only (spec §8). Append-only.
    match /boardSyncLog/{logId} {
      allow read, create: if isActiveUser()
                          && request.auth.token.email == 'adeemer@vistamarconsulting.com';
    }
```

- [ ] **Step 2: Record as untested** — the repo has no rules emulator harness; the rules compile only at deploy (Task 11 Step 1). Note "rules untested until deploy" in the session context.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(board-sync): rules for syncedTranscripts ledger + boardSyncLog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> **Deploy order (critical):** these rules MUST be deployed before the Task 6 frontend reaches production — Task 6 makes every Sync Meeting apply write `syncedTranscripts`, and without the rule that write is denied and **Sync Meeting apply fails for everyone**. Task 11 handles this.

---

### Task 6: Sync Meeting stamps the ledger

**Files:**
- Modify: `src/lib/aiAgenda.js:171-204` (assembleGenInputs), `:419-712` (applyUnified)
- Modify: `src/components/SyncMeetingDialog.jsx` (generate + apply)

- [ ] **Step 1: Carry `id` + `mapped` on transcripts** — in `assembleGenInputs`:

master branch of the loop:

```js
    if (master) {
      if (!cls) continue;
      included.push({ ...t, _ms: d, org: cls, mapped, scope: cls === "vistamar" ? "vistamar-internal" : "this-org" });
```

and in the `transcripts.push({...})` block add, first:

```js
      id: capped[i].id,
      mapped: !!capped[i].mapped,
```

(The server prompt builders ignore these fields; they ride along for the ledger.)

- [ ] **Step 2: Stamp inside `applyUnified`'s transaction** — add to imports:

```js
import { tagSlug, syncMeetingStamps, groupStamps } from "./boardSyncCore.js";
```

(merge with the `tagSlug` import added in Task 2). Before `await runTransaction(`:

```js
  // Ledger (Board Sync spec 3.3): record which transcripts this sync used, per
  // org, so Board Sync never re-creates tasks from them. Written in the same
  // atomic commit as the changes they produced.
  const ledgerStamps = groupStamps(syncMeetingStamps(sel.transcripts, {
    targetOrg: orgSlug,
    master,
    orgSlugs: sel.orgSlugs || [],
  }));
```

In the WRITES PHASE, after the coined-tags block and before the counter write-back:

```js
    for (const [tid, orgs] of Object.entries(ledgerStamps)) {
      tx.set(doc(db, "syncedTranscripts", tid), {
        orgs: Object.fromEntries(orgs.map((o) => [o, { at: serverTimestamp(), by: "agenda", byUid: uid }])),
      }, { merge: true });
    }
```

Update the `accepted` doc comment above `applyUnified` to list `transcripts` and `orgSlugs`.

- [ ] **Step 3: Thread from the dialog** — in `SyncMeetingDialog.jsx`: add state `const [genTranscripts, setGenTranscripts] = useState([]);`; in `generate()` after `setExistingTasks(tasks || [])` add `setGenTranscripts(transcripts || []);`; in `apply()` extend `accepted`:

```js
        existingTasks, // threaded through for applyUnified's at-apply re-validation
        transcripts: genTranscripts, // ledger stamps (Board Sync spec 3.3)
        orgSlugs: (catCtx.orgMeta || []).map((o) => o.slug),
```

- [ ] **Step 4: Verify** — `npx vitest run src/lib/__tests__/syncMeeting.test.js src/lib/__tests__/boardSyncCore.test.js` → PASS. (`applyUnified` has no unit test — it's Firestore-bound; the stamp selection is covered by `syncMeetingStamps` tests. Browser check is in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiAgenda.js src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync): Sync Meeting apply stamps the transcript ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Board Sync data layer `boardSync.js`

**Files:**
- Create: `src/lib/boardSync.js`

Firestore-bound (no unit tests — the logic it composes is tested in Task 2). Verified in the browser in Task 10.

- [ ] **Step 1: Implement** `src/lib/boardSync.js`:

```js
// src/lib/boardSync.js
//
// Board Sync I/O — the Task Board's all-org sync (spec
// docs/superpowers/specs/2026-10-26-board-sync-design.md). SyncBoardDialog
// orchestrates: gatherBoardSyncInputs (pre-flight counts) → runOrgSync per
// selected org, in parallel → (review) → applyBoardSync (one transaction).
// Pure logic lives in boardSyncCore.js.
import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { generateKeyBetween } from "fractional-indexing";
import { auth, db } from "../firebase.js";
import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "./fireflies.js";
import { resolveOrgFromAttendees } from "./orgMapping.js";
import { resolvePrompt } from "./aiAgenda.js";
import { STATUS_MAP } from "./itemStatusMap.js";
import {
  LOOKBACK_MS,
  bucketTranscripts,
  boardContextForOrg,
  fetchTranscriptsSince,
  splitBucket,
  tagSlug,
  toMs,
} from "./boardSyncCore.js";

const MAX_ORG_AGENDAS = 15;
const norm = (s) => String(s || "").toLowerCase().trim();
const isoDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

// Everything the pre-flight screen needs, plus the shared context runOrgSync
// reuses. No model calls, no detail fetches (those happen per org on Run).
export async function gatherBoardSyncInputs({ now = Date.now() } = {}) {
  const sinceMs = now - LOOKBACK_MS;

  const [orgsSnap, seriesSnap, agendasSnap, catSnap, tagSnap, lastLogSnap] = await Promise.all([
    getDocs(query(collection(db, "organizations"), orderBy("sortOrder", "asc"))),
    getDocs(collection(db, "calendar_series")),
    getDocs(collection(db, "agendas")),
    getDocs(query(collection(db, "categories"), orderBy("sortOrder", "asc"))),
    getDocs(query(collection(db, "tags"), orderBy("sortOrder", "asc"))),
    getDocs(query(collection(db, "boardSyncLog"), orderBy("at", "desc"), limit(1))),
  ]);

  // Clients by sortOrder, Vistamar last — same order as master Sync Meeting.
  const orgs = orgsSnap.docs
    .map((d) => ({ slug: d.id, name: d.data().name || d.id, type: d.data().type || "client", sortOrder: d.data().sortOrder ?? 999, accentColor: d.data().accentColor || null }))
    .sort((a, b) => (a.type === "internal" ? 1 : 0) - (b.type === "internal" ? 1 : 0) || a.sortOrder - b.sortOrder);
  const orgSlugs = orgs.map((o) => o.slug);

  const seriesById = new Map(seriesSnap.docs.map((d) => [d.id, d.data()]));
  const agendas = agendasSnap.docs.map((d) => {
    const a = d.data();
    const s = seriesById.get(a.calendarSeriesId) || {};
    return {
      id: d.id,
      title: a.title || "",
      org: s.organizationId || a.organizationId || null,
      master: !!(s.masterAgenda || a.masterAgenda),
      firefliesTitles: (a.firefliesTitles || []).map(norm).filter(Boolean),
      lastUnifiedGenAt: toMs(a.lastUnifiedGenAt),
      openFloorHtml: a.openFloorHtml || "",
    };
  });
  const masterTitles = new Set(agendas.filter((a) => a.master).flatMap((a) => a.firefliesTitles));
  const titleOrgs = new Map(agendas.filter((a) => !a.master && a.org).flatMap((a) => a.firefliesTitles.map((t) => [t, a.org])));
  // Backfill thresholds (spec 3.4): latest Sync Meeting per org, master separately.
  const thresholds = {};
  let masterThreshold = 0;
  for (const a of agendas) {
    if (a.master) masterThreshold = Math.max(masterThreshold, a.lastUnifiedGenAt);
    else if (a.org) thresholds[a.org] = Math.max(thresholds[a.org] || 0, a.lastUnifiedGenAt);
  }

  const list = await fetchTranscriptsSince(firefliesQuery, GQL_MEETING_LIST, sinceMs);
  const { buckets, unclassified } = bucketTranscripts(list, {
    orgSlugs, masterTitles, titleOrgs, resolveOrg: resolveOrgFromAttendees, sinceMs,
  });

  // Ledger docs for every in-window transcript (documentId "in" caps at 30).
  const ids = [...new Set(Object.values(buckets).flat().map((t) => t.id))];
  const ledger = new Map();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, "syncedTranscripts"), where(documentId(), "in", ids.slice(i, i + 30))));
    snap.docs.forEach((d) => ledger.set(d.id, d.data()));
  }

  const ctx = { ledger, thresholds, masterThreshold };
  const perOrg = orgs.map((o) => ({ ...o, ...splitBucket(buckets[o.slug], o.slug, ctx) }));

  const lastLog = lastLogSnap.docs[0]?.data() || null;
  return {
    sinceMs,
    orgs: perOrg,
    unclassified,
    lastSyncAt: lastLog?.at?.toDate ? lastLog.at.toDate() : null,
    agendasByOrg: Object.fromEntries(orgSlugs.map((s) => [s, agendas.filter((a) => a.org === s && !a.master)])),
    categories: catSnap.docs.map((d) => ({ slug: d.id, name: d.data().name || d.id, description: d.data().description || "", sop: d.data().sop || "" })),
    tagVocab: tagSnap.docs.map((d) => ({ name: d.data().name || d.id, layer: d.data().layer || null })),
  };
}

async function fetchDetails(rows) {
  const settled = await Promise.allSettled(rows.map((t) => firefliesQuery(GQL_MEETING_DETAIL, { transcriptId: t.id })));
  const loaded = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") { failed.push(rows[i].title || rows[i].id); return; }
    const s = r.value?.transcript?.summary || {};
    loaded.push({
      id: rows[i].id,
      title: rows[i].title || "",
      date: isoDate(rows[i]._ms),
      scope: rows[i].scope,
      crossOrg: !!rows[i].crossOrg,
      overview: s.overview || s.short_overview || "",
      actionItems: s.action_items || "",
    });
  });
  return { loaded, failed };
}

// One org: detail-fetch its transcripts, build its payload, call the model.
// Throws on failure — the dialog marks the org failed and offers Retry.
export async function runOrgSync(orgEntry, gathered, items, extraContext) {
  const [fresh, context] = await Promise.all([fetchDetails(orgEntry.fresh), fetchDetails(orgEntry.context)]);
  const { projectBoard, existingTasks } = boardContextForOrg(items, orgEntry.slug, gathered.sinceMs);

  const agendas = (gathered.agendasByOrg[orgEntry.slug] || []).slice(0, MAX_ORG_AGENDAS);
  const orgAgendas = await Promise.all(agendas.map(async (a) => {
    const tSnap = await getDocs(query(collection(db, "agendas", a.id, "topics"), orderBy("sortOrder", "asc")));
    return { title: a.title, topics: tSnap.docs.map((d) => ({ name: d.data().name || "", bodyHtml: d.data().bodyHtml || "" })) };
  }));

  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/ai/sync-board", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({
      org: { slug: orgEntry.slug, name: orgEntry.name, type: orgEntry.type },
      orgPrompt: await resolvePrompt(orgEntry.slug),
      transcripts: fresh.loaded,
      contextTranscripts: context.loaded,
      projectBoard,
      existingTasks,
      orgAgendas,
      extraContext: extraContext || undefined,
      categories: gathered.categories,
      tagVocab: gathered.tagVocab,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((typeof data.error === "string" ? data.error : data.error?.message) || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    boardChanges: data.boardChanges,
    usage: data.usage || null,
    existingTasks,
    // Only transcripts the model actually read get stamped (spec 3.3).
    transcriptIds: fresh.loaded.map((t) => t.id),
    failedTranscripts: [...fresh.failed, ...context.failed],
  };
}

// Apply every done org's accepted changes + ledger stamps + run log in ONE
// transaction. Twin of applyUnified's board half (aiAgenda.js) — kept separate
// because that one is topic-bound and throws on any rejection; this one drops
// a change whose target vanished and reports it (spec 7).
//
// runs:       { [slug]: runOrgSync result }
// selections: { [slug]: { createIdxs, moveIdxs, noteIdxs, promotions: { [idx]: { statusId, assigneeIds?, categoryId, tagIds, newTags } } } }
export async function applyBoardSync(runs, selections, uid = null) {
  const slugs = Object.keys(runs);
  const tagSnap = await getDocs(collection(db, "tags"));
  const existingTagIds = new Set(tagSnap.docs.map((d) => d.id));
  const tagSort = tagSnap.size;

  // Per-org accepted subsets, with the subitem guard applyUnified uses: a child
  // whose new:N parent isn't accepted (or is itself a child) is dropped.
  const dropped = [];
  const plan = slugs.map((slug) => {
    const bc = runs[slug].boardChanges || {};
    const sel = selections[slug] || {};
    let creates = (sel.createIdxs || []).map((i) => ({ idx: i, create: bc.creates[i] })).filter((x) => x.create);
    creates = creates.filter(({ create }) => {
      const ref = create.parentRef || "";
      if (!ref.startsWith("new:")) return true;
      const parent = creates.find((x) => x.idx === parseInt(ref.slice(4), 10));
      if (parent && !parent.create.parentRef) return true;
      dropped.push({ org: slug, title: create.title, reason: parent ? "parent is itself a subitem" : "parent task not selected" });
      return false;
    });
    return {
      slug,
      creates,
      moves: (sel.moveIdxs || []).map((i) => bc.moves[i]).filter(Boolean),
      notes: (sel.noteIdxs || []).map((i) => bc.notes[i]).filter(Boolean),
      promotions: sel.promotions || {},
      refs: creates.map(() => doc(collection(db, "items"))),
    };
  });

  // Every existing item a write touches — read in the tx so a vanished item is
  // dropped instead of failing the whole commit.
  const targetIds = [...new Set(plan.flatMap((p) => [
    ...p.moves.map((m) => m.itemId),
    ...p.notes.map((n) => n.itemId),
    ...p.creates.map(({ create }) => create.parentRef || "").filter((r) => r && !r.startsWith("new:")),
  ]))];

  const counts = {};
  const preDropped = [...dropped];
  await runTransaction(db, async (tx) => {
    // ---- READS ----
    const orgSnaps = new Map();
    for (const p of plan) if (p.creates.length) orgSnaps.set(p.slug, await tx.get(doc(db, "organizations", p.slug)));
    const targets = new Map();
    for (const id of targetIds) targets.set(id, await tx.get(doc(db, "items", id)));
    const exists = (id) => targets.get(id)?.exists();

    // ---- WRITES (state rebuilt per attempt — transactions retry) ----
    dropped.length = 0;
    dropped.push(...preDropped);
    for (const k of Object.keys(counts)) delete counts[k];
    const newTagWrites = [];
    const coin = (name) => {
      const id = tagSlug(name);
      if (!id) return null;
      if (!existingTagIds.has(id) && !newTagWrites.find((w) => w.id === id)) newTagWrites.push({ id, name });
      return id;
    };
    const stamps = {};

    for (const p of plan) {
      let num = orgSnaps.get(p.slug)?.data()?.nextItemNumber ?? 1;
      let order = null;
      const parentPositions = new Set(p.creates
        .map(({ create }) => create.parentRef || "")
        .filter((r) => r.startsWith("new:"))
        .map((r) => p.creates.findIndex((x) => x.idx === parseInt(r.slice(4), 10))));
      const existingParents = new Set();
      let created = 0;

      p.creates.forEach(({ idx, create }, pos) => {
        const ref = create.parentRef || "";
        let parentId = null;
        if (ref.startsWith("new:")) {
          parentId = p.refs[p.creates.findIndex((x) => x.idx === parseInt(ref.slice(4), 10))].id;
        } else if (ref) {
          if (!exists(ref)) { dropped.push({ org: p.slug, title: create.title, reason: "parent item no longer exists" }); return; }
          parentId = ref;
          existingParents.add(ref);
        }
        const promo = p.promotions[idx] || {};
        const tagIds = [...new Set([...(promo.tagIds || []), ...(promo.newTags || []).map(coin).filter(Boolean)])];
        order = generateKeyBetween(order, null);
        tx.set(p.refs[pos], {
          organizationId: p.slug,
          parentId,
          hasChildren: parentPositions.has(pos),
          type: "task",
          title: String(create.title || ""),
          description: String(create.note || ""),
          statusId: promo.statusId ?? 8,
          priorityId: null,
          categoryId: promo.categoryId ?? null,
          tagIds,
          dueDate: null,
          completedAt: null,
          assigneeIds: Array.isArray(promo.assigneeIds) ? promo.assigneeIds : [],
          itemNumber: num,
          createdBy: uid || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          order,
        });
        num += 1;
        created += 1;
      });
      existingParents.forEach((id) => tx.update(doc(db, "items", id), { hasChildren: true, updatedAt: serverTimestamp() }));
      if (orgSnaps.has(p.slug)) tx.set(doc(db, "organizations", p.slug), { nextItemNumber: num }, { merge: true });

      let moved = 0;
      p.moves.forEach((m) => {
        const sid = STATUS_MAP[m.toStatus];
        if (!sid) { dropped.push({ org: p.slug, title: m.title, reason: `unknown status ${m.toStatus}` }); return; }
        if (!exists(m.itemId)) { dropped.push({ org: p.slug, title: m.title, reason: "item no longer exists" }); return; }
        tx.update(doc(db, "items", m.itemId), {
          statusId: sid,
          completedAt: sid === STATUS_MAP.Done ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
          updatedByUid: uid,
        });
        moved += 1;
      });

      let noted = 0;
      p.notes.forEach((n) => {
        if (!exists(n.itemId)) { dropped.push({ org: p.slug, title: n.title, reason: "item no longer exists" }); return; }
        const cur = targets.get(n.itemId).data().description || "";
        if (cur.includes(n.note)) return;
        tx.update(doc(db, "items", n.itemId), {
          description: `${cur ? `${cur}\n` : ""}— ${n.note}`,
          updatedAt: serverTimestamp(),
          updatedByUid: uid,
        });
        noted += 1;
      });

      (runs[p.slug].transcriptIds || []).forEach((tid) => {
        if (!stamps[tid]) stamps[tid] = [];
        stamps[tid].push(p.slug);
      });
      counts[p.slug] = { created, moved, noted, transcriptIds: runs[p.slug].transcriptIds || [], usage: runs[p.slug].usage || null };
    }

    newTagWrites.forEach((w, i) => {
      tx.set(doc(db, "tags", w.id), { name: w.name, color: "#8b5cf6", layer: 3, sortOrder: tagSort + i + 1, createdAt: serverTimestamp(), createdByUid: uid });
    });
    for (const [tid, orgs] of Object.entries(stamps)) {
      tx.set(doc(db, "syncedTranscripts", tid), {
        orgs: Object.fromEntries(orgs.map((o) => [o, { at: serverTimestamp(), by: "board", byUid: uid }])),
      }, { merge: true });
    }
    tx.set(doc(collection(db, "boardSyncLog")), { at: serverTimestamp(), byUid: uid, orgs: counts, newTags: newTagWrites.length });
  });

  return { counts, dropped };
}
```

- [ ] **Step 2: Compile check** — the repo has no ESLint config, so don't lint. Run `npx vite build` once to confirm the module graph compiles (not in parallel with tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/boardSync.js
git commit -m "feat(board-sync): gather, per-org run, atomic apply with ledger + log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `SyncBoardDialog`

**Files:**
- Create: `src/components/SyncBoardDialog.jsx`

- [ ] **Step 1: Implement**

```jsx
// Board Sync dialog (Task Board, Andy only). Pre-flight lists every org with
// its NEW transcript count (orgs with nothing new start unticked) → Run fires
// one /api/ai/sync-board call per ticked org in parallel → one review grouped
// by org (each org done / failed + Retry) → Apply writes every done org in one
// transaction. Spec: docs/superpowers/specs/2026-10-26-board-sync-design.md.
import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { gatherBoardSyncInputs, runOrgSync, applyBoardSync } from "../lib/boardSync.js";
import { initPromotion } from "../lib/boardSyncCore.js";
import { validateProposal } from "../lib/syncMeeting.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import ProposedBoardRow from "./ProposedBoardRow.jsx";

const STATUS_BY_ID = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s]));

function idxSet(list, keep) {
  const out = new Set();
  (list || []).forEach((x, i) => { if (keep.has(x)) out.add(i); });
  return out;
}

export default function SyncBoardDialog({ items, users, categories, tags, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("loading"); // loading | preflight | review | applying | done
  const [error, setError] = useState(null);
  const [gathered, setGathered] = useState(null);
  const [included, setIncluded] = useState(() => new Set());
  const [extraContext, setExtraContext] = useState("");
  // Per org: { status: "running" | "done" | "failed", error?, result?, valid?, sel?, promotions? }
  const [runs, setRuns] = useState({});
  const [applyResult, setApplyResult] = useState(null);

  useEffect(() => {
    gatherBoardSyncInputs()
      .then((g) => {
        setGathered(g);
        setIncluded(new Set(g.orgs.filter((o) => o.fresh.length > 0).map((o) => o.slug)));
        setStep("preflight");
      })
      .catch((err) => { setError(err.message || "Couldn't load sync inputs"); setStep("preflight"); });
  }, []);

  const itemsById = useMemo(() => new Map((items || []).map((it) => [it.id, it])), [items]);
  const orgBySlug = useMemo(() => new Map((gathered?.orgs || []).map((o) => [o.slug, o])), [gathered]);

  const runOne = async (slug) => {
    setRuns((prev) => ({ ...prev, [slug]: { status: "running" } }));
    try {
      const result = await runOrgSync(orgBySlug.get(slug), gathered, items, extraContext.trim());
      const v = validateProposal({ topics: [], boardChanges: result.boardChanges, existingTasks: result.existingTasks, requireTopic: false });
      const bc = result.boardChanges;
      const valid = { creates: idxSet(bc.creates, new Set(v.acceptedCreates)), moves: idxSet(bc.moves, new Set(v.acceptedMoves)), notes: idxSet(bc.notes, new Set(v.acceptedNotes)) };
      const promotions = {};
      valid.creates.forEach((i) => { promotions[i] = initPromotion(bc.creates[i], { categories, tags, users }); });
      setRuns((prev) => ({
        ...prev,
        [slug]: { status: "done", result, validation: v, valid, sel: { creates: new Set(valid.creates), moves: new Set(valid.moves), notes: new Set(valid.notes) }, promotions },
      }));
    } catch (err) {
      setRuns((prev) => ({ ...prev, [slug]: { status: "failed", error: err.message || "Failed" } }));
    }
  };

  const runAll = () => {
    setError(null);
    setStep("review");
    [...included].forEach((slug) => runOne(slug));
  };

  const toggleSel = (slug, kind, i) => setRuns((prev) => {
    const r = prev[slug];
    if (!r.valid[kind].has(i)) return prev;
    const next = new Set(r.sel[kind]);
    if (next.has(i)) next.delete(i); else next.add(i);
    return { ...prev, [slug]: { ...r, sel: { ...r.sel, [kind]: next } } };
  });

  const setCreateField = (slug) => (idx, field, value) => setRuns((prev) => {
    const r = prev[slug];
    const creates = [...r.result.boardChanges.creates];
    creates[idx] = { ...creates[idx], [field]: value };
    return { ...prev, [slug]: { ...r, result: { ...r.result, boardChanges: { ...r.result.boardChanges, creates } } } };
  });

  const updatePromotion = (slug) => (idx, patch) => setRuns((prev) => {
    const r = prev[slug];
    return { ...prev, [slug]: { ...r, promotions: { ...r.promotions, [idx]: { ...(r.promotions[idx] || {}), ...patch } } } };
  });

  // Drop a coined tag from every create in this org (it won't be added).
  const removeNewTag = (slug, name) => setRuns((prev) => {
    const r = prev[slug];
    const promotions = Object.fromEntries(Object.entries(r.promotions).map(([i, p]) => [i, { ...p, newTags: (p.newTags || []).filter((t) => t !== name) }]));
    return { ...prev, [slug]: { ...r, promotions } };
  });

  const runEntries = Object.entries(runs);
  const anyRunning = runEntries.some(([, r]) => r.status === "running");
  const doneSlugs = runEntries.filter(([, r]) => r.status === "done").map(([s]) => s);

  const apply = async () => {
    setStep("applying");
    setError(null);
    try {
      const doneRuns = {};
      const selections = {};
      doneSlugs.forEach((slug) => {
        const r = runs[slug];
        doneRuns[slug] = r.result;
        const createIdxs = [...r.sel.creates];
        const promotions = {};
        createIdxs.forEach((i) => { promotions[i] = r.promotions[i]; });
        selections[slug] = { createIdxs, moveIdxs: [...r.sel.moves], noteIdxs: [...r.sel.notes], promotions };
      });
      setApplyResult(await applyBoardSync(doneRuns, selections, user?.uid || null));
      setStep("done");
    } catch (err) {
      setError(err.message || "Apply failed");
      setStep("review");
    }
  };

  const renderOrg = (slug) => {
    const org = orgBySlug.get(slug);
    const r = runs[slug];
    const accent = org?.accentColor || "#888";
    const bc = r.result?.boardChanges;
    const v = r.validation;
    return (
      <Box key={slug} sx={{ mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5, px: 1, borderLeft: `4px solid ${accent}`, bgcolor: `${accent}14`, borderRadius: 0.5, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>{org?.name || slug}</Typography>
          {r.status === "running" && <CircularProgress size={16} />}
          {r.status === "done" && (
            <Typography variant="caption" color="text.secondary">
              {bc.creates.length} new · {bc.moves.length} moves · {bc.notes.length} notes
            </Typography>
          )}
          {r.status === "failed" && <Button size="small" onClick={() => runOne(slug)}>Retry</Button>}
        </Box>
        {r.status === "failed" && <Alert severity="error">{r.error}</Alert>}
        {r.status === "done" && (
          <Box>
            {r.result.failedTranscripts.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>Couldn't load: {r.result.failedTranscripts.join(", ")} — not used, not marked synced.</Alert>
            )}
            {v.hasRejections && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Dropped: {[...v.rejectedCreates.map((c) => `"${c.title}" (${c.reason})`), ...v.droppedMoves.map((m) => `move "${m.title}" (${m.reason})`), ...v.droppedNotes.map((n) => `note "${n.title}" (${n.reason})`)].join("; ")}
              </Alert>
            )}
            {bc.creates.length + bc.moves.length + bc.notes.length === 0 && (
              <Typography variant="body2" color="text.secondary">No changes proposed.</Typography>
            )}
            {bc.creates.map((c, i) => (r.valid.creates.has(i) ? (
              <ProposedBoardRow
                key={`c${i}`}
                create={c}
                idx={i}
                isChecked={r.sel.creates.has(i)}
                onToggle={() => toggleSel(slug, "creates", i)}
                promotion={r.promotions[i]}
                onUpdateCreate={setCreateField(slug)}
                onUpdatePromotion={updatePromotion(slug)}
                itemsById={itemsById}
                creates={bc.creates}
                users={users || []}
                categories={categories || []}
                tags={tags || []}
              />
            ) : null))}
            {(() => {
              const coined = [...new Set(bc.creates.flatMap((c, i) => (r.sel.creates.has(i) ? r.promotions[i]?.newTags || [] : [])))];
              if (!coined.length) return null;
              return (
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">New tags to add:</Typography>
                  {coined.map((name) => (
                    <Chip key={name} label={name} size="small" variant="outlined" onDelete={() => removeNewTag(slug, name)} />
                  ))}
                </Box>
              );
            })()}
            {bc.moves.map((m, i) => (r.valid.moves.has(i) ? (
              <Box key={`m${i}`} sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.5, opacity: r.sel.moves.has(i) ? 1 : 0.5 }}>
                <Checkbox size="small" checked={r.sel.moves.has(i)} onChange={() => toggleSel(slug, "moves", i)} sx={{ p: 0.25 }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600 }} noWrap>{m.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {STATUS_BY_ID[itemsById.get(m.itemId)?.statusId]?.name || "?"} → {m.toStatus}
                </Typography>
              </Box>
            ) : null))}
            {bc.notes.map((n, i) => (r.valid.notes.has(i) ? (
              <Box key={`n${i}`} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.5, opacity: r.sel.notes.has(i) ? 1 : 0.5 }}>
                <Checkbox size="small" checked={r.sel.notes.has(i)} onChange={() => toggleSel(slug, "notes", i)} sx={{ p: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{n.note}</Typography>
                </Box>
              </Box>
            ) : null))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Dialog
      open
      // Never dismiss on backdrop/Escape — a stray click would discard paid
      // proposals. Closes only via the explicit buttons.
      onClose={(_e, reason) => { if (reason === "backdropClick" || reason === "escapeKeyDown") return; onClose(); }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>Sync Board — all organizations</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {step === "loading" && (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Reading the last 30 days of meetings and the sync ledger…</Typography>
          </Stack>
        )}

        {step === "preflight" && gathered && (
          <Box>
            <Typography variant="caption" sx={{ display: "block", mb: 1.5, color: gathered.lastSyncAt ? "text.secondary" : "warning.main" }}>
              {gathered.lastSyncAt
                ? `Last Board Sync ${format(gathered.lastSyncAt, "MMM d, yyyy · h:mm a")} (${formatDistanceToNow(gathered.lastSyncAt, { addSuffix: true })}).`
                : "No Board Sync yet."}
              {" "}New = meetings in the last 30 days not yet synced for that org.
            </Typography>
            {gathered.orgs.map((o) => (
              <Box key={o.slug} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                <Checkbox
                  size="small"
                  checked={included.has(o.slug)}
                  onChange={() => setIncluded((prev) => { const n = new Set(prev); if (n.has(o.slug)) n.delete(o.slug); else n.add(o.slug); return n; })}
                />
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: o.accentColor || "#888" }} />
                <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{o.name}</Typography>
                <Typography variant="caption" color={o.fresh.length ? "text.primary" : "text.secondary"}>
                  {o.fresh.length ? `${o.fresh.length} new` : "nothing new"} · {o.context.length} context
                  {o.droppedNew ? ` · ${o.droppedNew} older not included` : ""}
                </Typography>
              </Box>
            ))}
            {gathered.unclassified > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {gathered.unclassified} meeting(s) couldn't be matched to an org and are not included.
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />
            <TextField
              label="Additional context (sent to every org)"
              placeholder="e.g. “Blog A published Friday; Unio paused the GBP work.”"
              multiline
              minRows={3}
              fullWidth
              size="small"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
            />
          </Box>
        )}

        {(step === "review" || step === "applying") && (
          <Box>{[...included].map(renderOrg)}</Box>
        )}

        {step === "done" && applyResult && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>Board Sync applied.</Alert>
            {Object.entries(applyResult.counts).map(([slug, c]) => (
              <Typography key={slug} variant="body2">
                <strong>{orgBySlug.get(slug)?.name || slug}</strong>: {c.created} created · {c.moved} moved · {c.noted} noted
              </Typography>
            ))}
            {applyResult.dropped.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Not applied: {applyResult.dropped.map((d) => `${orgBySlug.get(d.org)?.name || d.org} — "${d.title}" (${d.reason})`).join("; ")}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === "done" ? (
          <Button variant="contained" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={step === "applying"}>{step === "review" ? "Discard" : "Cancel"}</Button>
            {step === "preflight" && (
              <Button variant="contained" onClick={runAll} disabled={!gathered || included.size === 0}>
                Run ({included.size} org{included.size === 1 ? "" : "s"})
              </Button>
            )}
            {(step === "review" || step === "applying") && (
              <Button variant="contained" onClick={apply} disabled={anyRunning || doneSlugs.length === 0 || step === "applying"}>
                {step === "applying" ? <CircularProgress size={18} color="inherit" /> : `Apply ${doneSlugs.length} org${doneSlugs.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
```

Note on "applies done orgs, ignores failed ones": a failed org's transcripts are never stamped, because `applyBoardSync` only receives done runs.

- [ ] **Step 2: Compile check** — no ESLint config in this repo; the dialog compiles as part of Task 9's page test and Task 10's build.

- [ ] **Step 3: Commit**

```bash
git add src/components/SyncBoardDialog.jsx
git commit -m "feat(board-sync): Sync Board dialog — pre-flight, per-org review, apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Task Board button + AI Integration docs

**Files:**
- Modify: `src/pages/TaskBoard.jsx:41-47` (icons import), `:756-764` (header), end of JSX (dialog)
- Modify: `src/pages/AIIntegration.jsx:49-…` (`HOW_IT_WORKS`)

- [ ] **Step 1: TaskBoard** — add imports:

```js
import { Sync as SyncIcon } from "@mui/icons-material";
import SyncBoardDialog from "../components/SyncBoardDialog.jsx";
import { canBoardSync } from "../lib/boardSyncCore.js";
```

(merge `Sync as SyncIcon` into the existing `@mui/icons-material` import block instead of a second import). State next to the other dialog state: `const [syncBoardOpen, setSyncBoardOpen] = useState(false);`

Header:

```jsx
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" component="h1">Project Board</Typography>
        <Stack direction="row" spacing={1}>
          {canBoardSync(user?.email) && (
            <Button variant="outlined" startIcon={<SyncIcon />} onClick={() => setSyncBoardOpen(true)}>
              Sync Board
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOrgPickerOpen(true)}
          >
            New item
          </Button>
        </Stack>
      </Stack>
```

Before the outer `</Stack>` closing the page, add:

```jsx
      {syncBoardOpen && (
        <SyncBoardDialog
          items={allItems}
          users={users}
          categories={categories}
          tags={tags}
          onClose={() => setSyncBoardOpen(false)}
        />
      )}
```

- [ ] **Step 2: AIIntegration** — append to the `"Guardrails (always on)"` group's items:

```js
      ["Sync ledger", "Each Sync Meeting apply records which meetings it used, per org, so Board Sync never re-creates tasks from them."],
```

and append a new group at the end of `HOW_IT_WORKS`:

```js
  {
    group: "Board Sync (Task Board · Andy only)",
    items: [
      ["What it does", "One run proposes new tasks, status moves and notes for every org's board from the same sources as Sync Meeting. It never touches an agenda."],
      ["What counts as new", "Fireflies meetings from the last 30 days not yet used for that org. A shared ledger records which meetings each Sync Meeting or Board Sync already turned into board changes, per org. Meetings from before the ledger count as used if they predate that org's last Sync Meeting."],
      ["Touch Base", "Meetings mapped to the master (Touch Base) agenda feed every org's run; each org takes only its own parts."],
      ["Context only", "Internal Vistamar meetings (for client boards) and already-used meetings are read for moves, notes and duplicate checks, but never create tasks."],
      ["One call per org", "Orgs run in parallel; orgs with nothing new are skipped unless ticked. One review grouped by org; one atomic apply. A failed org can be retried and its meetings stay unused."],
      ["Access", "Only adeemer@vistamarconsulting.com — the button is hidden for everyone else and the server refuses other accounts."],
    ],
  },
```

- [ ] **Step 3: Run existing page test** — `npx vitest run src/pages/__tests__/TaskBoard.expandAll.test.jsx` → PASS. (That test mocks `firebase.js` as `{ db: {} }`; the new import chain reaches `auth` only lazily, so it should still pass. `canBoardSync(undefined)` is false. Investigate any failure with superpowers:systematic-debugging; don't patch the test blindly.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/TaskBoard.jsx src/pages/AIIntegration.jsx
git commit -m "feat(board-sync): Sync Board button (Andy only) + AI Integration rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verification (free — no AI call)

- [ ] **Step 1: Full suite** — `npm test` → all pass. Record counts in the session context.
- [ ] **Step 2: Build** — `npx vite build` → succeeds (run after tests finish, not in parallel).
- [ ] **Step 3: Pre-push review** — superpowers:requesting-code-review over the branch diff; address findings.
- [ ] **Step 4: Browser (agent-browser, Andy's login, port 5173)** — per memory `reference_agent_browser_launch.md`:
  - Task Board shows **Sync Board** for Andy.
  - Click it → pre-flight loads: every org listed with new/context counts; orgs with 0 new unticked; last-sync line; unclassified note if any. **Stop here — do not click Run.** (Run calls Anthropic.)
  - Note: until Task 11's rules deploy, the pre-flight's `boardSyncLog` / `syncedTranscripts` reads are denied on the live Firestore and pre-flight will show a permission error. If so, record that and verify pre-flight after the rules deploy.
  - Screenshot to the session scratchpad, not the repo.
- [ ] **Step 5: Update** `dev/sessions/v0_4_19_Andrew_BOARD_SYNC/context.md` with results; kill the dev server and browser.

---

### Task 11: Shared-state steps — each needs Andy's explicit yes

- [ ] **Step 0: Set `LEDGER_EPOCH_MS`** in `src/lib/boardSyncCore.js` to the actual time the rules + Sync Meeting stamping go live; commit.
- [ ] **Step 1: Deploy rules** (ask first): `firebase deploy --only firestore:rules --project management-db9eb`. Must happen **before** pushing Task 6 to `origin/dev` (see Task 5 note).
- [ ] **Step 2: Re-run Task 10 Step 4** pre-flight in the browser.
- [ ] **Step 3: Priced live run** (ask first, with this estimate — unmeasured): one Sonnet 4.6 call per ticked org, roughly $0.15–0.30 each → about $1–3 for all orgs. Run → review → apply on a real sync; then check: items created, `syncedTranscripts` stamps for applied orgs only, `boardSyncLog` doc with real `usage` token counts. Report the measured cost.
- [ ] **Step 4: Ledger round-trip** — immediately open Sync Board again: the orgs just applied should show 0 new (their transcripts now context). Confirms no double creation.
- [ ] **Step 5: Push** (ask first): `git pull --rebase origin dev && git push origin HEAD:dev`.
