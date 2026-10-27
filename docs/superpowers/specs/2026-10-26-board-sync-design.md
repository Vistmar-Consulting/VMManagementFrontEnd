# Board Sync — Design

**Date:** 2026-10-26
**Owner:** Andy
**Status:** Approved in brainstorm, pending spec review

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

### 3.2 Writers

- **Board Sync apply** — for each org applied in the run, stamps `orgs[org]` on every transcript that was in that org's input as a new-source transcript. Written inside the apply transaction (`set` with merge on the `orgs.{slug}` field path).
- **Sync Meeting apply** (`applyUnified`) — stamps `orgs[targetOrg]` (or, for master, `orgs[t.org]` per transcript) for every transcript in the run's inputs. This is the **only** change to Sync Meeting. Requires the transcript ids to be threaded from `assembleGenInputs` through the proposal into `applyUnified`.

### 3.3 Backfill (no migration)

Transcripts that predate the ledger are evaluated at read time: a transcript is treated as stamped for org X if its date is **≤ the latest `lastUnifiedGenAt` across X's agendas** (agendas resolved via `calendar_series.organizationId`). No backfill writes. Computed once per run.

## 4. Gather (client side)

Lives in a new `src/lib/boardSync.js`, reusing helpers from `src/lib/aiAgenda.js` (extract/export rather than duplicate: Fireflies list/detail, `resolveOrgFromAttendees`, prompt resolution, agenda-content collection).

1. **List** — page `GQL_MEETING_LIST` (50 per page) until the oldest result is older than 30 days. (Today's single 50-row fetch is insufficient across all orgs.)
2. **Classify** each transcript:
   - **Cross-org** if its title matches a `firefliesTitles` entry of any agenda whose series/agenda has `masterAgenda == true`. Fans into **every** org bucket.
   - Otherwise org via `resolveOrgFromAttendees`, else `vistamar` if the title maps to a Vistamar agenda, else unclassified (dropped; listed in pre-flight as "unclassified: N").
   - Vistamar-internal transcripts also go to each client's bucket as `scope: "vistamar-internal"` context, matching Sync Meeting's per-org behavior.
3. **Filter** each bucket against the ledger + backfill → `newTranscripts[org]`. Already-stamped in-window transcripts for that org are passed as **context-only** (`scope: "already-synced"`), capped, so the model can mark work done without re-creating tasks.
4. **Per-org payload** — new + context transcripts (detail-fetched in parallel, `allSettled`; a failed detail fetch drops that transcript and is reported), that org's board items + `existingTasks`, that org's agendas' current topic content (read-only), org meta, categories + tag vocab, org-type-aware prompt (`resolvePrompt(org)`), shared extra context.
5. Per-org transcript cap reuses `MAX_TRANSCRIPTS` (25); overflow reported in pre-flight.

## 5. Generate (server)

- Handler `api/ai/_handlers/syncBoard.js`, routed by `api/ai/dispatch.js` as `/api/ai/sync-board`. No new Vercel function.
- One request per org; the FE fires all selected orgs in parallel.
- Auth: `requireAuth` then **403 unless verified email == `BOARD_SYNC_EMAIL`**.
- Model: `claude-sonnet-4-6` (same as prepare). Structured output schema contains **only** `boardChanges { creates, moves, notes }`.
  - `creates` differ from Sync Meeting: no `topicIndex`; each carries its own `categories[]` and `tags[]` (and optional `parentRef`) since there is no topic to inherit from.
  - `moves` / `notes` same shape as prepare.
- Board-change rules (Vistamar internal-board scope, status semantics, sub-item rules, already-synced = do-not-create) are shared with `prepare.js` by extracting them into a common module rather than copied.

## 6. Access constant

`BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com"` defined once in a module importable by both FE (`src/`) and the Vercel handler. FE hides the button unless `user.email` matches; server enforces.

## 7. UI

**Trigger** — "Sync Board" button in the Task Board toolbar, visible only to Andy. Ignores the board's org filter.

**Dialog** (`src/components/SyncBoardDialog.jsx`), three stages:

1. **Pre-flight** — one row per org (org accent color): new-transcript count, context count, include checkbox (checked iff new > 0). Shows unclassified and over-cap counts. Extra-context textarea. "Last Board Sync: <date>" from `boardSyncLog`. **Run** button.
2. **Review** — grouped by org. Per org: status (running / done / failed + Retry), then creates / moves / notes with accept/reject per change (reuse Sync Meeting's board-change review components where they fit). Failed or still-running orgs block nothing; apply covers done orgs.
3. **Apply** — one Firestore transaction: accepted changes for all done orgs (same write path/validation as `applyUnified`'s board half: item numbering per org, coined tags, at-apply re-validation against current board) + ledger stamps for applied orgs + `boardSyncLog/{id}` `{ at, byUid, orgs: { [slug]: { created, moved, noted, transcriptIds } } }`. Result summary per org.

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
- Rules: emulator tests for `boardSyncLog` and `syncedTranscripts` if the repo's rules test harness covers them; otherwise state untested.
- UI: drive dev server via agent-browser on Andy's login through pre-flight → review → apply.
- Live run calls Anthropic (est. $0.15–0.30 per org, unmeasured) — priced ask before firing.

## 12. Out of scope

Scheduled/automatic runs; access for anyone else; writing to agendas; cross-org task linking.
