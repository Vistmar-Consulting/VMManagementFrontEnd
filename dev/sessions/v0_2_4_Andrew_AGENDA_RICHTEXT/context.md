# Session: SES-20260529-Andrew-v0.2.4-agenda-richtext

- **Session ID:** SES-20260529-Andrew-v0.2.4-agenda-richtext
- **Developer:** Andrew
- **Date:** 2026-05-29 (kickoff)
- **Version Start:** v0.2.4
- **Version End:** (pending)
- **Commit Start:** 96e0078
- **Branch:** main (push target: `origin/dev` via `git push origin main:dev`)
- **Task:** Resume the Agenda Rich-Text Editor — Phase 1, from Task 5. Tasks 1–4 (deps, tested HTML utils, RichBodyView, TipTap v3 editor+toolbar) are DONE + committed on local `main`.
- **Folder:** dev/sessions/v0_2_4_Andrew_AGENDA_RICHTEXT/
- **Status:** active

## Source-of-Truth Docs (read order)

1. `CLAUDE.md` (project) + `~/.claude/CLAUDE.md` (global) — non-negotiable conventions
2. **Spec:** `docs/superpowers/specs/2026-05-29-agenda-richtext-editor-design.md` (Phase 1 in build detail; Phases 2–4 designed-for-future)
3. **Plan (authoritative task list):** `docs/superpowers/plans/2026-05-29-agenda-richtext-editor-phase1.md` — resume at Task 5
4. **Prior session archive:** `dev/sessions/v0_2_3_Andrew_MEETING_SCHEDULER_POLISH/context.md` — full v0.2.3 history + the `v0.2.4 — Agenda rich-text editor (Phase 1)` live-state section

## Execution method

`superpowers:subagent-driven-development` on local `main` (project convention overrides the skill's worktree requirement — confirmed from prior session). Fresh implementer per task + two-stage review (spec compliance, then code quality).

## Phase 1 — state at session start

**DONE + committed (Tasks 1–4):**
- `e23ec63` deps: TipTap **v3.23** + dompurify (v3 — StarterKit bundles Link/Underline; Placeholder NOT bundled)
- `0b543b2` `src/lib/agendaHtml.js` — bulletsToHtml, sanitizeHtml, **mergeBodyHtml**, composeAgendaHtml — **11 Vitest tests pass** (verified this session)
- `69264c5` `src/components/editor/RichBodyView.jsx`
- `6e03d4d` (+`18e5086` cleanup) `src/components/editor/{EditorToolbar,RichBodyEditor}.jsx` — TipTap v3 editor, HTML out, debounced save, unmount-flush
- composeAgendaHtml reads `t.title ?? t.name` (real topic title field is `name`)

**MUST-FIX known issue (do in T6/T7 where browser-verifiable):** editor PLACEHOLDER text doesn't render. StarterKit v3 does NOT bundle the Placeholder extension; the existing `data-placeholder`/`is-editor-empty` CSS has nothing to hook. Fix: register `Placeholder` (from `@tiptap/extensions`) in `RichBodyEditor`. Verify empty-state ghost text live.

**Tech notes:**
- TipTap is **v3.23** — `StarterKit.configure(...)` bundles Link/Underline; do NOT double-register. `@tiptap/extension-underline` + `-link` are installed-but-unused (optional tiny cleanup).
- `src/firebase.js` exports `db` (named).
- `AgendaDetail.jsx` is ~2,000 lines — editor lives in `src/components/editor/*`; KEEP it extracted.
- `t` design tokens: `src/theme/tokens.js`.

## Remaining Phase 1 (resume here, in order)

- **T5** — `src/lib/migrateAgendaBodies.js` (Firestore walk; `mergeBodyHtml` already done). Plan Task 5 step 5 + commit (step 6).
- **T6** — wire `RichBodyEditor` into Overview view (`OverviewTopic` + `OpenFloorSection`); drop `talkingPoints`/`openFloor` subscriptions; bind `topic.bodyHtml` / `agenda.openFloorHtml`; **fix placeholder**; browser-verify.
- **T7** — wire into Working view (`AgendaTopicCard`); **REMOVE `TopicNotesSection` component + its render call** (notes merge into bodyHtml); leave KPI strip + MiniProjectBoard untouched; browser-verify.
- **T8** — migration on live data: dev hook → dry-run → **Andy's explicit OK** → live migrate → remove hook. Production write; gated.
- **Population** — convert `docs/Existing_Agendas/*.docx` (5 real last-week agendas: Bryn Mawr, Golden Vision, ID Care, Unio Biweekly, Unio Weekly) → HTML via **mammoth.js**; populate matching agendas' `bodyHtml`. Runs after editor+format exist so render is verifiable. (`~$…docx` = Word lock file, ignore.)

## Conventions for this session

- context.md is the single source of truth (no HANDOFF/DEFERRED files).
- UI HARD GATE: drive `/agent-browser` (Profile 10, authed) to verify every UI change before reporting done. Don't kill the running dev server (5173). A different project's dev app may sit on localhost:5180 — ignore it.
- Pre-push: code review on non-trivial batches. Push `origin/dev` only (`git push origin main:dev`); never main/stage on remote.
- Phases 2 (Liveblocks/Yjs collab), 3 (Conclude→snapshot + Word/PDF export + HTML email), 4 (AI next-agenda generation) are designed-for in the spec — do NOT start until Phase 1 ships + Andy says go.

## Deferred (live tracker — carried forward from closed v0.2.3 session)

### Rich-text editor (this session's primary work)
- Phase 1 T5–T8 + docx population — see "Remaining Phase 1" above.
- After migration is stable: delete migrated `talkingPoints`/`notes`/`openFloor` subcollections (cleanup pass).
- **ActionBar "Send Meeting Prep" email open-floor staleness** (Q for Andy) — `openFloorItems` subscription (`AgendaDetail.jsx:~1759`) → email payload (`:888`) reads the legacy `openFloor` subcollection, which stops being edited after the cutover+migration. Email Open Floor goes stale. Proper fix: Phase-3 `composeAgendaHtml`-based email. Decide: Phase 1 or Phase 3.

### Fireflies (carried)
- Finish mapping the ambiguous/duplicate-doc titles on `/fireflies` (list in prior context.md).
- Clean up duplicate base+`_R` agenda docs (recurring artifact).
- Vercel **preview** env var for `VITE_FIREFLIES_KEY` (prod is set).
- Re-authorize `personal-gmail` MCP (`invalid_grant`).
- seo@/Fireflies bot auto-join investigation (Fireflies-dashboard config).

### Carried from V2
- Reconcile the 2026-05-20 V2 design spec (add SUPERSEDED header → current model).
- Rewrite the 2026-05-27 meeting-scheduler plan for Vercel + Azure KV direction.
- `agenda-email.js` "View full agenda in Console" user-facing string.
- `detectCadence` could read the real recurrence rule instead of guessing (minor).

### V1 polish (residue) / V3 — raise only if Andy does
- Firebase Storage init (Blaze); auth-onCreate trigger (Blaze); Project Board DnD reorder; `useItems` pagination; Members/Settings stub pages; KanbanBoard dead route; etc.
- V3: AI-driven Project Board updates (Fireflies + agendas → statusId 8 AI Gen items); Task file uploads (Blaze); SQL migration script.

## Tasks (this session)

### T5 — migrateAgendaBodies.js ✅ (commit `8d06f1c`)
Created `src/lib/migrateAgendaBodies.js` verbatim from plan (Firestore walk; `mergeBodyHtml`/`bulletsToHtml` already committed). Idempotent (skips non-empty `bodyHtml`/`openFloorHtml`); `dryRun` defaults true. Build green. **Carry to T8:** the legacy-bullet reads use `orderBy("sortOrder","asc")` — if any legacy `talkingPoints`/`notes`/`openFloor` doc lacks `sortOrder`, Firestore silently drops it. The T8 dry-run report counts are the safety gate that surfaces this before any live write.

### T6 — Overview editor + placeholder fix ✅ (commit `223a277`) — BROWSER-VERIFIED
`OverviewTopic` + `OpenFloorSection` cut over to `RichBodyEditor` (topic→`bodyHtml`, open floor→`agenda.openFloorHtml`); dropped `talkingPoints`/`openFloor` render subscriptions; deleted now-orphaned `OpenFloorRow`; `agenda` prop threaded to both `<OpenFloorSection>` call sites. **Placeholder fixed:** registered `Placeholder` from `@tiptap/extensions` in `RichBodyEditor`, replaced dead CSS with canonical `& p.is-editor-empty:first-child::before { content: attr(data-placeholder) }`.
- **Live verification (Profile 10, authed, Unio agenda):** placeholder ghost text renders for both editors ("Add open-floor items…" / "Add talking points…"); bullet+bold formatting works; **persistence round-trips** verified for both `openFloorHtml` (reload) and `topic.bodyHtml` (Firestore read-back). Test data fully cleaned up (agenda back to 0 topics, `openFloorHtml: null`).
- **Technique note:** ran Firestore ops via `agent-browser eval` with dynamic imports `import('/src/firebase.js')` + `import('/node_modules/.vite/deps/firebase_firestore.js?v=<hash>')` (MUST include the `?v=` version query so `db` and the fns share one module instance). **T8 can run the migration the same way:** `import('/src/lib/migrateAgendaBodies.js')` then call the export — no `window` dev hook needed.

### ⚠️ Cross-cutting concern for ANDY (out of T6/T7 scope — decision needed)
The agenda-level `openFloorItems` subscription (`AgendaDetail.jsx:~1759`) still reads the legacy `openFloor` subcollection and feeds `ActionBar`'s **"Send Meeting Prep" email** payload (`:888`, `openFloor: items.map(it => ({Discussion_Item: it.text}))`). After the editor cutover + migration, open-floor edits flow to `openFloorHtml`, NOT the subcollection — so the Meeting Prep email's Open Floor section goes **stale/frozen** at its pre-migration content. Left untouched (scope discipline). Proper fix is Phase-3 (email consumes `composeAgendaHtml`). **Q for Andy:** address in Phase 1, or defer to Phase 3? (Tracked in Deferred.)

### Code review + PUSH ✅ (commit `f22d2e4`; pushed `96e0078..f22d2e4 main → origin/dev`)
Ran `superpowers:requesting-code-review` on the 4-commit batch. No Critical. Fixed: **#1 (Important)** declared `@tiptap/extensions` in package.json (was used by RichBodyEditor but only resolved via transitive hoist — latent build-breaker); **#2** removed now-dead `@tiptap/extension-link` + `@tiptap/extension-underline` (StarterKit v3 bundles them); **#3** refreshed the stale `AgendaDetail.jsx` file-header docstring; **#4** commented why the migration omits `updatedAt`/`updatedByUid`; plus removed an Emotion `:first-child` SSR console warning (`→:first-of-type`, behavior unchanged). #5 (merged body drops TP/Notes labels) = intended design, conscious accept. Build green; placeholder re-verified. Pushed to origin/dev (5 commits). **`docs/Existing_Agendas/*.docx` deliberately NOT committed** — real client agenda files; left untracked (don't commit client data to repo without Andy's say). `~$…docx` lock file also untracked.

### T7 — Working view editor + remove TopicNotesSection ✅ (commit `93afa77`) — BROWSER-VERIFIED
`AgendaTopicCard`: dropped `talkingPoints` subscription; rendered `RichBodyEditor` (→`topic.bodyHtml`) BETWEEN the KPI strip and `MiniProjectBoard`; removed `<TopicNotesSection>` render + deleted the `TopicNotesSection`, `BulletRow`, `AddBullet` defs (fully orphaned after the cutover) + now-unused `useRef`/`Close` imports. KPI strip + MiniProjectBoard untouched. 238 deletions.
- **Live verification (Working view, Unio agenda):** card layout = KPI strip → editor ("Add talking points…") → MiniProjectBoard (empty-state), **no Topic Notes**. Typed in Working view → persisted to `topic.bodyHtml`; **cross-view sync** confirmed (Working edit shows in Overview, same field). Grep checks: zero `BulletRow`/`AddBullet`/`TopicNotesSection`; no topic-level `talkingPoints`/`notes` `useCollection` left. Test topic cleaned up.

### Fix — RichBodyEditor spurious unmount write ✅ (commit `88c5882`) — BROWSER-VERIFIED
Found during T7 verification: the unmount cleanup called `onChangeHtml` unconditionally, so **opening an agenda and navigating away wrote `"<p></p>"`** to `bodyHtml`/`openFloorHtml` even with no edit — polluting untouched bodies, emitting spurious `updatedAt`/`updatedByUid`, and (truthy) making the **idempotent migration skip real content**. Fixed: flush on unmount ONLY when a debounced edit is pending (`debounceRef.current` set). Verified: open+navigate-away without typing now leaves the field `null`; normal debounced save + quick-nav flush both preserved. (Inline correctness fix per [[feedback-no-lazy-deferrals]]; protects T8.)

### agent-browser op notes (this session)
- Profile-10 auth works via `agent-browser --profile "Profile 10" open ...` (inherits Andy's @vistamar Google SSO). Default session is unauthed (→/signin).
- Calendar meeting-list fails in local dev ("Unexpected token '/'…") — the Vercel `/api/meetings/*` routes don't run under Vite. Reach agendas by direct URL `/agendas/:id` instead.
- The segmented Working/Overview toggle didn't respond to agent-browser's coordinate `click`; native DOM `.click()` via `eval` works (React delegated handler). Default `viewMode` is `"overview"`.
- Session occasionally navigates itself to `/calendar` (stale-ref click / "pulled away" behavior noted in v0.2.3). Re-open the agenda URL when it happens.

### T8 — live migration ✅ (Andy-approved 2026-05-29) — DONE
Dry-run: `{topics:2, openFloors:0, skipped:0}` across 32 agendas. Investigated the low count — it's accurate, NOT an `orderBy` artifact (legacy `talkingPoints` docs DO carry `sortOrder`); the agendas are mostly empty recurring shells, only 4 topics exist total (2 with content), 0 open-floor docs anywhere. **Andy approved live write.** Ran `migrateAgendaBodies({dryRun:false})` → 2 topics migrated. Both are dev TEST topics ("Test TOpic"→`<ul><li>Ok is this working?</li></ul>`, "asd"→`<ul><li>asdas</li></ul>`) — converted correctly, verified vs originals + rendered in editor UI. Idempotent re-run confirms `{topics:0, skipped:2}`. No code hook to remove (ran via dynamic `import('/src/lib/migrateAgendaBodies.js')` in agent-browser eval, not a `window` hook). ActionBar email staleness: **Andy chose defer to Phase 3.**

### Population — docx→HTML for 5 real agendas — BLOCKED on agenda-doc matching (Andy decision needed)
Parsed all 5 `docs/Existing_Agendas/*.docx` via `mammoth` (installed `--no-save`, NOT in package.json; one-off parse script at `/tmp/parse_agendas.cjs`, output `/tmp/parsed_agendas.json`). Findings:
- **Heading-style heterogeneity:** ID Care (8 topics) + Unio Weekly (9 topics) use plain `<p>Heading</p>+<ul>`; Golden Vision, Bryn Mawr, Unio Biweekly use real `<h1>Heading</h1>` + `<ol>`/`<ul>` + nested sub-bullets + links. A robust sectionizer must split on `<h1>` OR `<p>`-before-list and capture all content (incl. `<ol>`, nested `<ul>`, `<a>`) to the next heading. Our `sanitizeHtml` allowlist (`p/br/ul/ol/li/strong/em/u/a/span`) covers all of it.
- **BLOCKER — target-agenda matching is ambiguous** (entangled with the deferred duplicate base+`_R` doc cleanup): Bryn Mawr → 5 candidate docs (BMD - Biweekly ×2, BMD - Marketing, BMD Marketing ×2); Golden Vision → "GV – Biweekly" vs "GV-Vistamar Bi-Weekly Mtg" ×2; ID Care → "ID Care - Biweekly" ×2 (holds the 2 migrated test topics) vs "ID Care – Marketing Committee"; **Unio Biweekly → no obvious matching doc** (only "Unio Weekly Marketing Meeting" exists under a Unio title); all candidates are future-dated (Aug) recurring instances. **Will not guess client content onto the wrong recurring agenda.** Needs Andy to pick the exact target doc ID per docx (and likely the duplicate-doc cleanup first).
- Parsing approach validated; once targets are confirmed, build the sectionizer → dry-run preview (target doc + topic list per docx) → Andy OK → write. Same gate pattern as T8.
- **DONE (Andy-approved 2026-05-29): Unio Weekly only.** Created 9 topics on "Unio Weekly Marketing Meeting" (`0u55qjoteslnrjsmftmlinea7i_R20260407T200000`, was 0 topics) from `Unio – Weekly – 2026-05-26.docx` — This Week's Priorities (5) / CyberKnife Open House (4) / Project Marina (7) / CNN Interview Follow-up (3) / Provider Profile Updates (3) / PPC + Content (9) / Local SEO + Reviews (4) / Open Access Colonoscopy + Legal (4) / Ops + Misc (4). Written via base64 eval (`/tmp/gen_unio_eval.cjs`), idempotency-guarded (aborts if topics exist), createdByUid=Andy. **Browser-verified:** all 9 render with bullets in the editor; em-dash/arrow/`$` intact. This file was plain `<ul>` only (no ol/nested/links).
- **DEFERRED (4 remaining docx):** Bryn Mawr, Golden Vision, ID Care, Unio Biweekly — blocked on target-agenda matching (see BLOCKER above). Needs the duplicate base+`_R` doc cleanup first, then per-docx target confirmation + the richer sectionizer (h1 headings, ol, nested bullets, links).

## v0.2.4.b — Overview "Word-doc" redesign (COMMITTED + pushed to origin/dev → Vercel 2026-05-29; commits `aea55f2` feature, `9c9d3b0` shell-sticky-fix, `c7e50a7` comment)

**Spec:** `docs/superpowers/specs/2026-05-29-agenda-overview-worddoc-layout-design.md` (committed). **Scope: Overview view only; Working view untouched.**

**Built + browser-verified (NOT committed — Andy wants to keep iterating before commit):**
- **Bullet spacing fix** (earlier): RichBodyEditor/RichBodyView line-height 1.6→1.15 + `& li p { margin: 0 }` (TipTap wraps each `<li>` in a `<p>` with 13px margins — the real gap culprit).
- **Single-card layout:** Overview branch wraps toolbar + Pre-Brief + topics + AddTopic + OpenFloor in ONE white card (`EditorFocusProvider` + card Box). Attendees above card; PastMeetings below.
- **Shared toolbar infra (new files in `src/components/editor/`):** `editorFocus.jsx` (context+provider+`useEditorFocus`), `linkHelper.js` (`promptLink`), `SharedEditorToolbar.jsx`. `EditorToolbar.jsx` now takes a nullable editor (disabled when none) + subscribes to its transactions for reactive active-states. `RichBodyEditor.jsx` gained `mode`: `inline` (default — own toolbar+border, **Working unchanged**) vs `shared` (chromeless, registers editor on focus). Verified: focusing a body enables the toolbar + lights the correct buttons.
- **Pre-Brief:** new field `agenda.preBriefHtml`; `PreBriefSection` at top of card (shared mode). Verified it saves. `composeAgendaHtml` now emits Pre-Brief at the very top (+ 2 new tests; 13/13 pass).
- **Uniform section titles:** shared `sectionTitleSx` — topic headings (editable inputs), Pre-Brief + Open Floor (static `Typography`) all match (serif/15/700/ink + copper underline, mb 6px ≈ 6pt).
- **Grip drag handle:** `dragHandleProps` moved from the whole-topic wrapper to a dedicated grip (`lucide GripVertical`, hover-reveal in left gutter) passed into `OverviewTopic`; wrapper keeps `ref`+`draggableProps`. Reuses `handleTopicDragEnd` (fractional sortOrder, unchanged). Verified DOM: grip IS the handle, wrapper is NOT (text selection safe). **NOT verified: the actual drag** — `@hello-pangea/dnd` resists synthetic/keyboard events in automation; **Andy to confirm the grab feels right.**

**DEFERRED (Andy's calls):**
- **Sticky toolbar** — chosen "always visible/sticky" but currently INERT: app shell (`SignedInLayout.jsx`) scrolls the WINDOW while `<main>` has `overflow:auto`, scoping `position:sticky` to a non-scrolling element. Fix = make `<main>` the scroll container (outer `minHeight:100vh`→`height:100vh`+`overflow:hidden`; sidebar+topbar become fixed) — touches ALL pages, so **Andy chose "keep non-sticky for now, revisit later."** `position:sticky` left in `SharedEditorToolbar` with a comment (auto-engages if the shell changes).
- Working-view grip upgrade (its body is editable too — same latent whole-card-drag conflict) — noted follow-up, not this round.

**Files:** NEW `src/components/editor/{editorFocus.jsx,linkHelper.js,SharedEditorToolbar.jsx}`; MOD `src/components/editor/{RichBodyEditor.jsx,EditorToolbar.jsx,RichBodyView.jsx}`, `src/pages/AgendaDetail.jsx` (Overview branch + OverviewTopic/PreBriefSection/OpenFloorSection + sectionTitleSx + hero cleanup + toggle move), `src/lib/agendaHtml.js` (+test), `src/layouts/SignedInLayout.jsx` (sticky shell fix). **Committed + pushed to origin/dev (deploys via Vercel).** Pre-push code review run: no Critical; fixed the stale sticky comment; Working-view bullet-spacing change (1.15) confirmed intended + browser-verified Working view fully intact (own inline toolbar, KPI, board, attendees, org, recurring).

**agent-browser op note:** session got pulled to `localhost:5180` (other project's `ga-kpi-preview`) mid-run repeatedly — only ONE tab exists and it keeps returning to 5180. Workaround: chain `open 5173 → wait → eval/screenshot` in ONE bash call (no long gaps) and verify `location.href` inside the eval.

### v0.2.4.c — Overview hero cleanup + sticky toolbar (UNCOMMITTED, continued)
- **Hero cleanup (Overview-only; Working untouched):** removed "Recurring meeting" label, the Organization label+pill, and the attendee chip strip FROM OVERVIEW. Recurrence + Org row are now guarded `viewMode !== "overview"` (still show in Working). **Org pill kept in Working because it's the only control to assign/change the agenda's org** (MiniProjectBoard depends on it). Deleted the now-dead `AttendeeChipStrip` component. Working's `AttendeesPanel` (sidebar) untouched. Overview hero now = title + clickable schedule only.
- **View toggle moved:** Working/Overview toggle relocated from absolute top-right to centered under the schedule (title → schedule → toggle = a centered interactive-controls column). Hero container no longer needs `position:relative`.
- **Sticky toolbar — DONE (Andy reversed the earlier defer; insisted it's necessary).** Root cause was `<main>` in `SignedInLayout.jsx` carrying `overflow:auto` while the column isn't height-constrained (window scrolls) — that `auto` scoped & killed `position:sticky`. **Minimal fix: `<main>` `overflow:auto`→`overflow:visible`** (it was a no-op auto; window-scroll model + scrolling sidebar/topbar unchanged). Verified: toolbar pins at `top:0` on scroll (Overview); `/board` renders + scrolls fine (no regression). `SharedEditorToolbar`'s `position:sticky` now actually engages. (Andy's proposed "remove Pre-Brief anchor" idea was unrelated to the real cause — corrected.)

### NEW design space — AI Prompt Management & AI-Forward Agendas (Andy's HIGHEST priority, 2026-05-29)
Created `dev/Features/AI Prompt Management/` (README = full vision capture + open questions; `prompts/refresh-agenda.v0.md` = first draft to iterate). **"Heart and soul of the app"** per Andy; all deferred, needs a dedicated deeper design session. Memory [[v3-ai-feature-intent]] expanded with the full scope. Key points: AI generates Pre-Brief + moves agendas forward + creates (statusId 8) / promotes tasks; inputs incl. Fireflies + INTERNAL Vistamar team meetings; **per-org-editable prompts** (Settings default prompts + Org Settings overrides/additions, Firestore-stored); human oversight modals (confer/confirm); **admin-only** (`@vistamar`).

### Deferred — Pre-Brief structured redesign + interactive checkboxes (ties to the AI feature)
Move Pre-Brief off freeform `preBriefHtml` → **structured per-topic checklist**: each topic row = title + (hard due date in parens, only real deadlines) + one-line this-week reminder (AI-drafted, human-edited; can ship human-entry-first). Each row has an **interactive checkbox**; once ≥1 checked, **unchecked topics fade (lower opacity)** in the agenda below — "skip these" signal — still visible + editable. New topic fields: `weekBrief`, `dueDate`, `isHardDeadline`, per-meeting `covered`/`selected`. Topic bodies stay HTML. Conflicts with current freeform pre-brief → migration. The current `preBriefHtml` (incl. the sample I wrote on Unio) is the interim freeform version.

### Deferred — Overview attendee features (Andy flagged; design later)
- **Intelligent first-name attendee pills in Overview:** show attendee FIRST names as clickable pills; clicking highlights every agenda line mentioning that name — lets a user review "what they're on the hook for" before/during a meeting. (Replaces the removed chip strip with something useful.)
- **External-attendee → org persistence (Andy: "critical design"):** when creating a meeting and adding a non-@vistamarconsulting.com person, save that person to the org. The "add external user" email+name inputs become text-entry + dropdowns that select known persons from the org's saved people — so you don't re-type email+name every meeting. Needs a per-org people store + lookup. Establish before meeting-creation UX gets annoying.

## Files Modified

- `dev/sessions/v0_2_4_Andrew_AGENDA_RICHTEXT/context.md` — created (this file)
- `dev/SESSION_INDEX.json` — this entry added `status: active`
