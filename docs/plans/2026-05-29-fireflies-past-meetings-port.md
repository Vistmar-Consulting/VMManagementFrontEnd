# Fireflies Past Meetings — Port Brief

**Author:** Claude (Console session, with Andy)
**Date:** 2026-05-29
**For:** Claude session running in `~/Vistamar_Consulting/VMManagementFrontEnd/` (active session `v0_2_0_Andrew_MEETING_SCHEDULER`)
**Status:** Approved by Andy. Begin after reading this end-to-end + reading the archive sources it references.

---

## TL;DR

The Console PM module's Agenda detail view had a polished "Past Meetings" card on the sidebar that pulled past Fireflies recordings, matched them to the open Agenda via a title-mapping lookup, and offered a deep-search-able modal with the meeting summary, action items, decisions, and full timestamped transcript. Andy wants the same surface ported into Management's Agenda detail page.

What you're porting:

1. **`PastMeetingsCard`** — sidebar card with search bar, title-filter pills, list of matched past meetings (~270 lines)
2. **`MeetingDetailModal`** — per-meeting deep view: summary, action items, decisions, expandable transcript with speaker labels + timestamps, in-modal search with next-match navigation (~600 lines)
3. **Fireflies GraphQL client** — three queries (list, detail, sentences) + `firefliesQuery()` fetch helper + dev proxy (~70 lines)
4. **Title-mapping lookup** — how an Agenda doc declares which Fireflies meeting titles belong to it

What Andy already flagged: "I'm not sure how best to do this in the new Management app, but I'll figure this out there." Translation: pick a defensible default lookup model in this brief; he'll iterate.

This is **V2.2 active-session work** (the current `v0_2_0_Andrew_MEETING_SCHEDULER` session is mid-Agenda build per commits `V2.2.2.*`). Add it to that session's `context.md`. Do not create a separate HANDOFF or DEFERRED file — per the 2026-05-29 single-source convention.

---

## Sources of Truth — Read These Before Coding

1. **Archive — the actual Console code, frozen verbatim:**
   `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`
   - `src/pages/pages/Agenda.jsx`:
       - Lines **109–173** — Fireflies API setup: dev proxy + auth helper + 3 GraphQL queries (GQL_MEETING_LIST, GQL_MEETING_DETAIL, GQL_TRANSCRIPT_SENTENCES)
       - Lines **175–230** — timestamp helpers: `parseTimestampRange()`, `formatTimestamp()`
       - Lines **2861–~3469** — `MeetingDetailModal` (~600 lines): summary, action items, decisions, transcript expand, in-modal search with next/prev match cycling, markdown rendering with timestamp click-to-jump
       - Lines **3470–~3740** — `PastMeetingsCard` (~270 lines): list, title-filter pills, search, prefetch loop, click → modal
       - Line **2849** — usage site in the Agenda page render tree
       - Line **4366–4370** — how titles flow from the lookup hook to the card props
   - `src/hooks/useAgendaStore.js`:
       - Line **350–352** — `useFirefliesMeetings(orgId)` — the lookup hook (org-scoped)
       - Plus the `agenda-fireflies-{orgId}` localStorage adapter pattern (review the `useAgendaTable` helper)
   - `src/pages/pages/pmAgenda.js`:
       - Lines **199–~210** — `SEED_FIREFLIES_MEETINGS` — shape + 4 real examples (Unio Weekly Marketing, BMD Marketing, GV-Vistamar Bi-Weekly, etc.)

2. **Feature memory:**
   `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/dev/feature_memory/Meeting_Agendas.md` — Agenda lifecycle context; Past Meetings card is the right-rail section there.

3. **Memory (already loaded in your context):**
   - `project_fireflies_upgrade.md` — VM upgraded to Fireflies **Business** on 2026-04-06: unlimited storage, 60 req/min API
   - `project_silent_proxies.md` — Fireflies's bot guest is `fred@fireflies.ai`; the silent calendar proxy at `seo@vistamarconsulting.com` is "Vistamar SEO" in the recording. Neither is rendered in the FE.

**Read order recommendation:** archive Agenda.jsx lines 109–173 (API + queries) → 2861–3469 (modal) → 3470–3740 (card) → useAgendaStore Fireflies hook → pmAgenda.js seed shape. Then this brief's "Lookup Model" section. Then start.

---

## What the Card Does — UX Specification

**Where it lives:** right-rail section on the Agenda detail page. In archive, it's `<Section $delay={6}>` inside `AgendaDetail` with the section header **"Past Meetings"** and a count pill in copper accent.

**Empty state:** if the open agenda has zero linked Fireflies titles, the card is **hidden entirely**. No "no matches" placeholder.

**Loading:** on first fetch (no localStorage cache), shows spinner; once cached, instant.

**Layout:**
- **Search field** at top (icon + placeholder "Search past meetings...") with clear-X when typed
- **Title filter pills** below — small chips with `title (count)`, copper bg when active, click toggles, multiple titles allowed when an agenda has multiple linked Fireflies meeting titles
- **Meeting rows** below — sorted by date descending (Fireflies API default)
  - Per-row: date (e.g. "May 15, 2026") + title + 1-line summary snippet
  - Hover → background tint
  - Click → opens `MeetingDetailModal`

**Search behavior** is the standout polish:
- Substring match across: title, snippet, formatted date, AND every prefetched meeting's overview/action_items/keywords/topics_discussed/bullet_gist
- Highlighted matches with amber background pills
- The card prefetches **every matched meeting's details in batches of 10 in parallel on mount**, so the deep search has a populated cache to scan

**Modal (per-meeting):**
- Header: title + date + duration
- Tab/section: **Overview** (markdown-rendered: bullet lists, bold, line breaks)
- **Action Items** — bulleted list
- **Decisions** (from `outline` or `shorthand_bullet`) — bulleted list
- **Transcript** — collapsed by default; click "Show transcript" to expand
   - Sentences with speaker labels + timestamps
   - Timestamps in text body (like "Discussed Q3 plan (12:45)") become clickable links that jump to the matching sentence
- **In-modal search** with input field at top
   - Searches all summary fields + transcript
   - Shows "Match N of M" counter + Up/Down arrows to cycle through matches
   - Active match highlighted in amber; non-active matches highlighted in light yellow
   - Auto-scroll active match into view

---

## What Survives the Port (Verbatim or Near-Verbatim)

| Archive | Port Target | Notes |
|---|---|---|
| `firefliesQuery()` helper | `src/lib/fireflies.js` | Verbatim. Same Bearer-key fetch pattern. |
| `GQL_MEETING_LIST`, `GQL_MEETING_DETAIL`, `GQL_TRANSCRIPT_SENTENCES` | `src/lib/fireflies.js` | Verbatim. |
| `parseTimestampRange()`, `formatTimestamp()` | `src/lib/fireflies.js` (or `src/utils/transcript.js`) | Verbatim. |
| `PastMeetingsCard` component | `src/components/PastMeetingsCard.jsx` | Port shape; rewire data source for titles (see Lookup Model). |
| `MeetingDetailModal` component | `src/components/MeetingDetailModal.jsx` | Port verbatim. Pure presentational over Fireflies API + localStorage cache; no Firestore deps. |
| localStorage cache pattern (`fireflies-meetings-cache`, `fireflies-detail-{id}`, `fireflies-sentences-{id}`) | same | Survive page refresh. Don't replace with Firestore — Fireflies-side data isn't ours to canonicalize. |
| React Query `staleTime: Infinity`, `retry: 0` | same | The cache invalidates on browser cache clear or a future explicit "refresh" button. |
| Prefetch-in-parallel-batches-of-10 | same | Critical for deep search responsiveness. |

---

## What Changes (camelCase + Firestore-Native)

### Title-mapping lookup

Archive's `useFirefliesMeetings(orgId)` reads localStorage rows `{ Id, Org_Id, Agenda_Id, Fireflies_Meeting_Title }`. We're not using localStorage and we're not using PascalCase.

**Pick Option 1 unless Andy says otherwise.**

#### Option 1: `firefliesTitles: string[]` field on the agenda doc *(recommended)*

```js
// agendas/{agendaId} document shape:
{
  organizationId: "unio",
  title: "Unio Weekly Marketing",
  // ... existing fields
  firefliesTitles: [
    "Unio Weekly Marketing Meeting",
    "Unio Marketing Sync",
  ],
}
```

- The Agenda detail page reads `agenda.firefliesTitles` and passes it as a prop into `<PastMeetingsCard firefliesTitles={agenda.firefliesTitles || []} />`.
- Mapping UX: a "Linked Fireflies meetings" subsection in the Agenda settings/edit form — text input + Add button → list of current titles each with × to remove.
- Pros: simplest read path, inherits agenda's security rules, no extra subscription, mapping lifecycle naturally tied to agenda lifecycle.
- Cons: same Fireflies title repeated across multiple agendas means typing it twice. Acceptable for V2.2.

#### Option 2: subcollection on agenda

`agendas/{agendaId}/firefliesMappings/{mappingId}` with `{ title }` per doc.
- Pros: room for per-mapping metadata later (regex, filter, label).
- Cons: overkill for V2.2 — and reading them is an extra subscription per agenda detail mount.

#### Option 3: top-level lookup collection *(matches archive shape exactly)*

`firefliesMappings/{id}` with `{ organizationId, agendaId, firefliesMeetingTitle }`.
- Pros: matches archive's `pmAgenda.js` `SEED_FIREFLIES_MEETINGS` shape; lets you query "all agendas this title maps to".
- Cons: separate collection + separate security rules + extra subscription. Org-scoped query needs a composite index on `(organizationId, agendaId)`.

**Recommendation: Option 1.** Andy's prior callout was "I'll figure this out there" — start simple and let him reshape if he hits a wall. If/when he wants to migrate to Option 3, it's a one-pass script.

### Data shape (Fireflies → camelCase)

The Fireflies API itself returns camelCase / snake_case mixed. **Don't rewrite Fireflies's API response shape** — those queries return Fireflies's data verbatim. Only the *lookup table* uses our naming.

### React Query

Keep using TanStack React Query for Fireflies fetches (it's already in `package.json`). React Query is for HTTP/callable-function flows in this stack; Firestore listeners are for Firestore. This is HTTP. Don't try to channel Fireflies through Firestore.

### Hook replacements

| Archive hook | Management replacement |
|---|---|
| `useFirefliesMeetings(orgId)` | (no hook needed) — just read `agenda.firefliesTitles` off the agenda doc you're already subscribed to |
| `useQuery({ queryKey: ["fireflies-meetings-all"] ... })` | same — keep React Query verbatim |
| `useQuery({ queryKey: ["fireflies-transcript", id] ... })` | same |
| `useQuery({ queryKey: ["fireflies-sentences", id] ... })` | same |

---

## File-by-File Port

### 1. `src/lib/fireflies.js` (NEW)

```js
// src/lib/fireflies.js
// Fireflies GraphQL client. Reads VITE_FIREFLIES_KEY from env.

const FIREFLIES_URL = import.meta.env.DEV
  ? "/fireflies-api/graphql"
  : "https://api.fireflies.ai/graphql";

const FIREFLIES_KEY = import.meta.env.VITE_FIREFLIES_KEY;

export async function firefliesQuery(query, variables = {}) {
  const res = await fetch(FIREFLIES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIREFLIES_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Fireflies API error: ${res.status} — ${errBody}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export const GQL_MEETING_LIST = `
  query Transcripts($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {
      id title date duration
      participants
      meeting_attendees { email displayName }
    }
  }
`;

export const GQL_MEETING_DETAIL = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id title date duration
      summary {
        overview short_overview bullet_gist
        action_items outline shorthand_bullet
        keywords topics_discussed
      }
    }
  }
`;

export const GQL_TRANSCRIPT_SENTENCES = `
  query TranscriptSentences($transcriptId: String!) {
    transcript(id: $transcriptId) {
      duration
      sentences {
        index speaker_name text start_time end_time
      }
      speakers { id name }
    }
  }
`;

// Timestamp helpers — port verbatim from archive Agenda.jsx:175-230
export function parseTimestampRange(text) { /* see archive */ }
export function formatTimestamp(secs) { /* see archive */ }
```

### 2. `src/components/MeetingDetailModal.jsx` (NEW)

Port from archive `Agenda.jsx` lines 2861–~3469. ~600 lines. Almost entirely UI + React Query + localStorage. No data-layer changes needed.

Imports to swap:
- `import { firefliesQuery, GQL_MEETING_DETAIL, GQL_TRANSCRIPT_SENTENCES, formatTimestamp } from "../lib/fireflies.js";`

Theme tokens (`t.copper`, `t.copperFaint`, `t.cream`, etc.) — pull from your theme. The archive used a `t` const for these; in Management, either continue that pattern via a small `theme/tokens.js` re-export or inline the color values. Confirm which with Andy's recent theme port.

### 3. `src/components/PastMeetingsCard.jsx` (NEW)

Port from archive `Agenda.jsx` lines 3470–~3740. ~270 lines.

Imports to swap:
- `import { firefliesQuery, GQL_MEETING_LIST, GQL_MEETING_DETAIL } from "../lib/fireflies.js";`
- `import MeetingDetailModal from "./MeetingDetailModal.jsx";`

Props:
- `firefliesTitles: string[]` — the agenda's linked titles (from `agenda.firefliesTitles`)

The card filters Fireflies's `transcripts` list by exact title match against `firefliesTitles`. Exact match means the lookup string MUST be the exact Fireflies-side title (case-sensitive). Document this in the mapping UX so Andy knows to copy-paste from Fireflies, not freehand.

### 4. `src/pages/AgendaDetail.jsx` (EDIT)

Add the card to the right-rail render tree where the Agenda sections live:

```jsx
{agenda?.firefliesTitles?.length > 0 && (
  <PastMeetingsCard firefliesTitles={agenda.firefliesTitles} />
)}
```

(Guard so it doesn't render at all when no mappings exist.)

### 5. `src/pages/AgendaSettings.jsx` (EDIT or NEW — wherever agenda editing lives)

Add the mapping editor:

```jsx
<Box>
  <Typography variant="h6">Linked Fireflies meetings</Typography>
  <Typography variant="body2" color="text.secondary">
    Add the exact Fireflies meeting title (case-sensitive) for any recording
    you want to surface as past meetings on this agenda.
  </Typography>
  <Stack spacing={1}>
    {(agenda.firefliesTitles || []).map((t, i) => (
      <Stack key={i} direction="row" alignItems="center" spacing={1}>
        <Chip label={t} onDelete={() => removeFirefliesTitle(i)} />
      </Stack>
    ))}
    <Stack direction="row" spacing={1}>
      <TextField
        size="small"
        placeholder="Paste exact Fireflies meeting title..."
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        fullWidth
      />
      <Button onClick={addFirefliesTitle} disabled={!draftTitle.trim()}>
        Add
      </Button>
    </Stack>
  </Stack>
</Box>
```

`removeFirefliesTitle` and `addFirefliesTitle` write `updateDoc(doc(db, "agendas", agendaId), { firefliesTitles: [...] })`.

### 6. `vite.config.js` (EDIT)

Add Fireflies dev proxy alongside the existing API proxy logic:

```js
proxy: {
  ...(apiProxyTarget && {
    "/api": { target: apiProxyTarget, changeOrigin: true, secure: true },
  }),
  "/fireflies-api": {
    target: "https://api.fireflies.ai",
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/fireflies-api/, ""),
  },
}
```

Why: dev-mode CORS. The Bearer key is a public-by-design value (every browser session sends it), so the proxy is purely a CORS workaround. Production hits `api.fireflies.ai` directly with the same Bearer.

### 7. (Optional) `src/components/FirefliesTitlePicker.jsx` (NEW — convenience)

A "Browse recent titles" dialog: fetches `GQL_MEETING_LIST` (limit: 50), shows unique titles with counts and dates, click to populate the input. Saves Andy from copy-pasting. Build only if straightforward — the simple text input + Add is V2.2 acceptable.

---

## Operational Setup

### Environment variables

**Local dev:**
```bash
# Add to .env.local (gitignored)
VITE_FIREFLIES_KEY=<the Fireflies API key from app.fireflies.ai → Integrations → API>
```

**Production (Vercel):**
```bash
npx vercel env add VITE_FIREFLIES_KEY production
# When prompted, paste the key
npx vercel env add VITE_FIREFLIES_KEY preview
# (same key — preview deploys need it too)
```

Confirm `.env.example` lists the key (with empty value).

### Validate the key works before writing any port code

```bash
curl -s https://api.fireflies.ai/graphql \
  -H "Authorization: Bearer $VITE_FIREFLIES_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ transcripts(limit:3) { id title date } }"}' \
  | jq
```

If you get 3 recent transcripts back, the key works. If 401 / "Invalid token", the key is wrong — get it from Andy before continuing.

### Plan tier

Fireflies **Business** plan (per memory `project_fireflies_upgrade.md`, upgraded 2026-04-06):
- 60 req/min API throttle
- Unlimited storage
- The legacy "50 calls/day" comment in the archive `PastMeetingsCard` is **stale and wrong** — it was from the old Pro tier. Strip that comment in the port; replace with "60 req/min on Business; aggressive localStorage cache keeps us well under in practice."

---

## V2.2 Scope (Ship Now) vs. Later

### Ship in this slice

- `firefliesQuery` + 3 GraphQL queries + timestamp helpers in `src/lib/fireflies.js`
- `MeetingDetailModal` ported verbatim
- `PastMeetingsCard` ported with title-source rewired to `agenda.firefliesTitles`
- Card mounted in `AgendaDetail` right rail
- Mapping editor section in agenda settings/edit form
- Vite dev proxy
- `.env.local` + Vercel env vars
- Verification (see below)

### Defer (call out in context.md Deferred section)

- **Speaker → user mapping** — if Andy wants Fireflies speaker names to resolve to VM team `users/{uid}` for richer rendering, build later as a separate slice. Not needed for V2.2.
- **"Refresh from Fireflies" button** — manual cache invalidation. The archive doesn't have one; cache lives forever or until browser cache clear. Add only if Andy asks.
- **Auto-prefetch on agenda mount** — currently the card prefetches details only when mounted. If you want to warm the cache when the agenda detail page loads (even before the card is opened), wire it. Pre-optimize only if it actually feels slow.
- **Multi-org browsing** — archive's `useFirefliesMeetings(orgId)` was org-scoped. With Option 1 (field on agenda doc) the org-scoping happens naturally via the agenda's `organizationId`. No separate browsing view needed.

### Out of scope entirely

- Fireflies → Agenda topic auto-population (creating topics from action_items). Future agenda-AI work; nothing to do here.
- Webhook receivers for new Fireflies recordings. Pull-based fetch is sufficient for V2.2.

---

## Verification Gate

Hard gate per `feedback_self_verify_ui_before_asking.md`: drive the browser yourself before declaring done.

1. **Local dev:**
   - `npm run dev`
   - `/agent-browser` to `localhost:5173`
   - Sign in
   - Navigate to an existing agenda (Unio Weekly Marketing is a good test target — its archived seed mapping points to "Unio Weekly Marketing Meeting")
   - Add a `firefliesTitles` value via the settings editor → confirm Firestore doc updates → confirm card appears in right rail
   - Confirm matched meetings render with date + title + snippet
   - Click a row → modal opens → summary loads → action items + decisions list correctly
   - Click "Show transcript" → sentences load with speaker labels + timestamps
   - In-modal search "performance" (or some real word from a real meeting) → matches highlight, counter shows N of M, ↑/↓ cycle works, active match scrolls into view
   - Title-filter pill click → card list narrows; click same pill again → clears
   - Card-level search "Q3" (or some word that's in the deep details but not in the list-view snippet) → confirm deep search via prefetched details surfaces matches

2. **Production preview deploy:**
   - Push `main:dev` → wait for Vercel
   - Verify the Vercel env var was added (`VITE_FIREFLIES_KEY` should be set)
   - Open the deployed URL → same checks as above
   - **Don't ship without this step** — Vite dev proxy works locally but `import.meta.env.DEV` is false in prod, so the direct-to-`api.fireflies.ai` path runs only in prod. CORS or env-var typos surface here.

3. **Cache behavior:**
   - Hard-refresh the page → confirm list re-renders instantly (localStorage cache hit)
   - Open a previously-viewed meeting modal → confirm summary loads instantly
   - Open a never-viewed meeting modal → confirm summary streams in (network request)

4. **Real-data smoke test:**
   - Andy will have at least one real Fireflies recording matching a real linked title (Unio, BMD, etc.)
   - Confirm the meeting list shows that recording with real fields

5. **Self-verify with screenshots:**
   - Card empty → card populated → modal open → modal transcript expanded → in-modal search active
   - Save to `dev/sessions/v0_2_0_Andrew_MEETING_SCHEDULER/fireflies-port-step-N.png`
   - Reference them in the session close summary

---

## Open Questions to Confirm Before Coding

These are flagged in the brief but Andy may want different answers. Ask once at the top of your first response; don't pause mid-port to ask one at a time.

1. **Lookup model** — Option 1 (`firefliesTitles` field on agenda doc) recommended. Override if Andy wants Option 3 (top-level lookup collection).
2. **Browse recent titles dialog** — optional convenience. Build it (15-min extra) or skip (text input only).
3. **Theme tokens** — what's the canonical `t` reference in Management? (Archive used `t.copper`, `t.copperFaint`, `t.cream`, `t.cream2`, `t.cream3`, `t.copperLight`, `t.ink3`.) If Management's MUI theme didn't port the cream/copper editorial palette (per the spec, Guide editorial style was explicitly dropped), substitute with neutral grays/blues — but confirm with Andy first since this affects look.
4. **Card placement on `AgendaDetail`** — right rail (archive default) or somewhere else?
5. **Hide when zero mappings** — confirm; that's the archive behavior and the recommended UX.
6. **Mapping cardinality** — agree that one Fireflies title can repeat across multiple agendas (just duplicated in each agenda's `firefliesTitles` array)? Yes per Option 1. Confirm.
7. **Org filter** — past meetings card is naturally org-scoped via the agenda's `organizationId`. No separate org chip filter on the card itself. Confirm.

---

## What NOT to Do

- ❌ Do NOT proxy Fireflies through Firebase Functions. The Bearer key is browser-safe by Fireflies design; a backend proxy buys nothing and adds latency.
- ❌ Do NOT canonicalize Fireflies data into Firestore. The Fireflies API is the source of truth for its own recordings; mirroring breaks idempotency and burns Firestore writes.
- ❌ Do NOT replace localStorage caching with Firestore. localStorage is per-user, fast, and correct for non-canonical Fireflies blobs.
- ❌ Do NOT introduce a separate "Fireflies meetings" page or sidebar entry. The card lives ONLY on Agenda detail, scoped to that agenda.
- ❌ Do NOT remove the silent proxies (`fred@fireflies.ai`, `seo@vistamarconsulting.com`) from Fireflies attendee data — they're legitimate attendees in the recording; just don't render them in the FE attendee lists. Filter at the rendering layer, not at the data layer.
- ❌ Do NOT skip the production preview-deploy verification. Vite dev mode masks env-var and CORS issues.
- ❌ Do NOT pause mid-port to ask about theme tokens — list it as a single batched question at the start.

---

## After the Port

Update **the active session's `context.md`** (per the 2026-05-29 single-source convention):
- "What shipped" section — bullet the 3 new files + 2 edited files
- "Deferred" section — pull in the V2.2 deferred items listed above (speaker → user mapping, refresh button, auto-prefetch, etc.)
- "Session close" section — append at session end with commits + entry points for next session

Do NOT create `dev/HANDOFF_*.md` or `dev/DEFERRED.md`. Both retired 2026-05-29.

If you ship V2.2 and the Fireflies card is its own meaningful slice, write a feature-memory file `dev/feature_memory/Fireflies_Past_Meetings.md` per the on-`/push-ready` convention (skip during dev; create on session close).

---

## Sanity Questions — Answer These From Memory After Reading the Archive

Before writing any code, prove you actually read the archive by answering these:

1. **Where in archive `Agenda.jsx` does `MeetingDetailModal` start?** (Answer: line 2861)
2. **What are the three GraphQL queries the card uses, and which fields does `GQL_MEETING_DETAIL` return on `summary`?** (Answer: list/detail/sentences; summary returns `overview short_overview bullet_gist action_items outline shorthand_bullet keywords topics_discussed`)
3. **What is the archive's caching strategy for transcript sentences specifically, and when does the sentences fetch fire?** (Answer: localStorage key `fireflies-sentences-{transcriptId}`; React Query enabled only when `transcriptExpanded === true` AND no cached sentences exist)
4. **What's the archive's batch size for prefetching meeting details on card mount?** (Answer: 10 in parallel via `Promise.allSettled`)
5. **What's the archive's seed mapping for Org_Id 2 (Unio)?** (Answer: `Agenda_Id: 1, Fireflies_Meeting_Title: "Unio Weekly Marketing Meeting"` — and `Agenda_Id: 2, Fireflies_Meeting_Title: "Biweekly Marketing Updates"`)

If you can't answer all five, read the archive again before coding.

---

*End of brief.*
