# AI Agenda Generation — Inclusion Engine + Richer Inputs (Slice 3a.2) — Design Spec

**Date:** 2026-05-30
**Author:** Andrew Deemer + Claude (brainstorming)
**Status:** Approved (design). Build directly with prod verification (Andy's lighter process — no formal spec-review-subagent loop).
**Session:** SES-20260529-Andrew-v0.2.4-agenda-richtext
**Sequence:** Builds on Slice 3a (core loop). Expands the input set the generator reconciles. 3b (categories/tags) + 5 (AI-Gen tasks) still follow.

---

## 1. Goal

Move generation from "this agenda + its own mapped transcript" to the **full picture since this meeting last occurred**: every relevant meeting (this org's + internal Vistamar), recent **Project Board** activity, an optional **per-run note** from the user, and a **persisted working/executive style** on the meeting. The LLM call, review modal, snapshot, and apply are unchanged from 3a — this slice is about assembling richer inputs and one small persistent setting.

## 2. Four components

### A. Persistent meeting style (working | executive)
- New field `agenda.meetingStyle` (`"working"` | `"executive"`, default `"working"`).
- A compact **Working / Executive toggle in the AgendaHero** (near the view toggle) writes `agenda.meetingStyle` (persisted). This is the meeting's default style — set once, inherited by every generation.
- The AI Gen modal **pre-selects** `agenda.meetingStyle`. The user may override it for a single run (the override is run-only; it does not change the persisted default).

### B. Per-run additional context (modal textarea)
- The AI Gen modal (choose step) gains an **"Additional context (optional)"** multiline field — e.g. *"We published these two articles, they're done."*
- Sent to the function as `extraContext` (string), appended to the user message as a clearly-labeled section. Empty → omitted.

### C. Windowed meeting inclusion (the inclusion engine)
`assembleTranscripts(firefliesTitles)` becomes **`assembleGenInputs(agenda, items)`** in `src/lib/aiAgenda.js`:
1. `GQL_MEETING_LIST` → recent transcripts (`id, title, date, meeting_attendees`).
2. **Window start** = the latest past `date` among transcripts whose title ∈ `agenda.firefliesTitles` (= this meeting's last actual occurrence). If none mapped → fallback `now − 21 days`. (Cadence frequency is a render-time heuristic, not stored, so the actual last-occurrence date is the anchor.)
3. Keep transcripts with `date ∈ [windowStart, now]`.
4. **Classify each** via the existing `resolveOrgFromAttendees(t.meeting_attendees)` (`src/lib/orgMapping.js` — single source of org↔domain truth; `CLIENT_DOMAINS` confirmed `uniohp.com → unio`). **Include if** class `=== agenda.organizationId` **OR** `=== "vistamar"` (internal).
5. **Detail-fetch** included transcripts in parallel (`GQL_MEETING_DETAIL`) → `{ title, date, scope, overview, actionItems }`, where `scope` ∈ `"this-org"` | `"vistamar-internal"`.
6. **Partial-failure tolerant:** `Promise.allSettled` — include what loaded; return a `failedCount`. Surfaced to the user (a many-call run shouldn't die on one flaky transcript, but the gap is reported, not swallowed).
7. **Cap** at the ~25 most-recent included transcripts; if exceeded, surface the dropped count (no silent truncation).

### D. Project Board awareness
- The FE already subscribes to the org's `items` (AgendaDetail). `assembleGenInputs` filters them to the window: `createdAt >= windowStart` (**new**) **or** `updatedAt >= windowStart` (**touched**).
- Each → `{ name, status, isNew, project }` where `status` = `STATUS_OPTIONS` label for `statusId`, `isNew` = created in window, `project` = parent item name (or null). (No status-change history exists, so the model infers movement by comparing current status to the prior agenda; `isNew` distinguishes brand-new tasks.)
- Capped + count-surfaced like transcripts.

## 3. Function changes (`api/ai/generate.js`)

Small additions — the function stays thin (no firebase-admin):
- Body gains `extraContext` (string) + `projectBoard` (array). `transcripts` items now carry `scope`.
- `buildUserMessage`: transcript section headers tag scope — `### [Vistamar internal] VM Weekly Touch Base (5/27)` vs `### [Unio] Unio Weekly (5/28)` — so the model distinguishes client vs internal context (the Internal/Public boundary). Adds a **"## Recent Project Board activity"** section (new vs touched tasks + status) and a **"## Additional context from the user"** section when `extraContext` is non-empty.
- `buildSystem`: one paragraph instructing the model to use internal-meeting + project-board signals to move the agenda forward, and to respect the client/internal distinction (never surface internal-only mechanics into a client-facing executive agenda).

## 4. Dialog transparency (`AIGenDialog.jsx`)

Before generating shows nothing new; the **working step** reports what fed the model once assembled, e.g.:
> *Read 11 meetings since May 19 — 4 Unio, 7 Vistamar internal · 9 Project Board updates (3 new)* — *couldn't load 1 transcript.*

So Andy always sees the actual input set (no silent caps / dropped data).

## 5. Components touched

- **Modify** `api/ai/generate.js` — `extraContext` + `projectBoard` + scope-tagged transcripts in the prompt builders.
- **Modify** `src/lib/aiAgenda.js` — `assembleTranscripts` → `assembleGenInputs(agenda, items)` (window, classify, project-board filter, allSettled). Import `resolveOrgFromAttendees` + `STATUS_OPTIONS`.
- **Modify** `src/components/AIGenDialog.jsx` — style defaults from `agenda.meetingStyle`; "Additional context" textarea; ingestion summary; pass `extraContext` + `projectBoard`.
- **Modify** `src/pages/AgendaDetail.jsx` — persistent Working/Executive toggle in AgendaHero (writes `agenda.meetingStyle`); pass org `items` to AIGenDialog.

## 6. Edge cases

- Target agenda is itself a `vistamar` internal meeting → "this org" and "internal" coincide; dedup (don't double-list).
- Transcript unclassifiable (no/odd attendees) → excluded (not this org, not internal).
- `agenda.meetingStyle` absent → default `"working"`.
- Empty window / no transcripts → generate from current agenda + project board + extra context (function already handles empty `transcripts`).

## 7. Out of scope (later)

3b categories/tags; 5 AI-Gen task creation/promotion (statusId 8) + notes; the security hardening (server-side prompt resolution / role-enforced gate) — both 3a deferrals still stand and are unaffected here.

---

*End of spec.*
