# Presentation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only "Meeting in Progress" toggle to Agenda Detail that hides other users' carets, name labels, and selection tint while the presenter screen-shares, with zero effect on collaborative editing.

**Architecture:** The Liveblocks `CollaborationCaret` extension paints three decorations into every collaborative editor. Presentation Mode puts one class on the Agenda Detail page root and, scoped under that class, suppresses all three with CSS. The flag lives in `localStorage` keyed by agenda id. Nothing is broadcast, no Yjs or Firestore code is touched.

**Tech Stack:** React 18, MUI 5 + Emotion `sx`, `@uidotdev/usehooks` `useLocalStorage`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-presentation-mode-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/editor/caretVisibility.js` | **New.** The class name, the three scoped CSS rules, and the pure flag→class function. Lives next to `CollabBodyEditor.jsx`, which owns the caret class names it mirrors. |
| `src/components/editor/__tests__/caretVisibility.test.js` | **New.** Tests the pure function. |
| `src/components/PresentationModeToggle.jsx` | **New.** Presentational icon button. No state, no knowledge of agendas or Liveblocks. |
| `src/components/__tests__/PresentationModeToggle.test.jsx` | **New.** Tests the button's accessible state and click behavior. |
| `src/pages/AgendaDetail.jsx` | **Modify.** Owns the flag, renders the toggle, applies the class to the page root. |

Three tasks build these in dependency order, then a fourth verifies in a real browser. Each task ends in a commit.

---

### Task 1: Caret visibility module

**Files:**
- Create: `src/components/editor/caretVisibility.js`
- Test: `src/components/editor/__tests__/caretVisibility.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/components/editor/__tests__/caretVisibility.test.js`:

```js
// Presentation Mode's flag→class binding. This is the only logic in the
// feature; the CSS rules themselves are verified in the browser, since no
// jsdom test can prove a rule suppresses a live Liveblocks caret.

import { describe, it, expect } from "vitest";
import { PRESENTATION_MODE_CLASS, presentationClassName } from "../caretVisibility.js";

describe("presentationClassName", () => {
  it("returns the presentation mode class when active", () => {
    expect(presentationClassName(true)).toBe(PRESENTATION_MODE_CLASS);
  });

  it("returns undefined when inactive, so no class attribute is emitted", () => {
    expect(presentationClassName(false)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/editor/__tests__/caretVisibility.test.js`

Expected: FAIL — cannot resolve `../caretVisibility.js`.

- [ ] **Step 3: Write the implementation**

Create `src/components/editor/caretVisibility.js`:

```js
// Presentation Mode ("Meeting in Progress") — viewer-side suppression of the
// remote-user decorations that CollaborationCaret paints into every
// collaborative editor. Spec:
// docs/superpowers/specs/2026-09-09-presentation-mode-design.md
//
// Three decorations, two treatments:
//
//   .collaboration-carets__caret / .collaboration-carets__label are WIDGET
//     decorations — standalone spans holding no document text. Removing them
//     from the layout is safe.
//
//   .ProseMirror-yjs-selection is an INLINE decoration that WRAPS REAL
//     DOCUMENT TEXT, and its tint arrives as an inline style attribute written
//     by the extension's selection builder. display:none here would hide the
//     agenda's own content, so we null the background instead — and it needs
//     !important to beat the inline style.
//
// All three are ProseMirror decorations, not document content, so suppressing
// them cannot affect Yjs state, the Firestore mirror, or what other users see.
//
// SPECIFICITY: the hide below is a TIE with CollabBodyEditor's caret styles,
// not a win — both compute to (0,3,0). It works only because proseBase never
// declares `display` on either caret class, so there is nothing to compete
// with. If a `display` rule is ever added to those classes in
// CollabBodyEditor.jsx, this silently stops working in a source-order-dependent
// way, and the fix is !important here.

export const PRESENTATION_MODE_CLASS = "vm-presentation-mode";

// Spread into the page root's sx UNCONDITIONALLY — only the className toggles.
// The class sits on the same element carrying the sx, so these must be compound
// selectors (&.class), not descendant ones (& .class), or they match nothing.
export const presentationModeSx = {
  [`&.${PRESENTATION_MODE_CLASS} .collaboration-carets__caret`]: {
    display: "none",
  },
  [`&.${PRESENTATION_MODE_CLASS} .collaboration-carets__label`]: {
    display: "none",
  },
  [`&.${PRESENTATION_MODE_CLASS} .ProseMirror-yjs-selection`]: {
    backgroundColor: "transparent !important",
  },
};

export const presentationClassName = (active) =>
  active ? PRESENTATION_MODE_CLASS : undefined;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/editor/__tests__/caretVisibility.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/caretVisibility.js src/components/editor/__tests__/caretVisibility.test.js
git commit -m "feat(agenda): caret visibility module for presentation mode"
```

---

### Task 2: Presentation mode toggle button

**Files:**
- Create: `src/components/PresentationModeToggle.jsx`
- Test: `src/components/__tests__/PresentationModeToggle.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/PresentationModeToggle.test.jsx`:

```jsx
// The "Meeting in Progress" header toggle. Pins the two things that matter:
// the button reports its state to assistive tech via aria-pressed, and a click
// reaches the parent exactly once.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationModeToggle from "../PresentationModeToggle.jsx";

const getButton = () => screen.getByRole("button", { name: /meeting in progress/i });

describe("PresentationModeToggle", () => {
  it("reports the off state via aria-pressed", () => {
    render(<PresentationModeToggle active={false} onToggle={() => {}} />);
    expect(getButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the on state via aria-pressed", () => {
    render(<PresentationModeToggle active onToggle={() => {}} />);
    expect(getButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onToggle once per click", () => {
    const onToggle = vi.fn();
    render(<PresentationModeToggle active={false} onToggle={onToggle} />);
    fireEvent.click(getButton());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/__tests__/PresentationModeToggle.test.jsx`

Expected: FAIL — cannot resolve `../PresentationModeToggle.jsx`.

It should not fail on `toHaveAttribute` being undefined: `@testing-library/jest-dom` is already wired through `src/setupTests.js`, referenced from `vite.config.js` under `test.setupFiles`. If it somehow does, look there rather than adding new setup of your own.

- [ ] **Step 3: Write the implementation**

Create `src/components/PresentationModeToggle.jsx`:

```jsx
// "Meeting in Progress" — hides other users' carets, name labels, and
// selection tint on THIS screen only, for screen-sharing during a live
// meeting. Purely presentational: the flag and its persistence live in
// AgendaDetail. Spec:
// docs/superpowers/specs/2026-09-09-presentation-mode-design.md

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PresentToAllIcon from "@mui/icons-material/PresentToAll";
import { t } from "../theme/tokens.js";

export default function PresentationModeToggle({ active, onToggle }) {
  return (
    <Tooltip
      title={
        active
          ? "Meeting in Progress — collaborator cursors hidden on your screen"
          : "Meeting in Progress — hide collaborator cursors on your screen"
      }
    >
      <IconButton
        onClick={onToggle}
        size="small"
        aria-pressed={active}
        aria-label={`Meeting in Progress: ${active ? "on" : "off"}`}
        sx={{ color: active ? t.copper : t.ink3 }}
      >
        <PresentToAllIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
```

Active state is a color change only, so the header does not shift when it flips.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/__tests__/PresentationModeToggle.test.jsx`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/PresentationModeToggle.jsx src/components/__tests__/PresentationModeToggle.test.jsx
git commit -m "feat(agenda): Meeting in Progress toggle button"
```

---

### Task 3: Wire into Agenda Detail

**Files:**
- Modify: `src/pages/AgendaDetail.jsx` (imports near line 18; state near line 1568; page root Box near line 1755; header Stack near line 1779)

No new test. The two pure units are already covered, and this repo has no page-level tests — mounting `AgendaDetail` in jsdom would mean mocking routing, auth, live Firestore subscriptions, drag-and-drop, Liveblocks providers, and a dozen dialogs to assert one `className`. Task 4 is the real verification.

- [ ] **Step 1: Add the imports**

Add alongside the existing imports at the top of `src/pages/AgendaDetail.jsx`:

```jsx
import { useLocalStorage } from "@uidotdev/usehooks";
import PresentationModeToggle from "../components/PresentationModeToggle.jsx";
import { presentationModeSx, presentationClassName } from "../components/editor/caretVisibility.js";
```

- [ ] **Step 2: Add the flag**

In `AgendaDetail`, directly after `const { agendaId } = useParams();` (line ~1568):

```jsx
  // Presentation Mode — local to this viewer, sticky per agenda. Matches the
  // vm- key convention used by vm-calendar-org-filter / vm-board-org-filter.
  const [presentationMode, setPresentationMode] = useLocalStorage(
    `vm-agenda-presentation-mode-${agendaId}`,
    false,
  );
```

- [ ] **Step 3: Apply the class and rules to the page root**

Change the outermost `Box` (line ~1755) from:

```jsx
    <Box sx={{ maxWidth: 1280, mx: "auto", pb: 8 }}>
```

to:

```jsx
    <Box
      className={presentationClassName(presentationMode)}
      sx={{ maxWidth: 1280, mx: "auto", pb: 8, ...presentationModeSx }}
    >
```

The `sx` spread is unconditional; only the class toggles. Every `CollabBodyEditor` mount site on this page is a descendant of this `Box`, so one class covers both Overview and Working views.

- [ ] **Step 4: Render the toggle in the header**

In the header `Stack`, directly after `<AgendaPresence />` (line ~1779):

```jsx
          <PresentationModeToggle
            active={presentationMode}
            onToggle={() => setPresentationMode(!presentationMode)}
          />
```

- [ ] **Step 5: Verify the suite**

Run: `npm test`

The full suite takes roughly four to six minutes. It is not hung.

Expected: the 5 new tests pass.

**`src/components/__tests__/ProposedBoardRow.test.jsx` fails on clean `main`
before this work starts, and it is not yours.** Every failure in it is a
5-second timeout, and the count is load-dependent rather than fixed: a full-suite
run showed 2 failures, running that file alone showed 4. Do not chase it, and do
not try to fix it — it is a pre-existing flake, out of scope here.

Because that number moves, capture your own baseline instead of trusting one:
run `npm test` once **before** Task 1 and note the failing test names. The only
thing that matters after this task is that no test outside
`ProposedBoardRow.test.jsx` fails. If one does, that one is yours.

Do **not** run `npm run lint`. This repo has no ESLint configuration of any kind,
so the script fails with "ESLint couldn't find a configuration file" regardless of
your changes. Fixing that is out of scope for this feature.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AgendaDetail.jsx
git commit -m "feat(agenda): wire Meeting in Progress toggle into Agenda Detail"
```

---

### Task 4: Browser verification

**HARD GATE.** Do not report this feature as working until these steps have actually been run and observed. If any step cannot be completed, say which one and why. Do not substitute "the code looks right."

Two **isolated browser profiles** are required. Same-browser tabs give false positives because of local IndexedDB persistence. Use `/agent-browser`, not a bare Playwright profile. Both profiles need a signed-in `@vistamarconsulting.com` session; if the second profile cannot be authenticated, stop and surface that rather than reporting partial verification.

Verify against the deployed Vercel site, the project's primary test surface. That means Task 3 must be pushed first, so run `superpowers:requesting-code-review` and address findings, then push local `main` to `origin/dev` before starting. A local `npm run dev` check is acceptable as a smoke test beforehand.

- [ ] **Step 1:** Open the same agenda in both profiles. Confirm each sees the other's caret and name label.
- [ ] **Step 2:** In profile B, drag-select a run of text spanning a link and a bullet. Confirm profile A sees a tinted band over it. A collapsed cursor renders no DOM, so clicking alone proves nothing here.
- [ ] **Step 3:** In profile A, click Meeting in Progress. Confirm the caret, the name label, and the selection band are all gone; the text under the former band is still fully visible and legible, links included; and the header avatar stack still shows both users.
- [ ] **Step 4:** Type in profile B. Confirm the text appears live in profile A while profile A shows no caret.
- [ ] **Step 5:** Confirm profile B still sees profile A's caret and selection. This proves the toggle is local only.
- [ ] **Step 6:** Reload profile A. Confirm the mode is still on for that agenda. Open a different agenda in profile A and confirm it is off there.
- [ ] **Step 7:** Turn it off in profile A. Confirm caret, label, and selection band all return.
- [ ] **Step 8:** Screenshot the on and off states of profile A. Write screenshots to the session scratchpad, never into the repo.

Steps 3 and 5 catch the two mistakes this design is most exposed to: hiding selected text instead of its tint, and leaking the mode to other users.

---

## Done criteria

- The 5 new tests pass, and no test outside the pre-existing
  `ProposedBoardRow.test.jsx` flake fails.
- All eight browser steps observed, in two isolated profiles, on the deployed site.
- No stray files in the repo root or working tree (`git status --short` clean).
- Canonical naming recorded to memory: Presentation Mode (code) / "Meeting in Progress" (label).
