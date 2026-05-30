import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Box from "@mui/material/Box";
import { t } from "../../theme/tokens.js";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import EditorToolbar from "./EditorToolbar.jsx";

/**
 * Single-user TipTap v3 rich-text editor for one agenda body.
 *
 * Props:
 *   valueHtml   — HTML string (loaded once; external updates ignored after mount)
 *   onChangeHtml — called with editor.getHTML() after debounce
 *   placeholder  — placeholder text when empty
 *   debounceMs   — debounce delay in ms (default 1500)
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
}) {
  const debounceRef = useRef(null);
  const onChangeHtmlRef = useRef(onChangeHtml);
  useEffect(() => { onChangeHtmlRef.current = onChangeHtml; }, [onChangeHtml]);

  const flushDebounce = useCallback((editorInstance) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (editorInstance) {
      onChangeHtmlRef.current(editorInstance.getHTML());
    }
  }, []);

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
    ],

    content: sanitizeHtml(valueHtml) || "",

    onUpdate({ editor: ed }) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        onChangeHtmlRef.current(ed.getHTML());
      }, debounceMs);
    },
  });

  // On unmount: flush any pending debounced save
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      // editor may already be destroyed by TipTap's own cleanup — guard it
      if (editor && !editor.isDestroyed) {
        onChangeHtmlRef.current(editor.getHTML());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // cmd/ctrl+K link handler — shared by toolbar button and keydown listener
  const handleLink = useCallback(() => {
    if (!editor) return;
    const currentHref = editor.getAttributes("link").href ?? "";
    const url = window.prompt("Link URL", currentHref);
    if (url === null) return; // cancelled
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    }
  }, [editor]);

  // Attach cmd/ctrl+K keydown listener to the editor's DOM node
  useEffect(() => {
    if (!editor) return;
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

  return (
    <Box
      sx={{
        border: `1px solid ${t.cream3}`,
        borderRadius: "6px",
        overflow: "hidden",
        backgroundColor: "#fff",

        // ProseMirror editor area styles
        "& .ProseMirror": {
          outline: "none",
          fontSize: 13,
          color: t.ink2,
          lineHeight: 1.6,
          minHeight: 40,
          padding: "8px 12px",

          "& ul, & ol": {
            paddingLeft: "24px",
            margin: 0,
          },
          "& li": {
            marginBottom: "3px",
          },
          "& a": {
            color: t.copper,
          },
          "& u": {
            textDecoration: "underline",
          },

          // Placeholder — CSS-only approach (no Placeholder extension needed)
          "&.is-editor-empty:first-child::before, &:empty::before": {
            content: `"${placeholder}"`,
            color: t.ink3,
            pointerEvents: "none",
            float: "left",
            height: 0,
          },

          // Placeholder when first child paragraph is empty
          "& p.is-empty:first-child::before": {
            content: `attr(data-placeholder)`,
            color: t.ink3,
            pointerEvents: "none",
            float: "left",
            height: 0,
          },
        },
      }}
    >
      <EditorToolbar editor={editor} onLink={handleLink} />
      <EditorContent editor={editor} />
    </Box>
  );
}
