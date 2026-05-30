# AI Integration — Settings Tab + Prompt Store (Slice 1) — Design Spec

**Date:** 2026-05-30
**Author:** Andrew Deemer + Claude (brainstorming)
**Status:** Approved (design). Build directly with per-step browser verification (Andy's call — no formal spec-review-subagent loop / separate plan).
**Session:** SES-20260529-Andrew-v0.2.4-agenda-richtext
**Parent design space:** `dev/Features/AI Prompt Management/` (README + RESUME-2026-05-30.md). This is **Slice 1** of the AI integration build sequence (decomposition in that RESUME doc + this session). No LLM in this slice — authoring/storing/editing prompts only.

---

## 1. Goal

An **admin-only** Settings sub-section, **"AI Integration"**, where the Vistamar team authors and stores the prompts that drive AI features — starting with the **"Meeting Agenda Gen"** prompt. A **Default** prompt applies to all orgs; each org may **override** it. This is the editable-prompt infrastructure the rest of the AI engine (later slices) reads from.

## 2. Nav / route

- New page `src/pages/AIIntegration.jsx`.
- Route `/settings/ai-integration`, admin-gated (same `requireAdmin` pattern as `/organizations`).
- Add to `SETTINGS_CHILDREN` in `src/components/Sidebar.jsx`: `{ to: "/settings/ai-integration", label: "AI Integration", requireAdmin: true }`.

## 3. Data model — `aiPrompts` collection

- `aiPrompts/default` → `{ meetingAgendaGen: { prompt: string }, updatedAt, updatedByUid }` — the Default prompt set.
- `aiPrompts/{orgSlug}` → same shape — created **only** when that org overrides. **Absence (or absence of the `meetingAgendaGen` field) = inherits Default.**
- `meetingAgendaGen.prompt` is a single freeform string. The working-vs-executive distinction is a **runtime variable** (`{{meetingStyle}}` = `working` | `executive`) the prompt references, NOT two stored prompts. Future cards (e.g. Inclusion Criteria) become sibling fields on these same docs.
- **Seed:** if `aiPrompts/default` is missing, seed `meetingAgendaGen.prompt` from `dev/Features/AI Prompt Management/prompts/refresh-agenda.v0.md` so there's a real prompt to iterate immediately.

## 4. UI behavior (`AIIntegration.jsx`)

- **Pill row:** `Default` first and **selected by default**, then one pill per org (from the `organizations` collection). **Single-select** (one at a time). Reuse the existing org-pill styling.
- **Meeting Agenda Gen card** (the only card this slice):
  - **Default selected:** editable `<textarea>` bound to `aiPrompts/default.meetingAgendaGen.prompt` + **Save** (writes on click; disabled when unchanged).
  - **Org selected, no override:** show the Default prompt **read-only** ("Inherited from Default") + a **"Create override"** button → copies the Default text into an editable org copy (creates/sets `aiPrompts/{org}.meetingAgendaGen`).
  - **Org selected, has override:** editable textarea bound to the org's prompt + **Save** + **"Reset to Default"** (removes the override → back to inherited).
  - A small hint listing available template variables (`{{meetingStyle}}` for now).
- Live reads via `useDoc("aiPrompts/default")` + `useDoc("aiPrompts/{org}")` (onSnapshot). Writes via `setDoc`/`updateDoc`/`deleteField` (`updatedAt`/`updatedByUid` stamped).

## 5. Security rules

Add to `firestore.rules`:
- `match /aiPrompts/{id}` — `allow read: if` active signed-in user (same gate as the rest); `allow write: if isAdmin()`.
Deploy via `firebase deploy --only firestore:rules`.

## 6. Out of scope (later slices)

The LLM call/engine, the per-agenda working/executive modal + "AI Gen" button, agenda version history, AI-Gen task creation/promotion, the real prompt content beyond the seed, and additional prompt cards.

---

*End of spec.*
