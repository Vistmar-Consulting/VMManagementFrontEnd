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
