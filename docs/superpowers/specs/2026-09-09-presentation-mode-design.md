# Presentation Mode ("Meeting in Progress") — Design

**Date:** 2026-09-09
**Status:** Approved, not yet implemented
**Scope:** Agenda Detail page (`src/pages/AgendaDetail.jsx`) and the collaborative editor's caret styling

---

## 1. Problem

Agenda bodies are collaboratively editable through TipTap + Yjs + Liveblocks. The
`CollaborationCaret` extension renders, for every other connected user, a colored
vertical caret, a floating name label positioned above it, and a tinted band over
any text that user has selected, all inside the ProseMirror DOM.

During a live meeting the agenda is screen-shared to the whole group over Teams.
Every remote caret, name tag, and selection band is then projected to the room.
The labels move, blink in and out as people click around, and overlap the text
being discussed; a selection band paints a colored stripe across whatever someone
happens to have highlighted. All of it is noise for the audience and a distraction
for the presenter.

Live editing itself is wanted. Only the per-user cursor decorations are the
problem.

## 2. Goal

Give the presenter a one-click toggle that suppresses other users' carets, name
labels, and selection tint on their own screen, with no effect on collaborative
editing.

**Non-goals:**

- Changing what any other user sees.
- Stopping the local user's own cursor from being broadcast to others.
- Any change to Yjs sync, awareness, the seeding election, or the Firestore mirror.
- A read-only or locked mode. Editing stays fully available while the mode is on.

## 3. Naming

- Internal / code name: **Presentation Mode**. Used for the component, the module,
  the class, and the storage key.
- User-facing button label and tooltip: **"Meeting in Progress"**.

This pair is settled and is what the implementation uses. Per the shared-vocabulary
convention it gets recorded to memory once the feature ships.

## 4. Decisions

| Question | Decision |
|---|---|
| Who is affected | Local viewer only. No shared state, nothing broadcast. |
| What is hidden | Remote carets, their name labels, and their selection tint. |
| What stays visible | The header avatar stack (`AgendaPresence`), and all live text updates. |
| Persistence | Sticky per agenda, in `localStorage`. |

Local-only was chosen because the presenter is the only person whose screen is
projected. A room-wide flag would need shared state, an owner, and a rule for who
may turn it off, none of which the problem requires.

## 5. Design

### 5.1 Mechanism

`CollaborationCaret` produces three remote-user decorations:

| Class | What it is | How it is suppressed |
|---|---|---|
| `.collaboration-carets__caret` | Colored vertical bar | `display: none` |
| `.collaboration-carets__label` | Floating name tag | `display: none` |
| `.ProseMirror-yjs-selection` | Tinted band over selected text | `background-color: transparent !important` |

Presentation Mode adds a class to the Agenda Detail page root and applies those
three rules scoped under it. That is the entire visual mechanism.

The first two are **widget** decorations: standalone elements the extension
injects, holding no document text. Removing them from the layout is safe.

The third is an **inline** decoration applied directly to real document text.
`display: none` on it would hide the user's own agenda content, which is why it
gets a transparent background instead. The tint arrives as an inline `style`
attribute written by the extension's selection builder, so `!important` is
required to override it. There is currently no rule for this class anywhere in
`src/`, so this is a new style, not an override of an existing one.

Because all three are ProseMirror *decorations* rather than document content,
suppressing them cannot affect document state. The editor keeps receiving and
applying remote transactions exactly as before, so text still changes live under
the reader's eyes.

### 5.2 Components

**`PresentationModeToggle`** (new, `src/components/PresentationModeToggle.jsx`)

A presentational icon button. Props: `active` (boolean), `onToggle` (function).
Renders a MUI `IconButton` wrapped in a `Tooltip`, using the `PresentToAll` icon
from `@mui/icons-material` to match the MUI icons already in this header
(`ArrowBack`, `HistoryIcon`). Carries `aria-pressed={active}` and an accessible
name that reflects state ("Meeting in Progress: on" / "off"). Active state is
indicated by color, not by a layout change, so the header does not shift when it
is flipped. It owns no state and knows nothing about agendas or Liveblocks.

**`AgendaDetail`** (modified)

- Holds the flag via `useLocalStorage` from `@uidotdev/usehooks`, keyed
  `vm-agenda-presentation-mode-{agendaId}`, defaulting to `false`. This matches
  the existing filter-state pattern and the `vm-` key prefix already used by
  `vm-calendar-org-filter`, `vm-board-org-filter`, and `vm-sidebar-collapsed`.
- Renders `PresentationModeToggle` in the existing header `Stack`, immediately
  after `AgendaPresence`, so presence controls sit together.
- Applies `className={presentationClassName(presentationMode)}` to the page root
  `Box`, and carries the scoped rules in that `Box`'s `sx`.

The class sits on the same element that carries the `sx`, so the selectors must
use the compound form `&.{CLASS} .collaboration-carets__caret`, not the
descendant form `& .{CLASS} …`. Getting this wrong produces a rule that silently
matches nothing.

`presentationModeSx` is spread into the root `Box` unconditionally. Only the
`className` toggles. Conditionally spreading the `sx` as well would churn Emotion's
generated class on every flip for no benefit.

**`src/components/editor/caretVisibility.js`** (new, small)

Exports three things:

- `PRESENTATION_MODE_CLASS` — the class name.
- `presentationModeSx` — the `sx` fragment carrying the three rules above.
- `presentationClassName(active)` — returns the class when `active` is true,
  `undefined` otherwise. This is the entire binding between the flag and the DOM,
  pulled into one pure function so it can be tested without mounting a page.

Keeping this in one module means the class name is not duplicated as a string
literal across the page and its tests, and the caret class names stay next to the
editor that produces them.

### 5.3 Data flow

```
localStorage[vm-agenda-presentation-mode-{agendaId}]
        │  useLocalStorage
        ▼
AgendaDetail state ──► PresentationModeToggle (active, onToggle)
        │
        └──► presentationClassName(active) on page root
                     │
                     └──► scoped CSS suppresses caret, label, selection tint
```

No network, no Firestore write, no Liveblocks message.

### 5.4 Error handling

There is no failure path to handle. The flag is a boolean with a `false` default,
so a missing or corrupt `localStorage` value falls back to the normal view, which
is the current behavior. `useLocalStorage` already tolerates unavailable storage.

If a future version of the caret extension renames any of the three classes, the
mode would silently stop suppressing that decoration. That is a visible, harmless
regression, and the browser verification step below is what catches it. The same
risk already applies to the existing caret styles in `proseBase`.

## 6. Testing

**Unit — `src/components/__tests__/PresentationModeToggle.test.jsx`**

1. Renders a button whose accessible name reflects the off state, with
   `aria-pressed="false"`.
2. Renders the on state with `aria-pressed="true"`.
3. Clicking calls `onToggle` exactly once.

**Unit — `src/components/editor/__tests__/caretVisibility.test.js`**

4. `presentationClassName(true)` returns `PRESENTATION_MODE_CLASS`, and
   `presentationClassName(false)` returns `undefined`.

Deliberately not tested: the content of `presentationModeSx` itself, since
asserting a constant against its own literal value has near-zero signal; and the
`AgendaDetail` render binding, since this repo has no page-level tests and that
component pulls in routing, auth, live Firestore subscriptions, drag-and-drop,
Liveblocks providers, and a dozen dialogs. Mounting it in jsdom to assert one
`className` would mean mocking most of the app, which produces either a brittle
harness or a test that quietly gets skipped. The pure function above covers the
same binding at a fraction of the cost.

No unit test can prove the rules actually suppress a live caret, since that needs
a real Liveblocks room and a second connected client. The browser step is the real
verification, including for the compound-selector form.

**Browser verification (required before this ships)**

Two isolated browser profiles, per the collaboration verification rule. Same-browser
tabs give false positives because of local IndexedDB persistence.

1. Open the same agenda in both profiles and confirm each sees the other's caret
   and name label.
2. In profile B, drag-select a run of text and confirm A sees a tinted band over
   it. It must be a real selection: a plain collapsed cursor produces a zero-width
   decoration that renders no DOM, so clicking alone will show no band and is not
   a valid test of this step. Pick a run that spans a link and a bullet, since a
   copper link on a de-tinted background is where a contrast surprise would show.
3. In profile A, turn on Meeting in Progress. Confirm A's carets, labels, and the
   selection band are gone, that the text under the former band is still fully
   visible and legible, and that A's header avatar stack still shows both users.
4. Type in profile B. Confirm the text appears live in A while A shows no caret.
5. Confirm profile B still sees A's caret and selection, proving the toggle is
   local only.
6. Reload A and confirm the mode is still on for that agenda, then open a
   different agenda in A and confirm it is off there.
7. Turn it off in A and confirm carets, labels, and the selection band return.

Steps 3 and 5 are the ones that catch the two mistakes this design is most
exposed to: hiding selected text instead of its tint, and leaking the mode to
other users.

## 7. Files touched

| File | Change |
|---|---|
| `src/components/PresentationModeToggle.jsx` | New. Presentational toggle button. |
| `src/components/editor/caretVisibility.js` | New. Class name, the three scoped rules, and `presentationClassName`. |
| `src/pages/AgendaDetail.jsx` | Flag state, class on page root, toggle in header. |
| `src/components/__tests__/PresentationModeToggle.test.jsx` | New. Tests 1-3. |
| `src/components/editor/__tests__/caretVisibility.test.js` | New. Test 4. |

No new dependencies. `CollabBodyEditor.jsx` is not modified; its caret styles stay
where they are and are simply overridden when the page class is present.
