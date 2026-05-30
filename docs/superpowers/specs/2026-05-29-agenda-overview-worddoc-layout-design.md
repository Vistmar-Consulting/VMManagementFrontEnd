# Agenda Overview — Single-Card "Word Document" Layout — Design Spec

**Date:** 2026-05-29
**Author:** Andrew Deemer + Claude (brainstorming session)
**Status:** Approved (design). Building directly with per-step browser verification (Andy's call — no formal spec-review-subagent loop / separate plan).
**Session:** SES-20260529-Andrew-v0.2.4-agenda-richtext
**Builds on:** `2026-05-29-agenda-richtext-editor-design.md` (Phase 1 — TipTap editor, HTML-in-Firestore). This spec restyles the **Overview view** of an agenda.

---

## 1. Goal

Make the agenda's **Overview view** read and edit like a single Microsoft Word document instead of a stack of separate cards. One white card holds the whole agenda; a single Word-style toolbar at the top acts on whichever section you're editing; topics reorder by dragging a grip handle; and a Pre-Brief section at the top lets the team quickly agree on what to discuss before going topic-by-topic (a real in-meeting tool).

**Scope: Overview view only.** The **Working view stays untouched** — it keeps its per-topic cards with KPI strips + Mini Project Boards (the document model doesn't fit there). The same grip-handle upgrade for the Working view is a noted follow-up, not in this scope.

---

## 2. Layout — one agenda card

A single white, rounded, soft-shadow card wraps the whole agenda. Top → bottom:

1. **Sticky shared toolbar** — always visible; pins to the card top on scroll; acts on whichever body is being edited.
2. **PRE-BRIEF** — static title (styled like a topic title) + one rich body.
3. **Topics** — grip-draggable; each = bold heading + rich body.
4. **+ Add Topic**
5. **OPEN FLOOR** — static title (styled like a topic title) + one rich body.

Outside the card: **attendee chips** sit above it; the **Past Meetings** section sits below it (history, not the document).

Per-body borders are removed inside the card (the card is the only frame). Bullet spacing stays at the recently-set `line-height: 1.15` with zeroed inner-`<p>` margins. Each section title sits ~6pt (≈8px) above its first line ("near touching").

**Section titles are uniform.** Pre-Brief and Open Floor titles render with the **same typography as topic titles** (serif / size / weight / color) — not the old copper uppercase mini-label. Pre-Brief/Open Floor titles are **static** (the section names are fixed); topic titles remain **editable** inputs.

---

## 3. Shared toolbar bound to the active editor

The per-body toolbars (Phase-1 inline toolbar) disappear in the Overview. One `EditorToolbar` is pinned at the card top and operates on the **currently-focused** body — like Word's ribbon.

Mechanics:
- A small **focus-context provider** (`EditorFocusProvider`, in `src/components/editor/`) wraps the card and holds `activeEditor` state + `setActiveEditor`.
- Each body editor, when run in **shared mode**, reports its TipTap editor instance via `setActiveEditor` on `focus`.
- The sticky toolbar renders `<EditorToolbar editor={activeEditor} …/>` and **subscribes to the active editor's `transaction`/`focus`/`blur`** so button active-states (bold on, in-a-list, etc.) reflect the cursor. Buttons are **disabled until a body is focused**.
- Toolbar buttons use `onMouseDown → preventDefault` (already the pattern) so clicking a button does **not** blur/deselect the active editor.
- ⌘K (link) still works from inside each body; the toolbar's link button operates on `activeEditor`. Both reuse one `promptLink(editor)` helper.

---

## 4. `RichBodyEditor` modes (keeps Working view unchanged)

`RichBodyEditor` gains a mode prop:
- **`inline`** (default) — today's behavior: its own bordered box + its own `EditorToolbar`. **Working view uses this, unchanged.**
- **`shared`** — chromeless: no border, no own toolbar; on focus it registers its editor with the `EditorFocusProvider`. **Overview's Pre-Brief, topics, and Open Floor use this.**

All other `RichBodyEditor` behavior (debounced save, unmount-flush-when-pending, placeholder, sanitize-on-load) is unchanged and shared by both modes.

---

## 5. Drag-to-reorder topics

Reorder already works (`@hello-pangea/dnd` + `handleTopicDragEnd`, which writes a fractional **midpoint `sortOrder`** between neighbors — a single-doc write). **No backend change.**

The only change the editable layout forces: the drag handle moves **off the whole-topic wrapper** (which would fight text selection in the now-editable body) **onto a dedicated grip**:
- A grip icon (lucide `GripVertical`) in the **left gutter** of each topic heading carries `dragHandleProps`; the wrapper keeps `draggableProps` + `ref`. Heading input + body stay freely editable.
- Grip is subtle, **revealed on topic-row hover**; the whole topic block (heading + body) lifts on drag with the existing highlight.
- **Only topics reorder.** "+ Add Topic" and Open Floor sit **outside** the `Droppable` (below it). Pre-Brief sits above the `Droppable`.

---

## 6. Data model + composed HTML

- **New field `agendas/{id}.preBriefHtml`** (string) — mirrors `openFloorHtml`. Writable by active VM users (same permissiveness as `openFloorHtml`; add to the V2.2 allowlist when the agenda-update field denylist lands).
- **`composeAgendaHtml(agenda, topics, …)`** gains the Pre-Brief body at the **very top** of the composed document (before topics; Open Floor stays last). Update its unit test accordingly. Pre-Brief/Open Floor titles in the composed output match the topic-title heading level.
- No migration needed (new empty field; placeholder shows until filled). Note: several real docx agendas already open with a "Pre-Brief" section — when the deferred docx population runs, that content maps to `preBriefHtml`, not a topic.

---

## 7. Components touched / added

- **New** `src/components/editor/EditorFocusProvider.jsx` (or a small context module) — `activeEditor` state + provider + the sticky shared-toolbar render helper.
- **Modify** `src/components/editor/RichBodyEditor.jsx` — add `mode` (`inline`|`shared`); in shared mode, drop chrome + register on focus.
- **Modify** `src/components/editor/EditorToolbar.jsx` — accept an externally-provided (possibly null) editor + subscribe to its transactions for reactive active-states; disabled when null.
- **Modify** `src/lib/agendaHtml.js` (+ test) — `composeAgendaHtml` includes Pre-Brief.
- **Modify** `src/pages/AgendaDetail.jsx` — Overview branch only: the single card + provider + sticky toolbar; `PreBriefSection`; restyle Open Floor title; grip handle on topics; remove per-body chrome. **`AgendaDetail` logic must not grow** — editor concerns live in the editor module. Working branch unchanged.

---

## 8. Out of scope (this round)

Working-view restyle / grip handle; Pre-Brief sticky-on-scroll (it's positioned at top, scrolls normally); export/email/AI consumers of `composeAgendaHtml` (Phase 3+); the deferred docx population for the other 4 agendas.

---

*End of spec.*
