# Pre-Brief Deprecation + Live Agenda TOC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Pre-Brief feature everywhere (client + AI serverless functions; leave stored data dormant) and replace it with a fully-live, clickable Table of Contents of the agenda's Topic Cards in the Overview view.

**Architecture:** The TOC holds no state — it's a pure projection of the already-reactive `topics` array (`useCollection` → Firestore `onSnapshot`), so create/delete/reorder/rename (local or remote-collaborator) reflect automatically. A pure `buildTocEntries()` derives an ordered render list (master-org-aware + Open Floor); a thin `AgendaTOC` component renders it and smooth-scrolls to DOM anchors (`topic-{id}`, `org-{orgId}`, `open-floor`) added to the existing section elements, with a `scroll-margin-top` offset to clear the sticky toolbar.

**Tech Stack:** React 18, Vite, MUI 5 (inline `sx`), Firestore Web SDK, Vitest. No new dependencies (native `scrollIntoView`).

**Spec:** `docs/superpowers/specs/2026-06-03-prebrief-deprecation-agenda-toc-design.md`

**Conventions:** Functional components + hooks; inline `sx` with `t` tokens (no `styled()` in agenda files); no `console.log`; no commented-out code; no dead imports. Commit after each task. **Do NOT push** — stop at the deploy gate (Task 8).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `api/ai/prepare.js`, `api/ai/generate.js`, `api/ai/refine.js` | AI serverless schema/prompt/parse | Modify — strip `preBriefHtml` |
| `src/lib/aiAgenda.js` | Client AI proposal build + apply | Modify — strip `preBriefHtml` |
| `src/components/SyncMeetingDialog.jsx` | Sync Meeting UI + payload | Modify — strip `preBriefHtml` + copy |
| `src/pages/AIIntegration.jsx` | AI help copy | Modify — copy only |
| `src/lib/agendaHtml.js` | Export/email HTML composition | Modify — remove Pre-Brief section |
| `src/lib/agendaVersions.js` | Snapshot/restore | Modify — drop `preBriefHtml` |
| `src/lib/__tests__/agendaHtml.test.js` | Compose tests | Modify — remove 2 Pre-Brief tests |
| `src/pages/AgendaDetail.jsx` | Overview/Working views + sections | Modify — delete `PreBriefSection`, add anchors, render `AgendaTOC` |
| `src/lib/agendaToc.js` | **NEW** pure `buildTocEntries()` | Create |
| `src/lib/__tests__/agendaToc.test.js` | **NEW** unit tests | Create |
| `src/components/AgendaTOC.jsx` | **NEW** TOC render + scroll | Create |

---

## Task 1: Server AI — strip Pre-Brief from the three serverless functions

**Files:**
- Modify: `api/ai/prepare.js`, `api/ai/generate.js`, `api/ai/refine.js`

The three share the same shape: output schema (`buildSchema`), system prompt, context-feed (`lines.push`), and response parse. Apply the matching removals in each. (Line numbers approximate — match by content.)

- [ ] **Step 1: `api/ai/prepare.js`**
  - In `buildSchema`, delete the property line `      preBriefHtml: { type: "string" },` (~55).
  - In the same schema's top-level `required`, change `required: ["preBriefHtml", "topics", "openFloorHtml", "boardChanges"],` → `required: ["topics", "openFloorHtml", "boardChanges"],` (~109).
  - In the system prompt, delete the agenda-output bullet line `- preBriefHtml: a SHORT HTML pre-brief framing this meeting (a few tight bullets), or "" if not warranted.` (~189).
  - Delete the current-agenda context line `  if (a.preBriefHtml) lines.push(\`Pre-Brief (HTML): ${a.preBriefHtml}\`);` (~301).
  - Delete the other-org context line `      if (oa.preBriefHtml) lines.push(\`Pre-Brief: ${oa.preBriefHtml}\`);` (~339).
  - In the response parse, delete `      preBriefHtml: String(parsed.preBriefHtml || ""),` (~468).
  - Update the schema doc-comment (~29) so it no longer says "(preBriefHtml, topics[]…)".

- [ ] **Step 2: `api/ai/generate.js`**
  - Same six edits: schema property (~48) + `required` (~55), prompt bullet (~125), current-agenda context (~208), other-org context (~242), response parse (~313).

- [ ] **Step 3: `api/ai/refine.js`**
  - Delete schema property `      preBriefHtml: { type: "string" },` (~34) and remove `"preBriefHtml"` from `required: ["preBriefHtml", "topics", "openFloorHtml"],` → `required: ["topics", "openFloorHtml"],` (~38).
  - Prompt prose: line ~64 "...the current draft (pre-brief, topics, open floor)..." → "...the current draft (topics, open floor)..."; line ~77 "...matching the schema: preBriefHtml, topics[...], openFloorHtml." → "...matching the schema: topics[...], openFloorHtml."
  - Delete draft context line `  if (p.preBriefHtml) lines.push(\`Pre-Brief (HTML): ${p.preBriefHtml}\`);` (~84).
  - Delete response parse `      preBriefHtml: String(parsed.preBriefHtml || ""),` (~139).

- [ ] **Step 4: Verify no server Pre-Brief refs remain**

Run: `grep -rin "prebrief\|pre-brief" api/`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add api/ai/prepare.js api/ai/generate.js api/ai/refine.js
git commit -m "feat(ai): stop generating Pre-Brief in agenda AI functions (deprecation)"
```

> Note: these are serverless functions — local `npm run build`/vitest do not exercise them, and the local dev server proxies `/api/*` to the DEPLOYED backend. Functional verification happens post-deploy (Task 8).

---

## Task 2: Client AI — strip Pre-Brief from aiAgenda + Sync Meeting + copy

**Files:**
- Modify: `src/lib/aiAgenda.js`, `src/components/SyncMeetingDialog.jsx`, `src/pages/AIIntegration.jsx`

- [ ] **Step 1: `src/lib/aiAgenda.js`**
  - In the per-org agenda context object (~255–261), delete the line `          preBriefHtml: a.preBriefHtml || "",` (~259).
  - In `applyUnified`'s agenda-doc `tx.update` (~525), delete the line `      preBriefHtml: sanitizeHtml(proposal.preBriefHtml || ""),` (~526). Update the preceding comment (~524) "// Agenda doc: pre-brief + open floor + the anchor…" → "// Agenda doc: open floor + the anchor…".
  - Update the two proposal-shape comments (~368, ~386): "(preBriefHtml/topics/openFloorHtml…)" / "({ preBriefHtml, topics, openFloorHtml, boardChanges })" → drop `preBriefHtml`.

- [ ] **Step 2: `src/components/SyncMeetingDialog.jsx`**
  - In the `prepareMeeting` `agenda` payload (~197–202), delete `          preBriefHtml: agenda?.preBriefHtml || "",` (~201).
  - Update the comment at ~245 that mentions "topics/preBrief/openFloor" → "topics/openFloor".
  - UI copy at ~624: "Applying replaces the Pre-Brief, topics, and Open Floor, and writes the checked board changes —" → "Applying replaces the topics and Open Floor, and writes the checked board changes —".

- [ ] **Step 3: `src/pages/AIIntegration.jsx`**
  - Help text at ~53: `["Current agenda", "The meeting's existing Pre-Brief, topics, and Open Floor — the starting point it moves forward."]` → `["Current agenda", "The meeting's existing topics and Open Floor — the starting point it moves forward."]`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiAgenda.js src/components/SyncMeetingDialog.jsx src/pages/AIIntegration.jsx
git commit -m "feat(ai): drop client Pre-Brief reads/writes + copy (deprecation)"
```

---

## Task 3: Client render — delete PreBriefSection, export HTML, versions, tests

**Files:**
- Modify: `src/lib/__tests__/agendaHtml.test.js`, `src/lib/agendaHtml.js`, `src/lib/agendaVersions.js`, `src/pages/AgendaDetail.jsx`

- [ ] **Step 1: Remove the two Pre-Brief tests**

In `src/lib/__tests__/agendaHtml.test.js`, delete the two `it(...)` blocks: "places the Pre-Brief section at the very top, before topics" (~58–68) and "omits the Pre-Brief section when there is no pre-brief content" (~69–71).

- [ ] **Step 2: Remove Pre-Brief from composeAgendaHtml**

In `src/lib/agendaHtml.js`:
- Delete the two lines (~39–40):
  ```js
  const pbHtml = sanitizeHtml(agenda?.preBriefHtml);
  const preBrief = pbHtml ? `<section><h2 ${h2}>Pre-Brief</h2>${pbHtml}</section>` : "";
  ```
- Change the return (~46) `return `<article ${wrap}>${preBrief}${topicBlocks}${openFloor}</article>`;` → `return `<article ${wrap}>${topicBlocks}${openFloor}</article>`;`
- Update the doc comment (~28) "Compose the Overview document: the pre-brief body, then each topic's title + body…" → "Compose the Overview document: each topic's title + body (sorted), then the open-floor body."

- [ ] **Step 3: Run agendaHtml tests — verify green**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: PASS (Pre-Brief tests gone; remaining tests unaffected).

- [ ] **Step 4: Remove Pre-Brief from version snapshot/restore**

In `src/lib/agendaVersions.js`:
- Delete `    preBriefHtml: a.preBriefHtml ?? "",` from the `snapshot` object (~41).
- Delete `    preBriefHtml: snap.preBriefHtml ?? "",` from the restore `batch.update` (~71).
- Update the header comment (~2) "Content = title + preBriefHtml + openFloorHtml + …" → "Content = title + openFloorHtml + …".

- [ ] **Step 5: Delete PreBriefSection + render call + orphaned import in AgendaDetail.jsx**

In `src/pages/AgendaDetail.jsx`:
- Delete the `PreBriefSection` function and its comment block (~478–501).
- Delete the render call `                <PreBriefSection agendaId={agendaId} agenda={agenda} />` (~1822).
- Delete the now-orphaned import `import RichBodyEditor from "../components/editor/RichBodyEditor.jsx";` (~82). (Confirmed: `PreBriefSection` was its only consumer.)
- If the file-header comment (~11) still references `RichBodyEditor` as a Pre-Brief detail, touch it up so it isn't stale (non-functional, keep it tidy).

- [ ] **Step 6: Verify no client Pre-Brief refs remain + build + full suite**

Run: `grep -rin "prebrief\|pre-brief" src/`
Expected: no output.
Run: `npm run build`
Expected: clean.
Run: `npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agendaHtml.js src/lib/agendaVersions.js src/lib/__tests__/agendaHtml.test.js src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): remove Pre-Brief render/export/versions (deprecation; data left dormant)"
```

---

## Task 4: Add scroll anchors to topic / org / open-floor elements

**Files:**
- Modify: `src/pages/AgendaDetail.jsx`

- [ ] **Step 1: Add a shared scroll-offset constant**

Near the top section-style constants (by `sectionTitleSx`, ~108), add:
```js
// Anchor offset so TOC jump targets clear the sticky SharedEditorToolbar.
// Sourced from the toolbar's rendered height (~48px) + a small gap; verify in browser.
const ANCHOR_SCROLL_MT = 56;
```

- [ ] **Step 2: Anchor the Overview topic wrapper**

In the Overview topics map, the `<Box ref={dragProvided.innerRef} {...dragProvided.draggableProps} sx={{…}}>` (~1830) gains an id + scroll margin. Add `id={`topic-${topic.id}`}` and merge `scrollMarginTop: \`${ANCHOR_SCROLL_MT}px\`` into its `sx`.

- [ ] **Step 3: Anchor `OrgSectionHeader`**

In `OrgSectionHeader` (~1485), add to the root `<Box sx={{…}}>`: `id={org?.id ? \`org-${org.id}\` : undefined}` and `scrollMarginTop: \`${ANCHOR_SCROLL_MT}px\`` in its `sx`. (Rendered in both views, but the Overview/Working ternary mounts only one at a time → no duplicate id.)

- [ ] **Step 4: Anchor `OpenFloorSection`**

In `OpenFloorSection` (~505), change the root `<Box sx={{ mt: 2.5 }}>` → `<Box id="open-floor" sx={{ mt: 2.5, scrollMarginTop: \`${ANCHOR_SCROLL_MT}px\` }}>`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean. (No visible change yet — anchors are inert until the TOC links to them.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): add scroll anchors (topic/org/open-floor) for TOC navigation"
```

---

## Task 5: `buildTocEntries` pure function (TDD)

**Files:**
- Create: `src/lib/agendaToc.js`
- Test: `src/lib/__tests__/agendaToc.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/agendaToc.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildTocEntries } from "../agendaToc.js";

describe("buildTocEntries", () => {
  it("returns [] for an empty agenda (TOC hides)", () => {
    expect(buildTocEntries([], { hasOpenFloor: true })).toEqual([]);
    expect(buildTocEntries(undefined, { hasOpenFloor: true })).toEqual([]);
  });

  it("numbers topics sequentially and appends Open Floor (non-master)", () => {
    const topics = [
      { id: "a", name: "Blog" },
      { id: "b", name: "Reporting" },
    ];
    const out = buildTocEntries(topics, { hasOpenFloor: true });
    expect(out).toEqual([
      { type: "topic", label: "Blog", anchorId: "topic-a", number: 1 },
      { type: "topic", label: "Reporting", anchorId: "topic-b", number: 2 },
      { type: "openfloor", label: "Open Floor", anchorId: "open-floor" },
    ]);
  });

  it("omits Open Floor when hasOpenFloor is false", () => {
    const out = buildTocEntries([{ id: "a", name: "X" }], { hasOpenFloor: false });
    expect(out.some((e) => e.type === "openfloor")).toBe(false);
  });

  it("falls back to 'Untitled' for blank/whitespace titles", () => {
    const out = buildTocEntries([{ id: "a", name: "  " }, { id: "b" }], {});
    expect(out[0].label).toBe("Untitled");
    expect(out[1].label).toBe("Untitled");
  });

  it("emits an org header only when org changes (master), numbering global", () => {
    const topics = [
      { id: "a", name: "A", organizationId: "o1" },
      { id: "b", name: "B", organizationId: "o1" },
      { id: "c", name: "C", organizationId: "o2" },
    ];
    const orgById = { o1: { id: "o1", name: "Unio", accentColor: "#111" }, o2: { id: "o2", name: "BMD", accentColor: "#222" } };
    const out = buildTocEntries(topics, { isMaster: true, orgById, hasOpenFloor: true });
    expect(out).toEqual([
      { type: "org", label: "Unio", anchorId: "org-o1", accentColor: "#111" },
      { type: "topic", label: "A", anchorId: "topic-a", number: 1 },
      { type: "topic", label: "B", anchorId: "topic-b", number: 2 },
      { type: "org", label: "BMD", anchorId: "org-o2", accentColor: "#222" },
      { type: "topic", label: "C", anchorId: "topic-c", number: 3 },
      { type: "openfloor", label: "Open Floor", anchorId: "open-floor" },
    ]);
  });

  it("uses a fallback org label when the org is missing from orgById", () => {
    const out = buildTocEntries([{ id: "a", name: "A", organizationId: "ghost" }], { isMaster: true, orgById: {}, hasOpenFloor: false });
    expect(out[0]).toEqual({ type: "org", label: "Unassigned", anchorId: "org-ghost", accentColor: undefined });
  });

  it("does NOT group by org when not master", () => {
    const topics = [{ id: "a", name: "A", organizationId: "o1" }, { id: "b", name: "B", organizationId: "o2" }];
    const out = buildTocEntries(topics, { isMaster: false, orgById: { o1: { id: "o1", name: "Unio" } }, hasOpenFloor: false });
    expect(out.every((e) => e.type === "topic")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/agendaToc.test.js`
Expected: FAIL (`buildTocEntries` not defined / module missing).

- [ ] **Step 3: Implement `buildTocEntries`**

Create `src/lib/agendaToc.js`:
```js
// src/lib/agendaToc.js
// Pure derivation of the Agenda Overview Table-of-Contents entries from the live
// `topics` array. No React, no DOM, no Firestore — so it unit-tests cleanly and
// the AgendaTOC component is a thin render over its output. Reactivity is
// automatic: the component re-derives from the reactive topics array each render.
//
// Entry shapes:
//   { type: "org",       label, anchorId, accentColor }   // master agendas only, on org change
//   { type: "topic",     label, anchorId, number }
//   { type: "openfloor", label, anchorId }

export function buildTocEntries(topics, { isMaster = false, orgById = {}, hasOpenFloor = false } = {}) {
  const list = Array.isArray(topics) ? topics : [];
  if (list.length === 0) return [];

  const entries = [];
  let prevOrg;
  let n = 0;

  for (const topic of list) {
    if (isMaster && topic.organizationId !== prevOrg) {
      const org = orgById[topic.organizationId];
      entries.push({
        type: "org",
        label: org?.name || "Unassigned",
        anchorId: `org-${topic.organizationId}`,
        accentColor: org?.accentColor,
      });
      prevOrg = topic.organizationId;
    }
    n += 1;
    entries.push({
      type: "topic",
      label: (topic.name && topic.name.trim()) || "Untitled",
      anchorId: `topic-${topic.id}`,
      number: n,
    });
  }

  if (hasOpenFloor) {
    entries.push({ type: "openfloor", label: "Open Floor", anchorId: "open-floor" });
  }
  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/agendaToc.test.js`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agendaToc.js src/lib/__tests__/agendaToc.test.js
git commit -m "feat(agenda): buildTocEntries pure derivation (master-aware) + tests"
```

---

## Task 6: `AgendaTOC` component + wire into Overview

**Files:**
- Create: `src/components/AgendaTOC.jsx`
- Modify: `src/pages/AgendaDetail.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/AgendaTOC.jsx`:
```jsx
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { buildTocEntries } from "../lib/agendaToc.js";
import { t } from "../theme/tokens.js";

// A live, clickable Table of Contents for the agenda Overview. Pure projection
// of the reactive `topics` array (+ Open Floor) — reflects create/delete/reorder/
// rename automatically, including remote collaborators (all ride Firestore
// onSnapshot, which re-renders AgendaDetail and this with it). Hidden when there
// are no topics. Clicking an entry smooth-scrolls to its anchor; the anchors
// carry scroll-margin-top so titles clear the sticky toolbar.
export default function AgendaTOC({ topics, isMaster = false, orgById = {} }) {
  const entries = buildTocEntries(topics, { isMaster, orgById, hasOpenFloor: true });
  if (entries.length === 0) return null;

  const goTo = (anchorId) => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Box
      component="nav"
      aria-label="Agenda contents"
      sx={{
        mb: 2.5,
        p: 1.5,
        border: `1px solid ${t.cream3}`,
        borderRadius: "8px",
        background: t.cream,
      }}
    >
      <Typography sx={{ ...sectionTitleSxLocal }}>Contents</Typography>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {entries.map((e) => {
          if (e.type === "org") {
            return (
              <Box
                component="li"
                key={e.anchorId}
                onClick={() => goTo(e.anchorId)}
                onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); goTo(e.anchorId); } }}
                role="link"
                tabIndex={0}
                aria-label={`Jump to ${e.label} section`}
                sx={{
                  mt: 0.75, mb: 0.25, cursor: "pointer",
                  fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
                  color: e.accentColor || t.ink3,
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                {e.label}
              </Box>
            );
          }
          return (
            <Box
              component="li"
              key={e.anchorId}
              onClick={() => goTo(e.anchorId)}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); goTo(e.anchorId); } }}
              role="link"
              tabIndex={0}
              aria-label={`Jump to ${e.label}`}
              sx={{
                py: "2px", cursor: "pointer", fontSize: 13, color: t.ink,
                "&:hover": { color: t.copper, textDecoration: "underline" },
              }}
            >
              {e.type === "topic" ? `${e.number}. ${e.label}` : e.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// Local copy of the agenda section-title style (AgendaDetail's sectionTitleSx is
// module-private). Kept in sync intentionally — small + stable.
const sectionTitleSxLocal = {
  fontFamily: t.serif,
  fontSize: 15,
  fontWeight: 700,
  color: t.ink,
  borderBottom: `1.5px solid ${t.copper}`,
  py: "2px",
  mb: "6px",
};
```

> If `t` lacks `cream1`/`ink3`, substitute the nearest existing token (check `src/theme/tokens.js`); do not invent token names. Adjust during build if a token is missing.

- [ ] **Step 2: Import + render in the Overview view**

In `src/pages/AgendaDetail.jsx`:
- Add import near the other component imports (~87): `import AgendaTOC from "../components/AgendaTOC.jsx";`
- In the Overview card body — where `PreBriefSection` was removed, immediately inside `<Box sx={{ px: 4, pt: 2, pb: 3 }}>` and before the `<DragDropContext>` (~1821) — render:
  ```jsx
  <AgendaTOC topics={topics} isMaster={isMaster} orgById={orgById} />
  ```

- [ ] **Step 3: Build + full suite**

Run: `npm run build`
Expected: clean.
Run: `npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/AgendaTOC.jsx src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): live clickable Table of Contents in Overview (replaces Pre-Brief)"
```

---

## Task 7: Local UI verification (dev server + agent-browser)

**Files:** none (verification only)

Per the UI hard gate, verify before asking Andy. The dev server (`npm run dev` → `localhost:5173`) proxies `/api/*` to the deployed backend and talks to live Firestore — so the TOC, anchors, and live structural reactivity are all exercisable locally. (The server-side AI deprecation is NOT exercised locally — it runs on the deployed backend; that's verified post-deploy in Task 8.)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background). If the app renders blank with CJS-interop errors, force-rebuild: `npm run dev -- --force`.

- [ ] **Step 2: Drive the browser (agent-browser, headed for auth)**

Open a real client agenda (non-master) in Overview. Confirm:
- The "Contents" card renders at the top (Pre-Brief is gone).
- Topics are listed, numbered, in `sortOrder`.
- An "Open Floor" entry appears last.
- Clicking a topic entry smooth-scrolls so the topic **title clears the sticky toolbar** (tune `ANCHOR_SCROLL_MT` if it tucks under — re-commit if changed).
- Add a topic → a TOC row appears. Rename a topic + blur → the TOC label updates. Drag-reorder → the TOC reorders + renumbers. Delete a topic → its row disappears.
- Open a **master** (Touch Base) agenda → org group headers render in the TOC (accent-tinted), topics nested + globally numbered, clicking an org header scrolls to that section.

- [ ] **Step 3: Cross-user live reactivity (two ISOLATED profiles)**

Per `feedback_verify_collab_isolated_profiles`: two separate browser profiles (NOT same-browser tabs). On the same agenda, in profile B add/reorder/rename/delete a topic; confirm profile A's TOC updates live. (Rides Firestore `onSnapshot`, not Yjs — but isolated profiles remain the correct method.)

- [ ] **Step 4: Capture evidence**

Screenshot the TOC (client + master) and note the verified behaviors in the session `context.md`.

---

## Task 8: Deploy gate (STOP)

**Files:** none

- [ ] **Step 1: Summarize for Andy**

Report: all tasks committed locally on `main`; unit tests + build green; local UI verification done with screenshots. List commits.

- [ ] **Step 2: STOP — request deploy approval**

Do NOT `git push origin main:dev`. Wait for Andy's explicit go.

- [ ] **Step 3 (after approval): Deploy + verify on prod**

After push + Vercel deploy: `vercel alias set <new-deploy>.vercel.app vm-management-front-end.vercel.app`. Then on prod (hard refresh):
- Re-confirm the TOC behaviors above on a real agenda.
- **Server AI gate:** run ONE real Sync Meeting AI generation → proposal returns valid (topics + Open Floor, no Pre-Brief), no schema/parse error, apply writes cleanly. **Discard** the gen (do not mutate real data).
- Update `context.md` + `SESSION_INDEX.json`; offer a memory checkpoint.

---

## Notes
- **DRY/YAGNI:** no scroll-spy, no sticky side-rail, no exported-HTML TOC, no Working-view TOC (all deferred per spec §6).
- **Data safety:** `preBriefHtml` on existing agenda docs is left untouched (dormant, reversible). No migration.
- **No new dependencies.**
