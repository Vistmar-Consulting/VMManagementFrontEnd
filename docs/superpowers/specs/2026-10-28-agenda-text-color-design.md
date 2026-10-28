# Agenda Text Color + Highlight — Design

Date: 2026-10-28 · Owner: Andy · Status: approved

## Goal

Add **text color** and **text background (highlight) color** to the Meeting Agenda rich-text
editor. Strikethrough was considered and dropped (not needed).

## 1. Schema

- Add dependency `@tiptap/extension-text-style@3.23.6` (same version as the other TipTap packages).
- Register `TextStyle`, `Color`, `BackgroundColor` (named exports of that package) in:
  - `src/components/editor/editorExtensions.js` → `bodyContentExtensions()`. This feeds
    `CollabBodyEditor` and `topicBodyYjs` (Sync Meeting's direct Yjs writes), so both parse
    color spans identically.
  - `src/components/editor/RichBodyEditor.jsx` — used by the Sync Meeting review
    (`ProposalReview`). Without the marks there, editing a colored proposal would strip its colors.
- Stored form: `<span style="color: …; background-color: …">`. `sanitizeHtml`
  (`src/lib/agendaHtml.js`) already allows `span` + `style`; no sanitizer change.

## 1b. Paste

Text pasted from outside the editor (Google Docs, Gmail, web pages) has its inline `color` /
`background-color` / `background` stripped, so only colors set from the toolbar stick. A paste
from another agenda editor (ProseMirror clipboard HTML carries `data-pm-slice`) keeps its colors.
Implemented as a TipTap extension (`transformPastedHTML`) registered next to the color marks in
both editors. Approved by Andy 2026-10-28.

## 2. Toolbar

- `src/components/editor/EditorToolbar.jsx`: two buttons after Underline —
  **Text color** (`FormatColorText`) and **Highlight** (`FormatColorFill`) MUI icons, each with a
  small bar beneath showing the color at the cursor (`editor.getAttributes("textStyle")`).
- New `src/components/editor/ColorMenu.jsx`, patterned on `TableMenu.jsx`; one component, used
  twice via a `mode` prop (`"color"` | `"background"`). Opens an MUI Popover with:
  - **8 swatches.** Text: `t.ink`, `t.red`, `t.amber`, `t.green`, `t.blue`, `t.purple`,
    `t.copper`, grey `#757575`. Highlight: yellow `#fff3a3`, red `#fde2e1`, amber `#fdebd3`,
    green `#dcefdc`, blue `#dde7f8`, purple `t.purpleLight` (`#ede7f6`), copper `#f3e3d3`,
    grey `#eeeeee`.
  - **Hex input + native `<input type="color">`** for any color. Dragging the native picker only
    updates the hex field; the color is applied on the picker's native `change` (commit) event or
    Enter in the hex field — one undo step per applied color. Invalid hex is not applied.
  - **Clear** → `unsetColor()` / `unsetBackgroundColor()`.
  - Commands: `setColor(hex)` / `setBackgroundColor(hex)` via `editor.chain().focus()`.
- Buttons render disabled when `editor` is null (shared-toolbar mode), like the others.
- Applies to both the shared Overview toolbar and inline toolbars (same component).

## 3. AI (Sync Meeting / Generate / Refine)

- The "HTML rules" line in `api/ai/_handlers/prepare.js:205`, `refine.js:88`, `generate.js:127`
  currently says "use ONLY these tags — <p>, …, <a href>. No headings, no inline styles, no other
  tags." Change it in all three: add `<span style>` to the tag list **for existing spans only**, and
  say the model **keeps existing color/highlight spans on text it keeps, and never adds new styles
  or spans.**
- Update `api/ai/_handlers/__tests__/__snapshots__/prepare.snapshot.test.js.snap`.
- Add a `HOW_IT_WORKS` row in `src/pages/AIIntegration.jsx` (CLAUDE.md rule 4).

## 4. Testing

- `ColorMenu` unit tests: swatch applies color; valid hex applies; invalid hex ignored; Clear unsets;
  disabled when no editor.
- Paste: external HTML loses colors; `data-pm-slice` HTML keeps them; other styles untouched.
- `sanitizeHtml` keeps `<span style="color:…;background-color:…">`.
- Schema round-trip: HTML with color spans → editor built from `bodyContentExtensions()` →
  `getHTML()` keeps them.
- Yjs write path: color span survives `topicBodyYjs` (`getSchema` → `prosemirrorToYXmlFragment`),
  in `src/components/editor/__tests__/topicBodyYjs.test.js`.
- `RichBodyEditor` keeps color spans from `valueHtml` (its extension list is separate).
- Refine and generate prompts have no snapshot — add an assertion that their HTML-rules line
  contains the span-preservation wording.
- Run the full suite, then the build, one after the other (not in parallel).
- UI check in a browser **only with Andy's permission**; close the browser and dev server afterwards.

## Out of scope

- Strikethrough.
- Redline color: `agendaDiff` rebuilds changed blocks from text, so a color-only edit shows no
  redline and colored text inside an edited block shows uncolored in the review. Display only;
  the applied body keeps its spans.
- Meeting-prep email: `htmlToLines` flattens bodies to plain-text bullets, so colors are dropped
  there by design. The export (`composeAgendaHtml`) keeps spans.
