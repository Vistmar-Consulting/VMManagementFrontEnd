# Board Sync — Design

**Date:** 2026-10-26
**Owner:** Andy
**Status:** Approved by Andy; spec review issues resolved

## 1. Purpose

A **Sync Board** action on the Task Board that updates every org's tasks (all clients + Vistamar) in one run, from the same sources Sync Meeting uses — without touching any meeting agenda. Primary use: before and after the Monday VM Weekly Touch Base.

Only `adeemer@vistamarconsulting.com` may run it.

## 2. Decisions (from brainstorm)

| # | Decision |
|---|---|
| D1 | "What's new" is defined by a **transcript ledger**, not a date anchor. |
| D2 | Ledger is stamped **per org** per transcript, by both Board Sync and Sync Meeting. |
| D3 | Lookback cap: **30 days**. Unstamped transcripts within 30 days are new. |
| D4 | One model call **per org, in parallel**; merged into one review; one atomic apply. |
| D5 | Orgs with zero new transcripts are **skipped by default**, listed as "nothing new" with an include checkbox. |
| D6 | **Cross-org transcripts** (mapped to a master agenda) feed every org's call. |
| D7 | Shared free-text **extra context** box, sent to every org call. |
| D8 | Access gate is Andy's email, enforced client- **and** server-side. |

## 3. Transcript ledger

### 3.1 Shape

```
syncedTranscripts/{firefliesTranscriptId}
  orgs: {
    [orgSlug]: { at: Timestamp, by: "agenda" | "board", byUid: string }
  }
```

A transcript is **new for org X** when `orgs[X]` is absent **and** it is not covered by backfill (3.3).

Per-org stamping means a cross-org transcript (e.g. Touch Base) stays new for any org that was unchecked or whose call failed.

### 3.2 Scope rule (applies to both writers)

Every transcript in an org's input has one scope. Scope decides whether it counts as **new** for that org and whether it is **stamped** for that org on apply.

| Scope for org X | How it gets there | Counts toward X's "new" | Stamped for X on apply |
|---|---|---|---|
| `this-org` | attendee-classified to X, or title mapped to an X agenda | yes, if unstamped for X | yes |
| `cross-org` | title mapped to a master agenda (`masterAgenda == true`) | yes, if unstamped for X | yes |
| `vistamar-internal` | non-master Vistamar meeting, in a **client** org's input | **no** (context only) | **no** |
| `already-synced` | in-window, already stamped/backfilled for X | no (context only) | no (already) |

For org `vistamar` itself, Vistamar meetings are `this-org`.

### 3.3 Writers

- **Board Sync apply** — for each applied org X, stamps `orgs[X]` on every `this-org` and `cross-org` transcript in X's input. Inside the apply transaction (`set` merge on `orgs.{X}`).
- **Sync Meeting apply** (`applyUnified`), per-org — stamps `orgs[targetOrg]` on its `this-org` transcripts only. Never stamps `vistamar-internal`.
- **Sync Meeting apply**, master — stamps transcripts mapped to the master agenda for **every** org in `orgMeta` (it produces cross-org board changes); other classified transcripts stamped for `t.org`.
- Requires transcript ids + scope threaded from `assembleGenInputs` (today transcripts do not carry `id`) through the proposal into `applyUnified`. This threading + stamping is the only change to Sync Meeting.

### 3.4 Backfill (no migration)

Transcripts that predate the ledger are evaluated at read time: a transcript is treated as stamped for org X if its date is **≤ the latest `lastUnifiedGenAt` across X's agendas** (agendas resolved via `calendar_series.organizationId`). Backfill applies only to transcripts dated before `LEDGER_EPOCH_MS` (the moment Sync Meeting stamping goes live); after it, the ledger alone decides. For `cross-org` transcripts the threshold is the master agenda's `lastUnifiedGenAt` only — a client's own Sync Meeting saw the Touch Base as context, not a source. No backfill writes. Computed once per run.

**Known approximation:** Sync Meeting only looks back one meeting cycle, so backfill can mark a transcript synced that no Sync Meeting actually read. Accepted: such transcripts still reach the model as `already-synced` context.

## 4. Gather (client side)

Lives in a new `src/lib/boardSync.js`, reusing helpers from `src/lib/aiAgenda.js` (extract/export rather than duplicate: Fireflies list/detail, `resolveOrgFromAttendees`, prompt resolution, agenda-content collection).

1. **List** — page `GQL_MEETING_LIST` (50 per page) until the oldest result is older than 30 days. (Today's single 50-row fetch is insufficient across all orgs.)
2. **Classify** each transcript:
   - **Cross-org** if its title matches a `firefliesTitles` entry of any agenda whose series/agenda has `masterAgenda == true`. Fans into **every** org bucket.
   - Otherwise org via `resolveOrgFromAttendees`, else `vistamar` if the title maps to a Vistamar agenda, else unclassified (dropped; listed in pre-flight as "unclassified: N").
   - Vistamar-internal transcripts also go to each client's bucket as `vistamar-internal` context, matching Sync Meeting's per-org behavior.
3. **Filter** each bucket by the scope rule (3.2) + ledger + backfill → `newTranscripts[org]` (only `this-org` / `cross-org` unstamped). D5's include default keys off this count. Already-stamped in-window transcripts are passed as `already-synced` context, capped, so the model can mark work done without re-creating tasks.
4. **Per-org payload** — new + context transcripts (detail-fetched in parallel, `allSettled`; a failed detail fetch drops that transcript and is reported), that org's board items + `existingTasks`, that org's agendas' current topic content (read-only), org meta, categories + tag vocab, org-type-aware prompt (`resolvePrompt(org)`), shared extra context.
5. Per-org transcript cap reuses `MAX_TRANSCRIPTS` (25); overflow reported in pre-flight.

## 5. Generate (server)

- Handler `api/ai/_handlers/syncBoard.js`, routed by `api/ai/dispatch.js` (`ROUTES` key `"sync-board"`, quoted) via the existing `/api/ai/:action` rewrite. No new Vercel function; shares the 300s `maxDuration`.
- One request per org; the FE fires all selected orgs in parallel.
- Auth: `requireAuth` then **403 unless verified email == `BOARD_SYNC_EMAIL`**.
- Model: `claude-sonnet-4-6` (same as prepare). Structured output schema contains **only** `boardChanges { creates, moves, notes }`.
  - `creates` differ from Sync Meeting: no `topicIndex`; each carries its own `categories[]` and `tags[]` (and optional `parentRef`) since there is no topic to inherit from.
  - `moves` / `notes` same shape as prepare.
- Board-change rules (Vistamar internal-board scope, status semantics, sub-item rules, already-synced = do-not-create) are shared with `prepare.js` by extracting them into a common module rather than copied.

## 6. Access constant

`BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com"` defined in two places — `src/lib/boardSync.js` (FE) and `api/ai/_handlers/syncBoard.js` (server) — because nothing under `api/` imports from `src/` today. A unit test asserts the two values match. FE hides the button unless `user.email` matches; server checks `req.authUser.email` (set by `requireAuth`) and returns 403 otherwise.

## 7. UI

**Trigger** — "Sync Board" button in the Task Board toolbar, visible only to Andy. Ignores the board's org filter.

**Dialog** (`src/components/SyncBoardDialog.jsx`), three stages:

1. **Pre-flight** — one row per org (org accent color): new-transcript count, context count, include checkbox (checked iff new > 0). Shows unclassified and over-cap counts. Extra-context textarea. "Last Board Sync: <date>" from `boardSyncLog`. **Run** button.
2. **Review** — grouped by org. Per org: status (running / done / failed + Retry), then creates / moves / notes with accept/reject per change (reuse Sync Meeting's board-change review components where they fit). Failed or still-running orgs block nothing; apply covers done orgs.
3. **Apply** — new `applyBoardSync` in `src/lib/boardSync.js`, **a parallel implementation, not a refactor of `applyUnified`** (Sync Meeting's board half is topic-bound: `validateProposal` checks `topicId`, category/tags inherit from the topic, and it throws on any rejection). Pure helpers (per-org item-number allocation, coined-tag writes, create-doc builder) may be extracted from `aiAgenda.js` only where the extraction is mechanical and Sync Meeting's tests stay green; otherwise duplicated with a comment pointing at the twin.
   - One Firestore transaction: accepted changes for all done orgs + ledger stamps for applied orgs + `boardSyncLog/{id}` `{ at, byUid, orgs: { [slug]: { created, moved, noted, transcriptIds } } }`. Bound: Firestore's 500-write transaction limit — fine at current volumes; if a run exceeds it, apply fails loudly with the count (no silent split).
   - Validation is **non-throwing**: a change that fails at-apply re-validation (target item deleted, bad parent) is dropped from the write and listed in the result.
   - **Create mapping:** `categoryId` = first entry of `categories[]` that resolves to a known category (none → uncategorized); `tags[]` resolve to `tagIds`, unknown slugs coined as layer-3 tags (same as Sync Meeting).
   - **Per-create promotions kept:** status defaults to AI Gen (statusId 8); assignee / category / tags editable in review via the existing `ProposedBoardRow`.
   - Result summary per org.

Changes dropped by at-apply validation (item deleted/moved since review) are shown, not silently discarded.

## 8. Security rules

- `boardSyncLog/{id}` — read + create only when `request.auth.token.email == 'adeemer@vistamarconsulting.com'` and active user. No update/delete.
- `syncedTranscripts/{id}` — read + create/update for any active user (Sync Meeting runners stamp it). No delete.

## 9. Never touched

Agenda docs and topics, agenda `aiGenLog`, `lastUnifiedGenAt`, calendar series, Google/Graph calendar data.

## 10. AI Integration page

Add Board Sync rows to `HOW_IT_WORKS` in `src/pages/AIIntegration.jsx`: sources, ledger + backfill, per-org calls, cross-org rule, already-synced context rule, access gate. Update the Sync Meeting rows to note it now stamps the ledger.

## 11. Testing

- Unit (`src/lib/__tests__/`): ledger filter + backfill; classification incl. cross-org fan-in and vistamar-internal context; Fireflies pagination stop condition; schema/validator for creates with own categories/tags; email gate (FE helper + handler 403).
- Rules: **untested** — the repo has no rules emulator harness. Verified manually in the browser (non-Andy write to `boardSyncLog` denied) only if a second account is available; otherwise reported as unverified.
- Scope rule: unit test each row of the 3.2 table for both writers.
- UI: drive dev server via agent-browser on Andy's login through pre-flight → review → apply.
- Live run calls Anthropic (est. $0.15–0.30 per org, unmeasured) — priced ask before firing.

## 12. Out of scope

Scheduled/automatic runs; access for anyone else; writing to agendas; cross-org task linking.
