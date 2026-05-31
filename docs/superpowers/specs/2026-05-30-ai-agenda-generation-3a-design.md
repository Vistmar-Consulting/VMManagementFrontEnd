# AI Agenda Generation — Core Loop (Slice 3a) — Design Spec

**Date:** 2026-05-30
**Author:** Andrew Deemer + Claude (brainstorming)
**Status:** Approved (design). Build directly with prod verification (Andy's call — no formal spec-review-subagent loop / separate plan).
**Session:** SES-20260529-Andrew-v0.2.4-agenda-richtext
**Sequence:** Slice 3a of the AI engine (after Slice 1 prompt store + Slice 2 version history). 3b adds categories/tags; 5 adds AI-Gen tasks; 3a.2 expands inclusion.

---

## 1. Goal

The first end-to-end AI loop: from an agenda, click **AI Gen**, pick **working/executive**, and get a proposed **next agenda** (Pre-Brief + topics) that a human reviews and applies — fully reversible (auto-snapshots first via Slice 2). Admin-only. Proves the model loop against Unio with the smallest input set; 3a.2 expands inputs to the full windowed org+internal inclusion.

## 2. Architecture (FE assembles inputs; Vercel fn calls Claude)

The **FE** (which already has Firestore auth + reads) assembles the inputs and POSTs them; the **Vercel function** just calls Claude and returns structured output. This avoids giving the function Firestore-admin access.

**Flow (FE, Overview view, admin-only button):**
1. **AI Gen** button → modal: choose **Working** or **Executive** → Generate.
2. `snapshotAgenda(agendaId, { source: "pre-ai-gen", uid })` (Slice 2) — so the result is revertible.
3. Assemble inputs:
   - **prompt**: resolve `aiPrompts/{org}.meetingAgendaGen.prompt` if an override exists, else `aiPrompts/default`.
   - **meetingStyle**: `working` | `executive` (replaces `{{meetingStyle}}`).
   - **current agenda**: `{ title, preBriefHtml, openFloorHtml, topics: [{name, bodyHtml}] }`.
   - **transcripts** (3a): the agenda's mapped Fireflies transcript(s) via `agenda.firefliesTitles` → `GQL_MEETING_DETAIL` summaries (overview + action_items). *(3a.2: windowed org + `vistamar` inclusion via `organizationId` + `firefliesTitles`.)*
4. `POST /api/ai/generate` with `{ prompt, meetingStyle, agenda, transcripts }`.
5. Show the proposed agenda in a **review modal** (rendered via `composeAgendaHtml`).
6. **Apply** → write the proposal to the agenda; or **Discard**.

**`api/ai/generate.js`** (Vercel function):
- `requireAuth` (Firebase ID token) + **gate on `@vistamarconsulting.com` email** (server-side; the FE additionally shows the button to admins only). Finer per-user admin gate deferred (function has no Firestore-admin SDK; domain gate keeps clients out).
- `@anthropic-ai/sdk`, model **`claude-sonnet-4-6`**, `ANTHROPIC_API_KEY` (Vercel env).
- **Structured output via tool-use:** define an `emit_agenda` tool whose input schema is `{ preBriefHtml: string, topics: [{ name: string, bodyHtml: string }], openFloorHtml: string }`; force `tool_choice` to it so the model returns valid JSON. The system prompt = the stored prompt (with `{{meetingStyle}}` filled) + an HTML-format contract (our allowed tags: p/ul/ol/li/strong/em/u/a). The user message = the current agenda + transcripts. **Prompt caching** on the system block (per claude-api guidance).
- Returns `{ proposal: { preBriefHtml, topics, openFloorHtml } }`. On error → 4xx/5xx with a message the FE surfaces.

## 3. Apply logic

On **Apply** (the agenda was already snapshotted in step 2):
- Sanitize each HTML field (`sanitizeHtml`).
- `updateDoc(agenda, { preBriefHtml, openFloorHtml, updatedAt, updatedByUid })`.
- **Topics:** the proposal's topics have no ids (model-generated) → replace: delete current topics, create proposal topics with `sortOrder` 1..n + `createdByUid`. (Reversible via the pre-ai-gen snapshot.) `categoryIds`/`tagIds` left empty in 3a (Slice 3b adds them).

## 4. Components

- **Modify** `package.json` — add `@anthropic-ai/sdk`.
- **New** `api/ai/generate.js` — the Claude call (+ reuse `api/meetings/_lib/auth.js`, `cors.js`).
- **New** `src/lib/aiAgenda.js` — FE helpers: `resolvePrompt(org)`, `assembleGenInputs(agenda, topics)`, `generateAgenda(payload)` (POST), `applyProposal(agendaId, proposal, uid)`.
- **New** `src/components/AIGenDialog.jsx` — the working/executive choice + generate + review (proposal rendered) + Apply/Discard. Drives snapshot → generate → apply.
- **Modify** `src/pages/AgendaDetail.jsx` — admin-only **AI Gen** button (Overview header) opening the dialog.

## 5. Permissions / secrets

- `ANTHROPIC_API_KEY` in Vercel env (Andy provides value; I add via CLI).
- Function gates on verified `@vistamarconsulting.com`. FE button shown to admins only.
- No new Firestore rules (uses existing agenda/topics/versions rules + aiPrompts read).

## 6. Out of scope (later)

3a.2 full windowed inclusion (org + `vistamar` meetings since last occurrence); 3b categories/tags; 5 AI-Gen tasks/promotions/notes; streaming the generation; multi-shot/critique passes; cost tracking.

---

*End of spec.*
