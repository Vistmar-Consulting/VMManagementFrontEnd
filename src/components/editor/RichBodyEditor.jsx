import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import Box from "@mui/material/Box";
import { t } from "../../theme/tokens.js";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import EditorToolbar from "./EditorToolbar.jsx";
import { useEditorFocus } from "./editorFocus.jsx";
import { promptLink } from "./linkHelper.js";

// Shared ProseMirror content styles (padding/minHeight added per mode below).
const proseBase = {
  outline: "none",
  fontSize: 13,
  color: t.ink2,
  lineHeight: 1.15,
  "& ul, & ol": { paddingLeft: "24px", margin: 0 },
  "& li": { marginBottom: "3px" },
  // TipTap wraps each <li>'s text in a <p> carrying default ~13px margins — the
  // real source of oversized bullet spacing; zero it.
  "& li p": { margin: 0 },
  "& a": { color: t.copper },
  "& u": { textDecoration: "underline" },
  // Placeholder — emitted by the Placeholder extension as a data-placeholder
  // attr + is-editor-empty class on the empty first paragraph.
  "& p.is-editor-empty:first-of-type::before": {
    content: "attr(data-placeholder)",
    color: t.ink3,
    pointerEvents: "none",
    float: "left",
    height: 0,
  },
};

/**
 * Single-user TipTap v3 rich-text editor for one agenda body.
 *
 * Props:
 *   valueHtml    — HTML string (loaded once; external updates ignored after mount)
 *   onChangeHtml — called with editor.getHTML() after debounce
 *   placeholder  — placeholder text when empty
 *   debounceMs   — debounce delay in ms (default 1500)
 *   mode         — "inline" (default): own bordered box + own toolbar (Working view).
 *                  "shared": chromeless (no border/toolbar); registers its editor
 *                  with EditorFocusContext on focus so the Overview card's single
 *                  sticky toolbar can act on it.
 *
 * v3 duplicate-extension strategy:
 *   StarterKit v3 already bundles Link and Underline. Registering them again
 *   would throw "duplicate extension." Instead we configure both via
 *   StarterKit.configure({ link: {...}, underline: {} }). We also disable the
 *   extensions we don't want (heading, codeBlock, blockquote, horizontalRule).
 */
export default function RichBodyEditor({
  valueHtml,
  onChangeHtml,
  placeholder = "Type here…",
  debounceMs = 1500,
  mode = "inline",
}) {
  const shared = mode === "shared";
  const debounceRef = useRef(null);
  // onChangeHtml via ref so onUpdate + the unmount flush always call the latest
  // callback without re-registering effects (parent passes an inline arrow each
  // render). The unmount effect below depends only on [editor] for this reason.
  const onChangeHtmlRef = useRef(onChangeHtml);
  useEffect(() => { onChangeHtmlRef.current = onChangeHtml; }, [onChangeHtml]);

  // Focus context (null when not inside a provider, e.g. inline mode). Ref'd so
  // the useEditor onFocus closure (created once) always sees the latest setter.
  const focus = useEditorFocus();
  const focusRef = useRef(focus);
  useEffect(() => { focusRef.current = focus; }, [focus]);

  const editor = useEditor({
    // Suppress SSR/hydration warning — this app is client-only (Vite SPA)
    immediatelyRender: false,

    extensions: [
      StarterKit.configure({
        // Disable extensions we don't expose in this editor
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,

        // Configure Link (bundled in StarterKit v3 — do NOT add standalone)
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        },

        // Configure Underline (bundled in StarterKit v3 — do NOT add standalone)
        underline: {},

        // Lists are bundled (BulletList, OrderedList, ListItem, ListKeymap)
        // No extra configuration needed — defaults are fine.
      }),

      // Placeholder is NOT bundled in StarterKit v3 — register it from
      // @tiptap/extensions. Emits data-placeholder attr + is-editor-empty class
      // on the empty first node, which the CSS rule above targets.
      Placeholder.configure({ placeholder }),
    ],

    content: sanitizeHtml(valueHtml) || "",

    // In shared mode, report this editor as the active one when focused so the
    // Overview card's single sticky toolbar operates on it.
    onFocus({ editor: ed }) {
      if (shared) focusRef.current?.setActiveEditor(ed);
    },

    onUpdate({ editor: ed }) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        onChangeHtmlRef.current(ed.getHTML());
      }, debounceMs);
    },
  });

  // On unmount: flush a pending debounced save — but ONLY if one is actually
  // pending (the user edited since the last save). Flushing unconditionally
  // would write the editor's HTML on mere view/unmount, polluting untouched
  // bodies with "<p></p>", emitting spurious updatedAt/updatedByUid, and
  // (truthy "<p></p>") making the idempotent body migration skip real content.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        // editor may already be destroyed by TipTap's own cleanup — guard it
        if (editor && !editor.isDestroyed) {
          onChangeHtmlRef.current(editor.getHTML());
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // cmd/ctrl+K link handler — shared by the toolbar button and keydown listener
  const handleLink = useCallback(() => promptLink(editor), [editor]);

  // Attach cmd/ctrl+K keydown listener to the editor's DOM node
  useEffect(() => {
    if (!editor) return undefined;
    const dom = editor.view.dom;
    const onKeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleLink();
      }
    };
    dom.addEventListener("keydown", onKeydown);
    return () => dom.removeEventListener("keydown", onKeydown);
  }, [editor, handleLink]);

  // Shared mode: chromeless body (no border, no own toolbar) — the Overview
  // card supplies the single sticky toolbar.
  if (shared) {
    return (
      <Box sx={{ "& .ProseMirror": { ...proseBase, minHeight: 22, padding: 0 } }}>
        <EditorContent editor={editor} />
      </Box>
    );
  }

  // Inline mode (default): own bordered box + own toolbar (Working view).
  return (
    <Box
      sx={{
        border: `1px solid ${t.cream3}`,
        borderRadius: "6px",
        overflow: "hidden",
        backgroundColor: "#fff",
        "& .ProseMirror": { ...proseBase, minHeight: 40, padding: "8px 12px" },
      }}
    >
      <EditorToolbar editor={editor} onLink={handleLink} />
      <EditorContent editor={editor} />
    </Box>
  );
}
