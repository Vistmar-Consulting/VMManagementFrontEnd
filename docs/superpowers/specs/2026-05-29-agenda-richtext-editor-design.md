# Agenda Rich-Text Editor + Live Collaboration — Design Spec

**Date:** 2026-05-29
**Author:** Andrew Deemer + Claude (brainstorming session)
**Status:** Approved (design). Implementation plan + build to follow.
**Session:** SES-20260529-Andrew-v0.2.3-meeting-scheduler-polish

---

## 1. Goal

Turn the Meeting Agenda's editing experience into a Microsoft Word–style document. Today, Talking Points / Topic Notes / Open Floor are plain-text, one-bullet-per-Firestore-doc lists. We want freeform rich text — bullets, sub-bullets, numbered lists, indent/outdent, **underline**, bold/italic, and `cmd+K` hyperlinking — that reads and edits like a real working document, live-collaborative across the team, and stored in a format that cleanly powers downstream features (archival, export, email, and AI generation).

This spec covers **Phase 1 in build detail** and **Phases 2–4 as designed-for-future** so the foundation doesn't have to be reworked.

---

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Editor scope | The **whole agenda reads as a document.** Each topic = structured **title** + one **rich body** (Talking Points + Notes merged). **Open Floor** is also a rich body. The **Mini Project Board stays structured** (unchanged). |
| Editing model | **Live, Google-Docs-style collaboration** with presence + multiple cursors. |
| Editor library | **TipTap** (React layer over ProseMirror) — first-class Yjs/Liveblocks integration, extension-based so we enable exactly our feature set. |
| Realtime backend | **Hosted — Liveblocks** (managed Yjs sync + presence; free tier is ample at ~5 users). |
| Durable format | **HTML string** mirrored to **Firestore** — renders read-only directly, and is the format the future AI reads/writes. |
| Source of truth | Liveblocks (Yjs) is authoritative **while a room is live**; Firestore HTML is the durable mirror + seed for a fresh/evicted room. |

---

## 3. Architecture

Three layers, each with one responsibility:

```
  TipTap editor (React)         ← Word-like UI: toolbar, bullets, numbered
        ↕                          lists, indent, underline, cmd+K links
  Yjs document (CRDT)           ← in-memory collaborative state; merges
        ↕                          concurrent edits, drives cursors
  Liveblocks room (hosted)      ← realtime sync + presence/cursors
        ↓  (debounced, on change)
  Firestore: topic.bodyHtml     ← durable HTML snapshot — read-only render,
             agenda.openFloorHtml   system-of-record at rest, AI/export/email
```

- **Live editing** flows TipTap ↔ Yjs ↔ Liveblocks. Keystrokes never hit Firestore.
- **At rest / read-only / AI / export / email**, the canonical artifact is the **HTML snapshot in Firestore**, composed via a single shared utility (§7).

---

## 4. Editor (TipTap)

**Feature set (and nothing more — YAGNI):** bold, italic, **underline**, bullet list, **sub-bullets via indent/outdent**, numbered lists, and **`cmd+K` hyperlink** (with a small link-edit popover). Bold/italic are included as table-stakes alongside underline.

**Toolbar:** a compact Word-like toolbar on the body editor exposing exactly the above. No headings/images/tables/slash-commands in this design (headings are a one-line extension to add later if wanted).

**Components (new, extracted — do NOT grow `AgendaDetail.jsx`, already ~2,000 lines):**
- `RichBodyEditor` — the editable TipTap surface for one body (bound to a Yjs fragment in Phase 2; standalone in Phase 1).
- `RichBodyView` — sanitized read-only HTML render (for non-editor surfaces + previews).
- `EditorToolbar` — the formatting toolbar.

---

## 5. Data model + migration

### New fields (replace per-bullet subcollections)

| Field | Replaces | Holds |
|---|---|---|
| `agendas/{id}/topics/{topicId}.bodyHtml` (string) | `talkingPoints` + `notes` subcollections (merged) | the topic's freeform body |
| `agendas/{id}.openFloorHtml` (string) | `openFloor` subcollection | the Open Floor freeform body |

A topic becomes: **title → KPI strip → `bodyHtml` editor → Mini Project Board.** Title, `sortOrder`, category/tag ids, and the board are unchanged.

### Migration (one-off, client-side, admin-run; reversible)

For each topic: read `talkingPoints` (sorted) + `notes` (sorted), render to HTML (`<ul><li>…</li></ul>`, notes appended), write `bodyHtml`. Same for `openFloor` → `openFloorHtml`. Old subcollections are **left in place** (ignored) so the migration is reversible; a later cleanup pass deletes them. Since agendas will be repopulated with last week's content shortly after, this simply preserves existing content without ceremony.

---

## 6. Realtime + snapshot sync

**While editing:** TipTap ↔ Yjs ↔ Liveblocks handles merging + cursors. No Firestore involvement per keystroke.

**Liveblocks rooms:** one room **per agenda** (`room = agendaId`). Within it, each editor binds to a named Yjs fragment — `topic:<topicId>` per topic body, `openFloor` for the open-floor body. Presence/cursors therefore span the whole agenda while each section is its own editable surface.

**Snapshot to Firestore — client-side debounced write.** The active editor, after ~2s idle, writes its current HTML to `bodyHtml` / `openFloorHtml`. All clients share Yjs state, so concurrent writes converge on identical HTML (last-write-wins on an equal value — harmless). No server / Cloud Function required.

**Source-of-truth rules:**
- Liveblocks (Yjs) is authoritative while a room is live; Firestore HTML is the durable mirror.
- **On open:** connect to the room; for each fragment, **seed from Firestore HTML only if the Yjs fragment is empty** (brand-new room, or evicted from Liveblocks' free-tier persistence). If it already has content, use it — never clobber live state with possibly-stale Firestore.
- **No data loss on mid-edit close:** Liveblocks persists the Yjs doc; next open restores it even if the last debounce didn't reach Firestore. Firestore catches up on the next edit.

**Auth:** a Vercel function `/api/liveblocks-auth` verifies the Firebase ID token (same `@vistamarconsulting.com` + active-user gate) and mints a Liveblocks token scoped to the agenda's room. Liveblocks never sees an unauthenticated user.

**Presence/cursors:** Liveblocks presence → teammate avatars + live cursors/selections, colored via the existing avatar-color system.

**Both views (Working + Overview)** bind the **same room + fragments**, so edits in either sync instantly (the modern form of the existing "single hook instances for both views" rule).

---

## 7. Composed HTML — the shared artifact (archival, export, email, AI)

A pure, tested utility built in **Phase 1** even though its consumers ship later, so read-only render, archival, export, email, and AI input are all driven by ONE function rather than diverging:

```
composeAgendaHtml(agenda, topics) -> string  // one self-contained HTML document
```

= the **Overview content**: each topic's title + `bodyHtml` in order, then `openFloorHtml`. **Excludes** Mini Project Boards. Output is sanitized; an email/export variant inlines styles.

### 7.1 Conclude → archival snapshot (per-occurrence "version history")

This is **per-concluded-occurrence archival**, not continuous revision history. On **Conclude meeting**, in addition to setting status, write an immutable snapshot:

```
agendas/{id}/snapshots/{concludedAt} = {
  concludedAt, meetingDatetime, attendees[], composedHtml
}
```

Recurring agendas reuse one doc per series, so each concluded occurrence becomes one timestamped snapshot — any past meeting's agenda can be reopened exactly as it read that day. These snapshots also become the **AI's historical input** (§8).

### 7.2 Export to Word / PDF

From `composedHtml`: PDF via browser print-to-PDF (zero deps) or a lib; `.docx` via an HTML→docx converter.

### 7.3 Email agenda to attendees (formatted HTML)

`composedHtml` → an **inline-styles** pass (email clients strip `<style>`/classes) → sent via the existing meetings mail path. Automatable per occurrence.

---

## 8. AI-readiness (future; enabled, not built)

Because the durable format is **HTML — the same format the editor speaks** — generation is a clean round-trip:

1. Assemble inputs: each topic's `title` + `bodyHtml`, `openFloorHtml`, prior concluded `composedHtml` snapshot(s), plus structured context (attendees, board items).
2. Prompt → AI returns HTML bodies for **next** week's agenda.
3. Create a **new** agenda doc + topics, seeding each `bodyHtml` from AI output.
4. On open, the new room seeds from that HTML; the team refines live.

The AI **never edits a live room** — it produces a fresh agenda. Built under its own spec later.

---

## 9. Phasing

- **Phase 1 — editor + format foundation.** TipTap editor (single-user) on topic body + Open Floor; HTML snapshot ↔ Firestore; migration; sanitized read-only render (`RichBodyView`); `composeAgendaHtml()` utility (tested); both views. *Ship and validate Word-like editing + the data model before adding collab.*
- **Phase 2 — live collaboration.** Liveblocks + Yjs binding, presence/cursors, `/api/liveblocks-auth`, seed-if-empty rules.
- **Phase 3 — archival / export / email.** Conclude snapshots, Word/PDF export, formatted-HTML email (all consuming `composeAgendaHtml`).
- **Phase 4 — AI generation.** Separate spec.

---

## 10. Dependencies, environment, accounts

- **Packages:** `@tiptap/react` + extensions (`starter-kit` subset, `underline`, `link`, list/indent), `yjs`, `@liveblocks/client` / `@liveblocks/react` / `@liveblocks/yjs`, `dompurify`. (Phase-3 export adds an HTML→docx lib.)
- **Backend:** `/api/liveblocks-auth` (Vercel) + `LIVEBLOCKS_SECRET_KEY` (Vercel env) + `VITE_LIVEBLOCKS_PUBLIC_KEY` (client).
- **Account:** Liveblocks (free tier). **No Blaze required** — Liveblocks is the realtime layer; Firestore snapshot writes are fine on Spark.

---

## 11. Security

- **Sanitize all stored/AI-authored HTML on render** (DOMPurify) — prevents stored-XSS; the body is user- and AI-generated.
- **Liveblocks auth** gated by Firebase ID token (same domain/active-user rule as the rest of the app).
- **Firestore rules:** `bodyHtml` / `openFloorHtml` writable by active VM users (consistent with current agenda/topic permissiveness); add to the allowlist when the V2.2 agenda-update field denylist lands. Snapshots subcollection: create by active user, no update/delete (immutable; delete admin-only).

---

## 12. Risks / notes

- **Liveblocks free-tier limits** (MAU/connections) — ample at ~5 users; revisit if the team grows.
- **Vendor data path** — agenda content transits Liveblocks (accepted).
- **Snapshot convergence** — relies on all clients sharing Yjs state; equal-value writes make last-write-wins safe.
- **Email HTML fidelity** — requires the inline-styles pass; raw editor HTML won't render well in clients.
- **`AgendaDetail.jsx` size** — extract editor/view/compose into focused modules; do not grow that file.

---

## 13. Out of scope (YAGNI)

Continuous per-keystroke revision history; comments / suggestion mode; images / tables / headings; slash commands; export beyond Word/PDF; mobile-optimized editing.

---

*End of spec.*
