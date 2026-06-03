# Pre-Brief Deprecation + Live Agenda Table of Contents — Design

- **Date:** 2026-06-03
- **Author:** Andrew (with Claude)
- **Session:** SES-20260602-Andrew-v0.3.1-backlog (backlog item #4)
- **Status:** Draft → reviewer loop
- **Scope:** Overview view only (Working view deferred)

## 1. Problem & Goal

The Meeting Agenda's **Pre-Brief** section is being retired. It's a single non-collaborative
rich-text field (`agenda.preBriefHtml`, rendered by `RichBodyEditor`) pinned to the top of the
Overview view. It no longer earns its place.

In its spot we add a **clickable, always-live Table of Contents** of the agenda's Topic Cards: a
"Contents" index a meeting facilitator can click to jump straight to any topic. The TOC must stay
in perfect sync as topics are created, deleted, reordered, or renamed — by the current user or, via
live collaboration, by anyone else in the room.

Two independent pieces of work:
1. **Deprecate Pre-Brief** — remove every code vestige; leave the stored data dormant.
2. **Add `AgendaTOC`** — a new component in the Overview view.

## 2. Decisions (settled in brainstorming)

| Decision | Choice |
|---|---|
| Pre-Brief stored data | **Leave dormant.** Remove all code/UI; do NOT touch the `preBriefHtml` field on existing agenda docs. Fully reversible, non-destructive. |
| TOC reach | **In-app only.** No anchor-link TOC in exported/emailed HTML. Export just loses the Pre-Brief section. |
| TOC contents | **Topics + master-org headers + Open Floor.** Mirror the Overview's per-org section grouping on master agendas. |
| Placement / behavior | **Static bordered "Contents" block** at the top of Overview (Pre-Brief's old spot), and **fully live** (reactive to add/delete/reorder/rename, including remote collaborators). |
| Views | **Overview only** this slice. Working view = deferred fast-follow. |
| Topic numbering | Numbered entries (`1.`, `2.`, …). |
| Org headers in TOC | Clickable (scroll to that org's first topic). |
| Empty agenda | TOC hides itself when there are zero topics. |

## 3. Core Principle — reactivity comes for free

The TOC holds **no state of its own**. It is a pure projection of the already-reactive `topics`
array that the Overview view already consumes:

```
useCollection("agendas/{agendaId}/topics", [orderBy("sortOrder","asc")]) → topics
```

This array is backed by Firestore `onSnapshot`, so every mutation re-renders the Overview — and the
TOC with it:

- **Create topic** → array gains an entry → TOC gains a row.
- **Delete topic** → row disappears.
- **Drag-reorder** → `sortOrder` rewrites → array re-sorts (already `orderBy sortOrder`) → TOC reorders.
- **Rename** → title commits to `name` on blur/Enter (`persistName` in `OverviewTopic`) → snapshot →
  TOC label updates. (Label updates on commit, not per keystroke — intentional, avoids flicker.)
- **Remote collaborator** does any of the above → the same `onSnapshot` fires for every client →
  all TOCs update.

There is no cache, no "build once on mount," no separate query. The component derives its rendered
list from the live array on every render. That is the entire reactivity story.

> Note: topic *body* edits ride Yjs/Liveblocks; topic *structure* (create/delete/reorder/rename)
> rides plain Firestore writes + `onSnapshot`. The TOC depends only on structure, so it does not
> touch Yjs at all, even though it renders inside the collab `RoomProvider`.

## 4. Part A — Pre-Brief Deprecation

Remove every code vestige across **client AND the AI serverless functions** (full deprecation —
the model must stop generating a Pre-Brief, not just have it dropped client-side). **Do not** delete
or migrate the `preBriefHtml` field on agenda docs (dormant data, reversible).

> **Footprint correction:** an earlier exploration pass reported "no Pre-Brief references outside
> `src/`." That was wrong — `api/ai/{prepare,refine,generate}.js` each **require + generate**
> `preBriefHtml`. The full grep-verified footprint is below. Verification re-grep must cover the whole
> repo (`api/` included), not just `src/`.

### 4.1 Client — render, editor, helpers
| File | Location | Action |
|---|---|---|
| `src/pages/AgendaDetail.jsx` | `PreBriefSection` fn (~482–501) | Delete the component. |
| `src/pages/AgendaDetail.jsx` | render call (~1822) | Delete `<PreBriefSection … />`. |
| `src/pages/AgendaDetail.jsx` | import (~82) | Remove the now-orphaned `RichBodyEditor` import — used **only** by `PreBriefSection` (Open Floor uses `CollabBodyEditor`). Sweep for any other imports/helpers orphaned by the deletion. |
| `src/lib/agendaHtml.js` | comment line 28, ~39–46 | Remove the Pre-Brief `<section>` (`pbHtml`/`preBrief` lines) from composed export/email HTML; drop "pre-brief" from the doc comment. |
| `src/lib/agendaVersions.js` | comment line 2, 41, 71 | Drop `preBriefHtml` from snapshot schema + restore. Old snapshots simply won't carry it forward (harmless). |
| `src/lib/__tests__/agendaHtml.test.js` | 58–71 | **Remove** both Pre-Brief tests. (The "omit when no content" test at 69–71 becomes input-identical to the Open-Floor-omission test at 51–53 — fully redundant, so delete rather than adjust.) |

### 4.2 Client — AI / Sync Meeting
| File | Location | Action |
|---|---|---|
| `src/lib/aiAgenda.js` | 259 | Remove `preBriefHtml` from the per-org agenda context object built for `orgAgendas`. |
| `src/lib/aiAgenda.js` | ~368, ~386 (comments) | Update comments that enumerate the proposal shape `(preBriefHtml/topics/openFloorHtml)` → `(topics/openFloorHtml)`. |
| `src/lib/aiAgenda.js` | 524–526 | Remove the `preBriefHtml: sanitizeHtml(proposal.preBriefHtml \|\| "")` line from the `applyUnified` agenda-doc `tx.update`; fix the "pre-brief + open floor" comment. |
| `src/components/SyncMeetingDialog.jsx` | ~201 | Drop `preBriefHtml` from the `prepareMeeting` `agenda` payload. |
| `src/components/SyncMeetingDialog.jsx` | ~245 (comment), 624 (UI copy) | Comment + the user-facing line "Applying replaces the **Pre-Brief**, topics, and Open Floor…" → "Applying replaces the topics and Open Floor…". |
| `src/pages/AIIntegration.jsx` | 53 | Help text "The meeting's existing **Pre-Brief**, topics, and Open Floor…" → "…existing topics and Open Floor…". |

### 4.3 Server — AI serverless functions
Three files share the same shape (output schema + system prompt + context-feed + response parse).
For **each** of `api/ai/prepare.js`, `api/ai/generate.js`, `api/ai/refine.js`:

- **Output schema** (`buildSchema`): delete the `preBriefHtml: { type: "string" }` property and remove
  `"preBriefHtml"` from the schema's top-level `required` array. (`additionalProperties:false` already
  forbids stray keys, so the model returns exactly the remaining fields.)
- **System prompt:** delete the `- preBriefHtml: a SHORT HTML pre-brief …` agenda-output bullet
  (prepare ~189, generate ~125). In `refine.js`, update the prose that enumerates the agenda shape —
  "(pre-brief, topics, open floor)" (~64) and "matching the schema: preBriefHtml, topics[…], openFloorHtml"
  (~77) → drop the pre-brief mentions.
- **Context feed:** remove the `if (a.preBriefHtml) lines.push(\`Pre-Brief (HTML): …\`)` line for the
  current agenda (prepare ~301, generate ~208) and the `if (oa.preBriefHtml) …` / `if (p.preBriefHtml) …`
  lines for other-org / draft agendas (prepare ~339, generate ~242, refine ~84).
- **Response parse:** remove `preBriefHtml: String(parsed.preBriefHtml || ""),` from the returned
  object (prepare ~468, generate ~313, refine ~139).

These three are the only consumers of that schema field; with the client no longer reading
`preBriefHtml`, removing it server-side is internally consistent. After the change the model never
spends tokens on a Pre-Brief and the apply path has nothing to write.

### 4.4 Verification target
After removal, `grep -rin "prebrief\|pre-brief" --include="*.js" --include="*.jsx"` over the **whole
repo** (excluding `node_modules`, `docs/`, `dev/`) returns **zero** functional matches. `npm run
build` clean; full vitest suite green. A real Sync Meeting AI generation on prod produces a valid
proposal with no Pre-Brief and applies cleanly (server-side prompt/schema change verified live).

Closes carried-forward deferral #4 (Pre-Brief structured redesign) as moot.

## 5. Part B — `AgendaTOC` Component

### 5.1 Placement
Rendered at the top of the Overview card body, in Pre-Brief's old position — inside
`EditorFocusProvider` and inside the `RoomProvider`, but **before** the topics `DragDropContext`.
It contains no editor, so it neither registers with `EditorFocusContext` nor touches Yjs.

### 5.2 Pure derivation (the testable unit)
Extract entry-building into a pure function so it can be unit-tested without the DOM:

```js
// returns ordered render list
buildTocEntries(topics, { isMaster, orgById, hasOpenFloor }) → Entry[]

// Entry shapes:
{ type: "org",       label: <org name>, anchorId: `org-${orgId}` }      // master only, on org change
{ type: "topic",     label: <topic.name || "Untitled">, anchorId: `topic-${topic.id}`, number: n }
{ type: "openfloor", label: "Open Floor", anchorId: "open-floor" }       // only if hasOpenFloor
```

Rules:
- Iterate `topics` in array order (already sorted by `sortOrder`).
- **Master agendas** (`isMaster === true`): emit an `org` entry whenever
  `topic.organizationId !== prevTopic.organizationId` — the exact rule the Overview uses to render
  `OrgSectionHeader` (`AgendaDetail.jsx:1839`). Resolve the label via `orgById[organizationId]`
  (fallback to a sensible placeholder if missing).
- **Topic numbering** is global and sequential across the whole agenda (org headers don't reset it).
- Empty title → label `"Untitled"` (matches the card's own placeholder semantics).
- Append the `openfloor` entry iff `hasOpenFloor` (Open Floor is always rendered on the page, so this
  is effectively always true; gate kept for testability + future-proofing).
- If `topics` is empty → return `[]`.

### 5.3 Rendering
- If `buildTocEntries(...)` is empty → render nothing (TOC hides on an empty agenda).
- Otherwise a bordered "Contents" card (styling consistent with the Overview card: `t` tokens,
  inline `sx`, `sectionTitleSx` for the "Contents" heading — matches existing agenda convention; no
  `styled()` wrapper, no new dep).
- `org` entries: clickable group subheading (optionally tinted with the org accent color), scrolls to
  `org-${orgId}`.
- `topic` entries: `n. Label`, clickable, scrolls to `topic-${topic.id}`.
- `openfloor` entry: clickable, scrolls to `open-floor`.
- Entries are buttons/links with proper `aria-label` and keyboard activation (Enter/Space) — no
  lazy a11y deferral.

### 5.4 Scroll behavior
- Click handler: `document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" })`.
  Native API — no `react-scroll` / new dependency.
- **Sticky-toolbar offset:** the Overview card has a sticky `SharedEditorToolbar`. A raw scroll would
  hide the target title behind it. Apply `scroll-margin-top` (CSS) to each anchor element equal to the
  toolbar's height (+ small gap) so the title lands just below the toolbar. The value is sourced from
  the actual toolbar height (constant or measured), not a magic guess; document the source in code.

### 5.5 Anchors to add
| Element | File:line (approx) | Anchor id |
|---|---|---|
| Topic wrapper Box | `AgendaDetail.jsx:1830` | `topic-${topic.id}` |
| `OrgSectionHeader` | `AgendaDetail.jsx:1840` (component def) | `org-${orgId}` (master only) |
| `OpenFloorSection` | `AgendaDetail.jsx:505` (root Box) | `open-floor` |

All ids derive from Firestore doc ids (stable across reorder). Add `scroll-margin-top` to these
anchor elements (or a shared `scroll-mt` style) so all jump targets clear the sticky toolbar.

## 6. Out of Scope (deferred)
- TOC in the **Working** view (fast-follow).
- TOC in **exported/emailed** HTML.
- Scroll-spy / active-topic highlighting as you scroll, sticky side-rail layout, collapsible TOC.
- Any deletion/migration of the dormant `preBriefHtml` data.

## 7. Testing & Verification
- **Unit:** `buildTocEntries` — flat list, master org-grouping (header emitted on org change only),
  empty agenda → `[]`, Open Floor presence/absence, untitled-topic fallback, global numbering.
- **Build/regression:** `npm run build` clean; full vitest suite green (incl. updated `agendaHtml`
  tests).
- **Live UI (hard gate, Vercel prod):** open a real agenda → TOC lists topics in order → click an
  entry → smooth-scrolls with the title clearing the sticky toolbar → add a topic (TOC row appears) →
  rename + blur (label updates) → drag-reorder (TOC reorders) → delete (row disappears) → open a
  master agenda and confirm org headers + grouping. Collaborative reactivity (a second user's
  add/reorder reflecting in the first user's TOC) verified with **two isolated browser profiles**, not
  same-browser tabs (per `feedback_verify_collab_isolated_profiles`). Note: structural changes ride
  Firestore `onSnapshot`, not Yjs, so the dual-yjs class of bug does not apply here — but isolated
  profiles remain the correct verification method for the live cross-user behavior.
- **Server AI deprecation (hard gate, Vercel prod):** after deploy, run one real Sync Meeting AI
  generation on a real agenda → proposal returns a valid agenda (topics + Open Floor, no Pre-Brief),
  the structured-output schema change holds (no 4xx / parse error), apply writes cleanly. Discard the
  gen (don't mutate real data) once confirmed.

## 8. Risks
- **Sticky-toolbar offset wrong** → titles tuck under the toolbar. Mitigation: source the offset from
  the real toolbar height; verify visually in the browser.
- **Master org label missing** (`orgById` lacks an id) → mitigation: fallback label; never throw.
- **react-beautiful-dnd interaction:** adding an `id` to the Draggable wrapper Box is inert for dnd
  (dnd keys off `draggableId`/refs, not DOM `id`). Confirm no clash during verification.
