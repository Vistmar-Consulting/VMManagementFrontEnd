# Agenda Version History (Slice 2) — Design Spec

**Date:** 2026-05-30
**Author:** Andrew Deemer + Claude (brainstorming)
**Status:** Approved (design). Build directly with prod browser verification (Andy's call — no formal spec-review-subagent loop / separate plan).
**Session:** SES-20260529-Andrew-v0.2.4-agenda-richtext
**Sequence:** Slice 2 of the AI integration build (after Slice 1 — AI Integration tab). Makes AI generation reversible; also useful for reverting manual edits.

---

## 1. Goal

Capture restorable **version snapshots** of an agenda's content, and **restore** a previous one. Primary driver: AI generation (Slice 4) must be revertible. This slice builds the snapshot/restore mechanism + UI with a **manual "Save version"** trigger; Slice 4 calls the same snapshot function automatically before generating.

## 2. What a version captures (content only)

The agenda's editable content — **not** meeting-binding fields (graphEventId/etc.) and **not** Project Board items (live task state):
- `title`, `preBriefHtml`, `openFloorHtml`
- `topics: [{ id, name, bodyHtml, sortOrder, categoryIds, tagIds }]` (a frozen copy; `id` retained so restore can sync in place)

## 3. Storage

`agendas/{agendaId}/versions/{versionId}` (auto-id) →
`{ createdAt, createdByUid, source: "manual" | "pre-ai-gen" | "pre-restore", label?: string, snapshot: { title, preBriefHtml, openFloorHtml, topics: [...] } }`

## 4. Functions (`src/lib/agendaVersions.js`)

- **`snapshotAgenda(agendaId, { source, label, uid })`** — read the agenda doc + topics, write one version doc. Reusable (Slice 4 calls it). Returns the new version id.
- **`restoreAgendaVersion(agendaId, versionId, { uid })`** —
  1. `snapshotAgenda(..., source: "pre-restore")` first (so a restore is itself revertible).
  2. In a `writeBatch`: set the agenda content fields (`title`, `preBriefHtml`, `openFloorHtml`) + **ID-aware topic sync** — `set` each snapshot topic by its original id (recreates/updates), `delete` any current topic whose id isn't in the snapshot. (Agendas have <20 topics → well under the 500-op batch limit.)
  - ID-aware sync preserves topic ids for surviving topics (less churn). Topics deleted-then-restored get their original id back; their legacy `talkingPoints`/`notes` subcollections were already orphaned at delete time (matches existing topic-delete behavior) — acceptable.

## 5. UI

- A **"History"** button on the agenda (Overview hero area, near the view toggle) → opens `AgendaHistoryDialog`:
  - **"Save version"** (optional label) → `snapshotAgenda(source: "manual")`.
  - **Version list** (desc by `createdAt`): timestamp · who · source. Each row: **Preview** + **Restore**.
  - **Preview:** read-only render of `composeAgendaHtml(snapshot, snapshot.topics)` in the dialog.
  - **Restore:** confirm → `restoreAgendaVersion` → close; the agenda re-renders live (onSnapshot).
- Live version list via `useCollection("agendas/{id}/versions", [orderBy("createdAt","desc")])`.

## 6. Permissions

`agendas/{id}/versions/{vid}` — `allow read, create, update, delete: if isActiveUser()` (matches the agenda's existing open-to-active-user editing; restore is an active-user action). **New rule → must be deployed.**

## 7. Out of scope (later)

Auto-snapshot before AI generation (Slice 4 wires it), per-conclusion archival snapshots (editor-spec Phase 3), version pruning/retention limits, diff view between versions.

---

*End of spec.*
