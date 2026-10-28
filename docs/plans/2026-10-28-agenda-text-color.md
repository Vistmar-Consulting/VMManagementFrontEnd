# Agenda Text Color + Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text color and highlight (background) color in the Meeting Agenda rich-text editor, preserved by Sync Meeting / Generate / Refine.

**Architecture:** Add TipTap's `TextStyle` + `Color` + `BackgroundColor` marks to both editor schemas (collab body + Sync review editor). A new `ColorMenu` toolbar component (swatches + hex + native picker) drives them. The AI HTML rules move to one shared constant that allows existing `<span style>` and forbids new ones.

**Tech Stack:** React 18, MUI 5, TipTap 3.23.6, Yjs/Liveblocks, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-28-agenda-text-color-design.md`

**Rules for the executor:**
- Work in this worktree only (`.claude/worktrees/agenda-text-tools`). `node_modules` is a symlink to the main checkout.
- **Never use agent-browser without Andy's permission.** If permitted, close the browser and stop the dev server in the same turn.
- Never run the build and the full test suite in parallel (parallel sessions share the machine).
- Stage with explicit pathspecs. Never `git add -A`.

---

## File map

| File | Change |
|---|---|
| `package.json`, `package-lock.json` | add `@tiptap/extension-text-style@3.23.6` |
| `src/components/editor/editorExtensions.js` | add the three marks to `bodyContentExtensions()` |
| `src/components/editor/RichBodyEditor.jsx` | add the three marks to its own extension list |
| `src/components/editor/pasteColors.js` | **new** — `stripPastedColors()` + `PasteColorStrip` extension |
| `src/components/editor/ColorMenu.jsx` | **new** — toolbar button + popover, `mode: "color" \| "background"` |
| `src/components/editor/EditorToolbar.jsx` | render two `ColorMenu`s after Underline |
| `api/ai/_lib/htmlRules.js` | **new** — shared `BODY_HTML_RULES` string |
| `api/ai/_handlers/{prepare,refine,generate}.js` | use `BODY_HTML_RULES`; export `buildSystem` from refine + generate |
| `api/ai/_handlers/__tests__/__snapshots__/prepare.snapshot.test.js.snap` | regenerated |
| `src/pages/AIIntegration.jsx` | `HOW_IT_WORKS` guardrail row "Colors kept" |
| Tests | `src/lib/__tests__/agendaHtml.test.js`, `src/components/editor/__tests__/{topicBodyYjs.test.js,RichBodyEditor.test.jsx,ColorMenu.test.jsx,pasteColors.test.js}`, `api/ai/_lib/__tests__/htmlRules.test.js` |
| `dev/sessions/v0_4_21_Andrew_AGENDA_TEXT_COLOR/context.md`, `dev/SESSION_INDEX.json` | session state |

---

### Task 0: Session context

**Files:** Create `dev/sessions/v0_4_21_Andrew_AGENDA_TEXT_COLOR/context.md`; Modify `dev/SESSION_INDEX.json`

- [ ] **Step 1:** Create `context.md`:

```markdown
# Session v0.4.21 — Agenda text color + highlight

Spec: docs/superpowers/specs/2026-10-28-agenda-text-color-design.md
Plan: docs/plans/2026-10-28-agenda-text-color.md
Branch: worktree-agenda-text-tools (from main c03529a)

## Live state
- In flight: plan Tasks 1–5 (incl. 1b paste strip).

## Deferred
- (none yet)
```

- [ ] **Step 2:** Append to `sessions` in `dev/SESSION_INDEX.json`:

```json
{
  "session_id": "SES-20261028-Andrew-v0.4.21-agenda-text-color",
  "developer": "Andrew",
  "date": "2026-10-28",
  "commit_start": "c03529a",
  "summary": "Meeting Agenda editor: text color + highlight color; AI keeps existing colors.",
  "folder": "dev/sessions/v0_4_21_Andrew_AGENDA_TEXT_COLOR/",
  "status": "active"
}
```

- [ ] **Step 3:** Commit

```bash
git add dev/sessions/v0_4_21_Andrew_AGENDA_TEXT_COLOR/context.md dev/SESSION_INDEX.json docs/plans/2026-10-28-agenda-text-color.md
git commit -m "docs(session): agenda text color session + plan"
```

---

### Task 1: Dependency + schema (both editors keep color spans)

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/components/editor/editorExtensions.js`, `src/components/editor/RichBodyEditor.jsx:92-123`
- Test: `src/lib/__tests__/agendaHtml.test.js`, `src/components/editor/__tests__/topicBodyYjs.test.js`, `src/components/editor/__tests__/RichBodyEditor.test.jsx`

- [ ] **Step 1: Install**

```bash
npm install @tiptap/extension-text-style@3.23.6 --save-exact=false
```

Expected: `package.json` gains `"@tiptap/extension-text-style": "^3.23.6"`. Note: this writes into the main checkout's `node_modules` via the symlink — tell Andy in the report.

Confirm the symlink survived: `ls -la node_modules` must still show `-> …/VMManagementFrontEnd/node_modules`.

Report to Andy: the main checkout's `package.json` won't list the package until this merges, so an `npm install`/`npm ci` there by another session would remove it and break this worktree's tests.

(3.23.6 `Color`/`BackgroundColor` read the raw style attribute first, so hex values round-trip as written — tests assert exact hex.)

- [ ] **Step 2: Write failing tests**

`src/lib/__tests__/agendaHtml.test.js` — add inside a new describe at the end:

```js
describe("sanitizeHtml — color spans", () => {
  it("keeps text color and highlight styles", () => {
    const html = '<p><span style="color: #c62828; background-color: #fff3a3">hot</span></p>';
    expect(sanitizeHtml(html)).toBe(html);
  });
});
```

`src/components/editor/__tests__/topicBodyYjs.test.js` — add inside `describe("writeTopicBodies")`:

```js
  it("keeps text color and highlight through the Yjs write", () => {
    const ydoc = withBodies(["topicA"]);
    writeTopicBodies(ydoc, { topicA: '<p><span style="color: #c62828; background-color: #fff3a3">hot</span></p>' });
    const out = xml(ydoc, "topicA");
    expect(out).toContain("hot");
    expect(out).toMatch(/textstyle|textStyle/);
    expect(out).toContain('color="#c62828"');
    expect(out).toContain('backgroundColor="#fff3a3"');
  });
```

Also cover the collab editor's HTML output: in the existing test "renders in a bound editor exactly as the editor's own setContent would" (~line 55), add `<p><span style="color: #c62828; background-color: #fff3a3">hot</span></p>` to its `html` input.

`src/components/editor/__tests__/RichBodyEditor.test.jsx` — add inside the describe:

```js
  it("keeps text color and highlight from valueHtml", async () => {
    const { container } = await mount({ valueHtml: '<p><span style="color: #c62828; background-color: #fff3a3">hot</span></p>' });
    const span = prose(container).querySelector("span[style]");
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("hot");
    expect(span.getAttribute("style")).toContain("color: #c62828");
    expect(span.getAttribute("style")).toContain("background-color: #fff3a3");
  });
```

- [ ] **Step 3: Run — expect FAIL** on the Yjs, bound-editor and RichBodyEditor tests (the sanitizer test should already pass; that's the guard it's meant to be).

```bash
npx vitest run src/lib/__tests__/agendaHtml.test.js src/components/editor/__tests__/topicBodyYjs.test.js src/components/editor/__tests__/RichBodyEditor.test.jsx
```

- [ ] **Step 4: Implement**

`src/components/editor/editorExtensions.js` — add import and entries:

```js
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";
```

and after the `TableKit.configure(...)` entry:

```js
    // Text color + highlight: <span style="color / background-color">.
    TextStyle,
    Color,
    BackgroundColor,
```

`src/components/editor/RichBodyEditor.jsx` — add the same import line under the `TableKit` import, and the same three entries (same comment) after `TableKit.configure({ table: { resizable: false } }),`.

- [ ] **Step 5: Run — expect PASS** (same command as Step 3).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/editor/editorExtensions.js src/components/editor/RichBodyEditor.jsx src/lib/__tests__/agendaHtml.test.js src/components/editor/__tests__/topicBodyYjs.test.js src/components/editor/__tests__/RichBodyEditor.test.jsx
git commit -m "feat(editor): text color + highlight marks in agenda body schemas"
```

---

### Task 1b: Strip colors from external pastes

Approved by Andy 2026-10-28: pasted Google Docs / Gmail text must not bring its inline colors.

**Files:**
- Create: `src/components/editor/pasteColors.js`, `src/components/editor/__tests__/pasteColors.test.js`
- Modify: `src/components/editor/editorExtensions.js`, `src/components/editor/RichBodyEditor.jsx`

- [ ] **Step 1: Write the failing test** — `src/components/editor/__tests__/pasteColors.test.js`:

```js
import { describe, it, expect } from "vitest";
import { stripPastedColors } from "../pasteColors.js";

describe("stripPastedColors", () => {
  it("removes color and background from external HTML, keeps other styles", () => {
    const out = stripPastedColors('<p><span style="color: rgb(0, 0, 0); background-color: transparent; font-weight: 700">x</span></p>');
    expect(out).not.toMatch(/color|background/);
    expect(out).toMatch(/font-weight: 700/);
  });

  it("drops a style attribute left empty", () => {
    expect(stripPastedColors('<p><span style="color: #000">x</span></p>')).toBe("<p><span>x</span></p>");
  });

  it("removes the background shorthand too", () => {
    expect(stripPastedColors('<p><span style="background: yellow">x</span></p>')).toBe("<p><span>x</span></p>");
  });

  it("keeps colors on a paste from another agenda editor (ProseMirror slice)", () => {
    const html = '<p data-pm-slice="1 1 []"><span style="color: #c62828">x</span></p>';
    expect(stripPastedColors(html)).toBe(html);
  });

  it("passes empty input through", () => {
    expect(stripPastedColors("")).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

```bash
npx vitest run src/components/editor/__tests__/pasteColors.test.js
```

- [ ] **Step 3: Implement** `src/components/editor/pasteColors.js`:

```js
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const COLOR_PROPS = ["color", "background-color", "background"];

// Text pasted from outside the editor (Google Docs, Gmail, web pages) arrives
// with inline colors on nearly every span — usually an explicit black. Strip
// them so only colors set from the toolbar stick. A paste from another agenda
// editor carries ProseMirror's data-pm-slice marker and keeps its colors.
export function stripPastedColors(html) {
  if (!html || html.includes("data-pm-slice")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("[style]").forEach((el) => {
    COLOR_PROPS.forEach((prop) => el.style.removeProperty(prop));
    if (!el.getAttribute("style").trim()) el.removeAttribute("style");
  });
  return doc.body.innerHTML;
}

export const PasteColorStrip = Extension.create({
  name: "pasteColorStrip",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: stripPastedColors } })];
  },
});
```

Register it next to the color marks:
- `editorExtensions.js`: `import { PasteColorStrip } from "./pasteColors.js";` and add `PasteColorStrip,` after `BackgroundColor,`.
- `RichBodyEditor.jsx`: same import and entry.

(`PasteColorStrip` adds no nodes or marks, so `getSchema(bodyContentExtensions())` in `topicBodyYjs.js` is unchanged.)

- [ ] **Step 4: Run — expect PASS**, plus the editor folder:

```bash
npx vitest run src/components/editor/__tests__/
```

- [ ] **Step 5: Commit** (explicit pathspecs)

```bash
git add src/components/editor/pasteColors.js src/components/editor/__tests__/pasteColors.test.js src/components/editor/editorExtensions.js src/components/editor/RichBodyEditor.jsx
git commit -m "feat(editor): strip inline colors from external pastes"
```

---

### Task 2: ColorMenu + toolbar buttons

**Files:**
- Create: `src/components/editor/ColorMenu.jsx`
- Modify: `src/components/editor/EditorToolbar.jsx` (imports; doc comment line "Exposes: …"; render after Underline)
- Test: `src/components/editor/__tests__/ColorMenu.test.jsx`

- [ ] **Step 1: Write the failing test** — `src/components/editor/__tests__/ColorMenu.test.jsx`:

```jsx
// Toolbar Text color / Highlight buttons: swatches, hex entry, native picker, Clear.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";
import EditorToolbar from "../EditorToolbar.jsx";
import { t } from "../../../theme/tokens.js";

let editor;
afterEach(() => editor?.destroy());

const makeEditor = () => {
  editor = new Editor({ extensions: [StarterKit, TextStyle, Color, BackgroundColor], content: "<p>hello</p>" });
  editor.commands.selectAll();
  return editor;
};
const attrs = () => editor.getAttributes("textStyle");
const mount = () => render(<EditorToolbar editor={makeEditor()} onLink={() => {}} />);

describe("ColorMenu", () => {
  it("both buttons are disabled when no editor is focused", () => {
    render(<EditorToolbar editor={null} onLink={() => {}} />);
    expect(screen.getByTitle("Text color")).toBeDisabled();
    expect(screen.getByTitle("Highlight")).toBeDisabled();
  });

  it("a text swatch colors the selection", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    fireEvent.click(screen.getByLabelText(`Text color ${t.red}`));
    expect(attrs().color).toBe(t.red);
  });

  it("a highlight swatch sets the background color", () => {
    mount();
    fireEvent.click(screen.getByTitle("Highlight"));
    fireEvent.click(screen.getByLabelText("Highlight #fff3a3"));
    expect(attrs().backgroundColor).toBe("#fff3a3");
  });

  it("a valid hex applies on Enter; an invalid one is ignored", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    const hex = screen.getByLabelText("Hex color");
    fireEvent.change(hex, { target: { value: "#12" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(attrs().color).toBeFalsy();
    fireEvent.change(hex, { target: { value: "#123456" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(attrs().color).toBe("#123456");
  });

  it("dragging the native picker only updates the hex field; commit applies", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    const picker = screen.getByLabelText("Pick color");
    fireEvent.input(picker, { target: { value: "#abcdef" } });
    expect(screen.getByLabelText("Hex color")).toHaveValue("#abcdef");
    expect(attrs().color).toBeFalsy();
    fireEvent.change(picker, { target: { value: "#abcdef" } });
    expect(attrs().color).toBe("#abcdef");
  });

  it("Clear removes the color", () => {
    mount();
    editor.chain().setColor(t.red).setBackgroundColor("#fff3a3").run();
    fireEvent.click(screen.getByTitle("Text color"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(attrs().color).toBeFalsy();
    expect(attrs().backgroundColor).toBe("#fff3a3");
  });
});
```

Note on the picker test: React's `onChange` on `<input type="color">` fires on the `input` event, so drag updates go through `onChange`; the commit is a native `change` listener attached via ref. If `fireEvent.input` in jsdom does not trigger React's `onChange` for a color input, use `onInput` for the draft instead — keep the behavior (drag = draft only, `change` = apply).

- [ ] **Step 2: Run — expect FAIL** (no "Text color" button).

```bash
npx vitest run src/components/editor/__tests__/ColorMenu.test.jsx
```

- [ ] **Step 3: Implement** `src/components/editor/ColorMenu.jsx`:

```jsx
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Popover from "@mui/material/Popover";
import FormatColorText from "@mui/icons-material/FormatColorText";
import FormatColorFill from "@mui/icons-material/FormatColorFill";
import { t } from "../../theme/tokens.js";

const HEX = /^#[0-9a-f]{6}$/i;

const MODES = {
  color: {
    title: "Text color",
    Icon: FormatColorText,
    attr: "color",
    swatches: [t.ink, t.red, t.amber, t.green, t.blue, t.purple, t.copper, "#757575"],
    set: (chain, hex) => chain.setColor(hex),
    unset: (chain) => chain.unsetColor(),
  },
  background: {
    title: "Highlight",
    Icon: FormatColorFill,
    attr: "backgroundColor",
    swatches: ["#fff3a3", "#fde2e1", "#fdebd3", "#dcefdc", "#dde7f8", t.purpleLight, "#f3e3d3", "#eeeeee"],
    set: (chain, hex) => chain.setBackgroundColor(hex),
    unset: (chain) => chain.unsetBackgroundColor(),
  },
};

/**
 * Toolbar Text color / Highlight button. Opens swatches, a hex field and the
 * native color picker; the bar under the icon shows the color at the cursor.
 * Dragging the native picker only updates the hex field — the color is applied
 * on the picker's commit (native change) or Enter, so each pick is one undo step.
 *
 * Props:
 *   editor — TipTap Editor instance, or null (renders disabled)
 *   mode   — "color" | "background"
 *   sx     — the toolbar's shared IconButton sx (colours, hover, disabled)
 */
export default function ColorMenu({ editor, mode, sx }) {
  const m = MODES[mode];
  const [anchorEl, setAnchorEl] = useState(null);
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(null);
  // As in TableMenu: close rather than act on a different or destroyed body.
  const [target, setTarget] = useState(null);
  const isOpen = Boolean(anchorEl) && !!editor && editor === target && !editor.isDestroyed;
  const current = editor && !editor.isDestroyed ? editor.getAttributes("textStyle")[m.attr] : null;

  const close = () => {
    setAnchorEl(null);
    setTarget(null);
  };

  useEffect(() => {
    if (anchorEl && !isOpen) close();
  }, [anchorEl, isOpen]);

  const open = (e) => {
    setDraft(HEX.test(current || "") ? current : "");
    setTarget(editor);
    setAnchorEl(e.currentTarget);
  };

  const apply = (hex) => {
    if (!HEX.test(hex)) return;
    m.set(editor.chain().focus(), hex).run();
    close();
  };

  // Native commit event (fires when the picker closes), not React's onChange,
  // which fires on every drag step.
  useEffect(() => {
    if (!picker) return undefined;
    const onCommit = (e) => apply(e.target.value);
    picker.addEventListener("change", onCommit);
    return () => picker.removeEventListener("change", onCommit);
  });

  return (
    <>
      <IconButton
        size="small"
        title={m.title}
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
        sx={{ ...sx, flexDirection: "column", gap: 0 }}
      >
        <m.Icon fontSize="small" />
        <Box sx={{ width: 14, height: 3, mt: "-2px", borderRadius: "1px", backgroundColor: current || "transparent" }} />
      </IconButton>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1, width: 168 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 32px)", gap: "8px" }}>
            {m.swatches.map((hex) => (
              <Box
                key={hex}
                component="button"
                type="button"
                aria-label={`${m.title} ${hex}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(hex)}
                sx={{
                  width: 32,
                  height: 24,
                  p: 0,
                  cursor: "pointer",
                  borderRadius: "4px",
                  backgroundColor: hex,
                  border: `1px solid ${current === hex ? t.copper : t.cream3}`,
                }}
              />
            ))}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <input
              ref={setPicker}
              type="color"
              aria-label="Pick color"
              value={HEX.test(draft) ? draft : "#000000"}
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 28, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
            <InputBase
              value={draft}
              placeholder="#rrggbb"
              onChange={(e) => setDraft(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply(draft);
                }
              }}
              inputProps={{ "aria-label": "Hex color", maxLength: 7 }}
              sx={{ flex: 1, fontSize: 13, px: 1, border: `1px solid ${t.cream3}`, borderRadius: "4px" }}
            />
          </Box>
          <Button
            size="small"
            fullWidth
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              m.unset(editor.chain().focus()).run();
              close();
            }}
            sx={{ mt: 1, fontSize: 12, color: t.ink3, textTransform: "none" }}
          >
            Clear
          </Button>
        </Box>
      </Popover>
    </>
  );
}
```

`src/components/editor/EditorToolbar.jsx`:
- add `import ColorMenu from "./ColorMenu.jsx";` under the `TableMenu` import;
- doc comment: `Exposes: bold, italic, underline, text color, highlight, bullet list, …`;
- right after the Underline `btn(...)` call:

```jsx
      <ColorMenu editor={editor} mode="color" sx={btnSx("__never__")} />
      <ColorMenu editor={editor} mode="background" sx={btnSx("__never__")} />
```

- [ ] **Step 4: Run — expect PASS**, plus the other editor tests:

```bash
npx vitest run src/components/editor/__tests__/
```

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/ColorMenu.jsx src/components/editor/EditorToolbar.jsx src/components/editor/__tests__/ColorMenu.test.jsx
git commit -m "feat(editor): Text color + Highlight toolbar buttons"
```

---

### Task 3: AI keeps existing colors

**Files:**
- Create: `api/ai/_lib/htmlRules.js`, `api/ai/_lib/__tests__/htmlRules.test.js`
- Modify: `api/ai/_handlers/prepare.js:205`, `api/ai/_handlers/refine.js:62,88`, `api/ai/_handlers/generate.js:94,127`, snapshot, `src/pages/AIIntegration.jsx` (Guardrails group, after "Tables kept")

- [ ] **Step 1: Write the failing test** — `api/ai/_lib/__tests__/htmlRules.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { BODY_HTML_RULES } from "../htmlRules.js";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const prepare = await import("../../_handlers/prepare.js");
const refine = await import("../../_handlers/refine.js");
const generate = await import("../../_handlers/generate.js");

const cats = [{ slug: "website", name: "Website", description: "", sop: "" }];

describe("BODY_HTML_RULES", () => {
  it("keeps existing color spans and forbids new ones", () => {
    expect(BODY_HTML_RULES).toContain("<span style>");
    expect(BODY_HTML_RULES).toMatch(/never add a new style or <span>/i);
    expect(BODY_HTML_RULES).not.toMatch(/no inline styles/i);
  });

  it("is used by all three system prompts", () => {
    expect(prepare.buildSystem("P", "working", cats, [], false, false, [])).toContain(BODY_HTML_RULES);
    expect(refine.buildSystem(cats, [], false, [])).toContain(BODY_HTML_RULES);
    expect(generate.buildSystem("P", "working", cats, [], false, false, [])).toContain(BODY_HTML_RULES);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

```bash
npx vitest run api/ai/_lib/__tests__/htmlRules.test.js
```

- [ ] **Step 3: Implement**

`api/ai/_lib/htmlRules.js`:

```js
// api/ai/_lib/htmlRules.js
//
// Topic-body HTML rules shared by Sync Meeting (prepare.js), Refine and
// Generate, so the three never drift on what markup the model may emit.
// <span style> carries the editor's text color / highlight; the model keeps
// spans it finds and never makes new ones.
export const BODY_HTML_RULES = `HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>, plus <span style> where one already exists. No headings, no other tags. Never add a new style or <span>. PRESERVE COLORS: keep every existing <span style="…"> (text color or highlight) verbatim around the same words on any text you keep; it goes only when the words it wraps are removed. Exception: if a body already contains a <table>, keep it as a table (<table>, <tbody>, <tr>, <th>, <td>, each cell's text in a <p>) with the same columns and header row; update cell text in place, add a row only for a new item and remove a row only for a dropped item; never create a new table.`;
```

In each handler, `import { BODY_HTML_RULES } from "../_lib/htmlRules.js";` and replace the line's text from `HTML rules:` through `never create a new table.` with `${BODY_HTML_RULES}`, leaving the trailing text as it is:
- `prepare.js:205` → `${BODY_HTML_RULES} Be concise — never a long document.` (rest of line unchanged)
- `generate.js:127` → `${BODY_HTML_RULES} Be concise — never a long document.` (rest unchanged)
- `refine.js:88` → `${BODY_HTML_RULES} Be concise.${bulletFormatBlock}`

Export the builders for the test: `refine.js:62` and `generate.js:94` `function buildSystem(` → `export function buildSystem(`.

- [ ] **Step 4: Run — expect htmlRules PASS, prepare snapshot FAIL** (the intended wording change):

```bash
npx vitest run api/ai/
```

Check the snapshot diff shows **only** the HTML-rules sentence changing (three occurrences). Then update:

```bash
npx vitest run api/ai/_handlers/__tests__/prepare.snapshot.test.js -u
npx vitest run api/ai/
```

Expected: all PASS.

- [ ] **Step 5: AI Integration page** — `src/pages/AIIntegration.jsx`, Guardrails group, after the `"Tables kept"` row:

```jsx
      ["Colors kept", "Text color and highlight already in a topic body or Open Floor stay on the words they mark. The AI never adds a color of its own."],
```

- [ ] **Step 6: Commit**

```bash
git add api/ai/_lib/htmlRules.js api/ai/_lib/__tests__/htmlRules.test.js api/ai/_handlers/prepare.js api/ai/_handlers/refine.js api/ai/_handlers/generate.js api/ai/_handlers/__tests__/__snapshots__/prepare.snapshot.test.js.snap src/pages/AIIntegration.jsx
git commit -m "feat(ai): agenda AI keeps existing text color + highlight"
```

---

### Task 4: Full verification

- [ ] **Step 1:** Full suite (alone):

```bash
npx vitest run --testTimeout=15000 --maxWorkers=3
```

Expected: all pass. Report the count. Any failure → superpowers:systematic-debugging, not retries.

- [ ] **Step 2:** Then build (after the suite finishes):

```bash
npm run build
```

Expected: success. Report bundle-size warnings if new.

- [ ] **Step 3:** `git status --short` — nothing untracked except intended files; no scratch files in the repo.

- [ ] **Step 4:** Ask Andy: "OK to use agent-browser to check the toolbar locally?" Only on yes: `npm run dev` (port 5173), open an agenda Overview, color + highlight a word in a topic body, reload, confirm it persists; screenshot to the scratchpad; then **close the browser and stop the dev server**. Note: local builds have no live editor (liveblocks-auth 426s), so the collab body may not load locally — if so, say so and offer to verify on the deployed site after push instead.

### Task 5: Close out

- [ ] **Step 1:** Update `context.md` live state with commits, test counts, build result, and what was / was not browser-verified.
- [ ] **Step 2:** Commit `context.md`. Pre-push: superpowers:requesting-code-review. Push to `origin/dev` only when Andy says so (`git pull --rebase origin dev && git push origin HEAD:dev`).
