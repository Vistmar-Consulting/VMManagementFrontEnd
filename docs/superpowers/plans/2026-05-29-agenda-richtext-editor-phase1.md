# Agenda Rich-Text Editor — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agenda's plain-text per-bullet Talking Points / Topic Notes / Open Floor with a Microsoft Word–style rich-text editor (single-user this phase), storing each body as sanitized **HTML** in Firestore, with a shared `composeAgendaHtml()` utility that later powers archival/export/email/AI.

**Architecture:** A TipTap (ProseMirror) editor edits a topic's body; on a short debounce its HTML is saved to `topics/{id}.bodyHtml` (and `agendas/{id}.openFloorHtml` for Open Floor). Read-only surfaces render the stored HTML through a DOMPurify-sanitized `RichBodyView`. A one-off client migration converts existing per-bullet subcollection docs into the new HTML fields, and the views cut over to read the new fields. **No Yjs/Liveblocks in this phase** — that's Phase 2.

**Tech Stack:** React 18 + Vite, MUI 5, Firestore Web SDK, **TipTap** (`@tiptap/react` + StarterKit + underline + link), **DOMPurify**, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-agenda-richtext-editor-design.md` (Phase 1).

**Project conventions:**
- Work on local `main`; push `git push origin main:dev` only when asked. No local feature branches.
- Do NOT kill the running dev server (5173). Vite HMRs edits.
- Tests run with `npx vitest run <path>` (no `test` script in package.json).
- UI HARD GATE: drive `/agent-browser` (Profile 10, authed) to verify any UI change before marking it done.
- `t` design tokens: `src/theme/tokens.js`.

---

## File Structure

**Create:**
- `src/lib/agendaHtml.js` — pure helpers: `bulletsToHtml(items)`, `sanitizeHtml(html)`, `composeAgendaHtml(agenda, topics, { inlineStyles })`. No React, no Firestore. The tested core.
- `src/lib/__tests__/agendaHtml.test.js` — Vitest for the above.
- `src/components/editor/RichBodyView.jsx` — sanitized read-only HTML render.
- `src/components/editor/EditorToolbar.jsx` — formatting toolbar (bold/italic/underline/bullet/ordered/indent/outdent/link).
- `src/components/editor/RichBodyEditor.jsx` — TipTap editable surface for one body: props `{ valueHtml, onChangeHtml, placeholder }`, debounced change.
- `src/lib/migrateAgendaBodies.js` — one-off client migration (uses `bulletsToHtml`) converting `talkingPoints`+`notes`→`bodyHtml`, `openFloor`→`openFloorHtml`. Admin-run.

**Modify:**
- `package.json` — add deps.
- `src/pages/AgendaDetail.jsx` — in `OverviewTopic`, `AgendaTopicCard`, and `OpenFloorSection`: replace the per-bullet read/render/write with `RichBodyEditor` bound to `bodyHtml`/`openFloorHtml`; stop subscribing to `talkingPoints`/`notes`/`openFloor`.

---

## Task 1: Install dependencies

**Files:** Modify `package.json` (+ lockfile)

- [ ] **Step 1: Install**

Run:
```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-link dompurify
```
Expected: packages added, no peer-dep errors that break the build.

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: build succeeds (pre-existing 500kB chunk warning is fine).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(deps): add TipTap + dompurify for agenda rich-text editor"
```

---

## Task 2: `agendaHtml.js` — pure HTML utilities (TDD)

**Files:**
- Create: `src/lib/agendaHtml.js`
- Test: `src/lib/__tests__/agendaHtml.test.js`

DOMPurify needs a DOM; tests run under Vitest `jsdom` env (already configured in `vite.config.js`), so `dompurify` works directly.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/agendaHtml.test.js
import { describe, it, expect } from "vitest";
import { bulletsToHtml, sanitizeHtml, composeAgendaHtml } from "../agendaHtml.js";

describe("bulletsToHtml", () => {
  it("renders ordered plain-text items as a <ul>", () => {
    const html = bulletsToHtml([{ text: "First" }, { text: "Second" }]);
    expect(html).toBe("<ul><li>First</li><li>Second</li></ul>");
  });
  it("escapes HTML-special characters in item text", () => {
    expect(bulletsToHtml([{ text: "a < b & c" }])).toBe("<ul><li>a &lt; b &amp; c</li></ul>");
  });
  it("returns empty string for no items", () => {
    expect(bulletsToHtml([])).toBe("");
  });
});

describe("sanitizeHtml", () => {
  it("keeps allowed formatting tags", () => {
    const out = sanitizeHtml("<ul><li><strong>x</strong> <u>y</u> <a href=\"https://a.com\">l</a></li></ul>");
    expect(out).toContain("<strong>x</strong>");
    expect(out).toContain("<u>y</u>");
    expect(out).toContain("href=\"https://a.com\"");
  });
  it("strips scripts and event handlers", () => {
    const out = sanitizeHtml('<p onclick="evil()">hi</p><script>steal()</script>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });
});

describe("composeAgendaHtml", () => {
  const agenda = { title: "Weekly", openFloorHtml: "<ul><li>OF item</li></ul>" };
  const topics = [
    { id: "t1", title: "Topic A", bodyHtml: "<ul><li>a1</li></ul>", sortOrder: 1 },
    { id: "t2", title: "Topic B", bodyHtml: "<p>b body</p>", sortOrder: 2 },
  ];
  it("composes topics (title + body, in order) then open floor; excludes boards", () => {
    const html = composeAgendaHtml(agenda, topics);
    const idxA = html.indexOf("Topic A");
    const idxB = html.indexOf("Topic B");
    const idxOF = html.indexOf("Open Floor");
    expect(idxA).toBeGreaterThan(-1);
    expect(idxA).toBeLessThan(idxB);          // sorted
    expect(idxB).toBeLessThan(idxOF);         // open floor last
    expect(html).toContain("a1");
    expect(html).toContain("b body");
    expect(html).toContain("OF item");
    expect(html).not.toMatch(/project board/i); // boards excluded
  });
  it("omits the Open Floor section when there is no open-floor content", () => {
    expect(composeAgendaHtml({ title: "x" }, [])).not.toContain("Open Floor");
  });
  it("inlineStyles variant emits style attributes for email/export", () => {
    const html = composeAgendaHtml(agenda, topics, { inlineStyles: true });
    expect(html).toContain("style=");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: FAIL (module/exports not found).

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/agendaHtml.js
// Pure HTML helpers for agenda rich bodies. No React, no Firestore.
// The single source of HTML composition for read-only render, archival,
// export, email, and (future) AI input — see the Phase-1 spec §7.

import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "br", "ul", "ol", "li", "strong", "em", "u", "a", "span"];
const ALLOWED_ATTR = ["href", "target", "rel", "style"];

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convert legacy per-bullet rows ([{ text }]) into a <ul>. Used by migration.
export function bulletsToHtml(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const lis = items.map((it) => `<li>${escapeText(it?.text)}</li>`).join("");
  return `<ul>${lis}</ul>`;
}

// Sanitize stored/AI-authored HTML before render. Forces external links safe.
export function sanitizeHtml(html) {
  if (!html) return "";
  return DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target"],
  });
}

// Compose the Overview document: each topic's title + body (sorted), then the
// open-floor body. Excludes Mini Project Boards. `inlineStyles` produces an
// email/export-safe variant with inline style attributes.
export function composeAgendaHtml(agenda, topics, { inlineStyles = false } = {}) {
  const sorted = [...(topics || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const h2 = inlineStyles
    ? 'style="font-family:Georgia,serif;font-size:18px;margin:18px 0 6px;"'
    : 'class="agenda-topic-title"';
  const wrap = inlineStyles ? 'style="font-family:Arial,sans-serif;color:#1a1a2e;"' : "";

  // NOTE: topic docs store the title in `name` in this codebase; accept either
  // so real docs (t.name) and test fixtures (t.title) both render.
  const topicBlocks = sorted
    .map((t) => `<section><h2 ${h2}>${escapeText(t.title ?? t.name)}</h2>${sanitizeHtml(t.bodyHtml)}</section>`)
    .join("");

  const ofHtml = sanitizeHtml(agenda?.openFloorHtml);
  const openFloor = ofHtml ? `<section><h2 ${h2}>Open Floor</h2>${ofHtml}</section>` : "";

  return `<article ${wrap}>${topicBlocks}${openFloor}</article>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agendaHtml.js src/lib/__tests__/agendaHtml.test.js
git commit -m "feat(agenda): pure HTML utils (bulletsToHtml, sanitizeHtml, composeAgendaHtml)"
```

---

## Task 3: `RichBodyView` — sanitized read-only render

**Files:** Create `src/components/editor/RichBodyView.jsx`

- [ ] **Step 1: Implement**

```jsx
// src/components/editor/RichBodyView.jsx
// Read-only render of stored agenda body HTML. Always sanitized.
import { Box } from "@mui/material";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import { t } from "../../theme/tokens.js";

export default function RichBodyView({ html, sx }) {
  const clean = sanitizeHtml(html);
  if (!clean) return null;
  return (
    <Box
      sx={{
        fontSize: 13, color: t.ink2, lineHeight: 1.6,
        "& ul, & ol": { pl: 3, m: 0 }, "& li": { mb: 0.3 },
        "& a": { color: t.copper }, "& u": { textDecoration: "underline" },
        ...sx,
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/RichBodyView.jsx
git commit -m "feat(agenda): RichBodyView sanitized read-only renderer"
```

---

## Task 4: `EditorToolbar` + `RichBodyEditor` (TipTap)

**Files:**
- Create: `src/components/editor/EditorToolbar.jsx`
- Create: `src/components/editor/RichBodyEditor.jsx`

Feature set ONLY: bold, italic, underline, bullet list, ordered list, indent/outdent (list sink/lift), `cmd+K` link. StarterKit provides bold/italic/lists/listItem; add Underline + Link extensions. Sub-bullets = nested list items via the indent button (`sinkListItem`).

- [ ] **Step 1: Implement the toolbar**

```jsx
// src/components/editor/EditorToolbar.jsx
import { Box, IconButton, Divider, Tooltip } from "@mui/material";
import {
  FormatBold, FormatItalic, FormatUnderlined,
  FormatListBulleted, FormatListNumbered,
  FormatIndentIncrease, FormatIndentDecrease, Link as LinkIcon,
} from "@mui/icons-material";
import { t } from "../../theme/tokens.js";

const btnSx = (active) => ({
  p: 0.5, borderRadius: 1, color: active ? t.copper : t.ink3,
  background: active ? t.copperFaint : "transparent",
});

export default function EditorToolbar({ editor, onLink }) {
  if (!editor) return null;
  const B = ({ title, onClick, active, children }) => (
    <Tooltip title={title}>
      <IconButton size="small" onMouseDown={(e) => e.preventDefault()} onClick={onClick} sx={btnSx(active)}>
        {children}
      </IconButton>
    </Tooltip>
  );
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, mb: 0.5, flexWrap: "wrap" }}>
      <B title="Bold (⌘B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><FormatBold sx={{ fontSize: 18 }} /></B>
      <B title="Italic (⌘I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><FormatItalic sx={{ fontSize: 18 }} /></B>
      <B title="Underline (⌘U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><FormatUnderlined sx={{ fontSize: 18 }} /></B>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.3 }} />
      <B title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><FormatListBulleted sx={{ fontSize: 18 }} /></B>
      <B title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><FormatListNumbered sx={{ fontSize: 18 }} /></B>
      <B title="Indent (sub-bullet)" onClick={() => editor.chain().focus().sinkListItem("listItem").run()}><FormatIndentIncrease sx={{ fontSize: 18 }} /></B>
      <B title="Outdent" onClick={() => editor.chain().focus().liftListItem("listItem").run()}><FormatIndentDecrease sx={{ fontSize: 18 }} /></B>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.3 }} />
      <B title="Link (⌘K)" active={editor.isActive("link")} onClick={onLink}><LinkIcon sx={{ fontSize: 18 }} /></B>
    </Box>
  );
}
```

- [ ] **Step 2: Implement the editor**

```jsx
// src/components/editor/RichBodyEditor.jsx
// Single-user (Phase 1) TipTap editor for one agenda body. Emits HTML via a
// debounced onChangeHtml. Phase 2 swaps the StarterKit history for a Yjs
// collaboration binding; the props stay the same.
import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { Box } from "@mui/material";
import EditorToolbar from "./EditorToolbar.jsx";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import { t } from "../../theme/tokens.js";

export default function RichBodyEditor({ valueHtml, onChangeHtml, placeholder, debounceMs = 1500 }) {
  const timer = useRef(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
    ],
    content: sanitizeHtml(valueHtml) || "",
    onUpdate: ({ editor: ed }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onChangeHtml?.(ed.getHTML()), debounceMs);
    },
  });

  // Flush pending save on unmount.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); editor?.getHTML && onChangeHtml?.(editor.getHTML()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cmd+K link prompt.
  const handleLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); handleLink(); }
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, handleLink]);

  return (
    <Box>
      <EditorToolbar editor={editor} onLink={handleLink} />
      <Box
        sx={{
          "& .ProseMirror": {
            outline: "none", fontSize: 13, color: t.ink2, lineHeight: 1.6, minHeight: 40,
            "& ul, & ol": { paddingLeft: "24px", margin: 0 }, "& li": { marginBottom: "3px" },
            "& a": { color: t.copper }, "& u": { textDecoration: "underline" },
            "& p.is-editor-empty:first-of-type::before": {
              content: `"${placeholder || ""}"`, color: t.ink3, float: "left", height: 0, pointerEvents: "none",
            },
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/EditorToolbar.jsx src/components/editor/RichBodyEditor.jsx
git commit -m "feat(agenda): TipTap RichBodyEditor + toolbar (single-user, HTML out)"
```

---

## Task 5: Migration utility (TDD the pure part)

**Files:**
- Create: `src/lib/migrateAgendaBodies.js`
- Test: extend `src/lib/__tests__/agendaHtml.test.js` is for agendaHtml; add the body-merge helper to `agendaHtml.js` so it's testable, and keep the Firestore walk in `migrateAgendaBodies.js`.

- [ ] **Step 1: Add a failing test for `mergeBodyHtml`**

Append to `src/lib/__tests__/agendaHtml.test.js`:
```js
import { mergeBodyHtml } from "../agendaHtml.js";

describe("mergeBodyHtml", () => {
  it("merges talking points then notes into one body", () => {
    const out = mergeBodyHtml([{ text: "tp1" }], [{ text: "note1" }]);
    expect(out).toBe("<ul><li>tp1</li></ul><ul><li>note1</li></ul>");
  });
  it("returns just talking points when no notes", () => {
    expect(mergeBodyHtml([{ text: "tp1" }], [])).toBe("<ul><li>tp1</li></ul>");
  });
  it("returns empty string when both empty", () => {
    expect(mergeBodyHtml([], [])).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: FAIL (`mergeBodyHtml` not exported).

- [ ] **Step 3: Add `mergeBodyHtml` to `agendaHtml.js`**

```js
// append to src/lib/agendaHtml.js
export function mergeBodyHtml(talkingPoints, notes) {
  return `${bulletsToHtml(talkingPoints)}${bulletsToHtml(notes)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: PASS.

- [ ] **Step 5: Write the Firestore migration (no test — manual/admin-run)**

```js
// src/lib/migrateAgendaBodies.js
// One-off, admin-run migration: converts legacy per-bullet subcollections
// (talkingPoints + notes per topic, openFloor per agenda) into the new HTML
// fields topic.bodyHtml / agenda.openFloorHtml. Idempotent: skips a topic/
// agenda that already has a non-empty body field. Old subcollections are left
// in place (reversible); a later cleanup pass deletes them.
import { collection, doc, getDocs, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { bulletsToHtml, mergeBodyHtml } from "./agendaHtml.js";

async function rows(path) {
  const snap = await getDocs(query(collection(db, ...path.split("/")), orderBy("sortOrder", "asc")));
  return snap.docs.map((d) => d.data());
}

export async function migrateAgendaBodies({ dryRun = true } = {}) {
  const agendas = await getDocs(collection(db, "agendas"));
  const report = { topics: 0, openFloors: 0, skipped: 0, dryRun };
  for (const a of agendas.docs) {
    const ad = a.data();
    // Open Floor
    if (!ad.openFloorHtml) {
      const of = await rows(`agendas/${a.id}/openFloor`);
      const html = bulletsToHtml(of);
      if (html) {
        report.openFloors++;
        if (!dryRun) await updateDoc(doc(db, "agendas", a.id), { openFloorHtml: html });
      }
    } else report.skipped++;
    // Topics
    const topics = await getDocs(collection(db, "agendas", a.id, "topics"));
    for (const tp of topics.docs) {
      if (tp.data().bodyHtml) { report.skipped++; continue; }
      const points = await rows(`agendas/${a.id}/topics/${tp.id}/talkingPoints`);
      const notes = await rows(`agendas/${a.id}/topics/${tp.id}/notes`);
      const html = mergeBodyHtml(points, notes);
      if (html) {
        report.topics++;
        if (!dryRun) await updateDoc(doc(db, "agendas", a.id, "topics", tp.id), { bodyHtml: html });
      }
    }
  }
  return report;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/agendaHtml.js src/lib/__tests__/agendaHtml.test.js src/lib/migrateAgendaBodies.js
git commit -m "feat(agenda): mergeBodyHtml + one-off body migration utility"
```

---

## Task 6: Integrate the editor into the Overview view

**Files:** Modify `src/pages/AgendaDetail.jsx` (`OverviewTopic` + `OpenFloorSection`)

Context: `OverviewTopic` (~line 472–560) currently subscribes to the topic's `talkingPoints` subcollection and renders editable bullets. `OpenFloorSection` (~line 655–712) subscribes to the `openFloor` subcollection.

- [ ] **Step 1: Replace `OverviewTopic`'s talking-points body**

In `OverviewTopic`: remove the `useCollection(.../talkingPoints)` subscription and the bullet list/add-input. Render the topic title field (unchanged) followed by:
```jsx
<RichBodyEditor
  valueHtml={topic.bodyHtml || ""}
  placeholder="Add talking points…"
  onChangeHtml={(html) =>
    updateDoc(doc(db, "agendas", agendaId, "topics", topic.id), {
      bodyHtml: html, updatedAt: serverTimestamp(), updatedByUid: user?.uid || null,
    })
  }
/>
```
Add `import RichBodyEditor from "../components/editor/RichBodyEditor.jsx";` at the top of the file.

- [ ] **Step 2: Replace `OpenFloorSection`'s body**

In `OpenFloorSection`: remove the `useCollection(.../openFloor)` subscription + per-item rows + add-input. Keep the copper "OPEN FLOOR" header. Render:
```jsx
<RichBodyEditor
  valueHtml={agenda?.openFloorHtml || ""}
  placeholder="Add open-floor items…"
  onChangeHtml={(html) =>
    updateDoc(doc(db, "agendas", agendaId), {
      openFloorHtml: html, updatedAt: serverTimestamp(), updatedByUid: user?.uid || null,
    })
  }
/>
```
`OpenFloorSection` must receive the `agenda` doc (pass it as a prop from the parent if it doesn't already).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Browser-verify (UI HARD GATE)**

Drive `/agent-browser` (Profile 10) to a real agenda on `localhost:5173`, Overview view:
- Type in a topic body; apply bold, underline, a bullet, a sub-bullet (indent), a numbered list, and a `cmd+K` link.
- Reload the page → confirm the formatted content persists (read back from `bodyHtml`).
- Edit Open Floor similarly; reload; confirm persistence.
Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): Overview view uses RichBodyEditor for topic body + open floor"
```

---

## Task 7: Integrate the editor into the Working view

**Files:** Modify `src/pages/AgendaDetail.jsx` (`AgendaTopicCard`)

Context (locate by function name — line numbers drift): `AgendaTopicCard` subscribes to the topic's `talkingPoints` subcollection and renders the copper Talking Points bullets **between the KPI strip and the `MiniProjectBoard`**. Topic **Notes are a SEPARATE component** — `TopicNotesSection` — which has its own `useCollection(.../notes)` and is rendered as a sibling **after** `MiniProjectBoard` (look for `<TopicNotesSection …/>`). Both must go, since their content is now merged into `bodyHtml`.

- [ ] **Step 1: Replace the talking-points block with one body editor AND remove the notes section**

1. Remove the `talkingPoints` subscription + its bullet list/add-input from `AgendaTopicCard`.
2. **Remove the `<TopicNotesSection …/>` render call** (sibling after `MiniProjectBoard`) **and delete the `TopicNotesSection` function definition** (its `useCollection(.../notes)`) — its content is now in `bodyHtml`. Leaving it would double-render notes below the board.
3. Between the KPI strip and the `MiniProjectBoard`, render:
```jsx
<RichBodyEditor
  valueHtml={topic.bodyHtml || ""}
  placeholder="Add talking points…"
  onChangeHtml={(html) =>
    updateDoc(doc(db, "agendas", agendaId, "topics", topic.id), {
      bodyHtml: html, updatedAt: serverTimestamp(), updatedByUid: user?.uid || null,
    })
  }
/>
```
Leave the KPI strip and `MiniProjectBoard` exactly as-is.

- [ ] **Step 2: Verify no remaining readers of the old subcollections**

Run: `grep -n "talkingPoints\|/notes\|openFloor" src/pages/AgendaDetail.jsx`
Expected: only the migration-irrelevant references remain (e.g. CancelAgenda subcollection cleanup elsewhere is fine). No live `useCollection` on `talkingPoints`/`notes`/`openFloor` in the render path.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Browser-verify (UI HARD GATE)**

Working view of a real agenda: edit a topic body, confirm formatting + persistence across reload; confirm the Mini Project Board + KPI strip still render and function; confirm an edit made in Working view shows in Overview view (same `bodyHtml`). Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): Working view topic uses RichBodyEditor; drop per-bullet talking points/notes"
```

---

## Task 8: Run the migration on live data

**Files:** none (operational)

- [ ] **Step 1: Expose a temporary dev hook**

`migrateAgendaBodies` is an ESM export, not on `window` — a raw console call won't resolve it. Add a dev-gated hook so it's callable, e.g. in `src/main.jsx` (or AgendaDetail) behind `import.meta.env.DEV`:
```js
if (import.meta.env.DEV) {
  import("./lib/migrateAgendaBodies.js").then((m) => { window.__migrateAgendaBodies = m.migrateAgendaBodies; });
}
```
Remove this hook after the migration. (Alternatively, an admin-only button.)

- [ ] **Step 2: Dry-run**

Call `await window.__migrateAgendaBodies({ dryRun: true })` in the authed browser; review the report counts. Confirm with Andy before a live write (writes `bodyHtml`/`openFloorHtml` across agendas — shared production data, requires explicit OK).

- [ ] **Step 3: Live migrate (after Andy's OK)**

Call `await window.__migrateAgendaBodies({ dryRun: false })`. Spot-check 2–3 migrated agendas in the UI: legacy bullets now render in the body editor.

- [ ] **Step 4: Remove the dev hook + note residual cleanup**

Delete the `window.__migrateAgendaBodies` dev hook. The old `talkingPoints`/`notes`/`openFloor` subcollections remain (ignored) — record a Deferred item to delete them once the migration is confirmed stable.

---

## Phase 1 Done-Definition

- Topic bodies + Open Floor edit as rich text (bold/italic/underline/bullets/sub-bullets/numbered/`cmd+K` links) in BOTH views, persisting as sanitized HTML in `topics/{id}.bodyHtml` / `agendas/{id}.openFloorHtml`.
- `composeAgendaHtml()` + `sanitizeHtml()` + `bulletsToHtml()` + `mergeBodyHtml()` unit-tested and green.
- Existing per-bullet content migrated into the new fields; views no longer read the old subcollections.
- Build green; both views browser-verified.
- **Not in this phase:** live collaboration (Yjs/Liveblocks), archival snapshots, export, email, AI — Phases 2–4.
