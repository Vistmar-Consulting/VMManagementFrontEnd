import { useEffect, useRef, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import { doc, runTransaction } from "firebase/firestore";
import Box from "@mui/material/Box";
import { t } from "../../theme/tokens.js";
import { db } from "../../firebase.js";
import { sanitizeHtml } from "../../lib/agendaHtml.js";
import EditorToolbar from "./EditorToolbar.jsx";
import { useEditorFocus } from "./editorFocus.jsx";
import { promptLink } from "./linkHelper.js";
import { useRoom } from "../../lib/liveblocks.js";
import { isLocalEditTransaction } from "./collabSync.js";
import { useCollabFlushRegistry } from "./CollabFlushRegistry.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

// Shared ProseMirror content styles (padding/minHeight added per mode below).
// Copied from RichBodyEditor.jsx — kept local to avoid cross-file coupling.
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
  // Collaboration caret cursor — installed version uses .collaboration-carets__*
  // (verified against @tiptap/extension-collaboration-caret source).
  "& .collaboration-carets__caret": {
    borderLeft: "1px solid",
    borderRight: "1px solid",
    marginLeft: "-1px",
    marginRight: "-1px",
    wordBreak: "normal",
    pointerEvents: "none",
    position: "relative",
  },
  "& .collaboration-carets__label": {
    borderRadius: "3px 3px 3px 0",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    left: "-1px",
    lineHeight: "normal",
    padding: "1px 4px",
    position: "absolute",
    top: "-1.4em",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
};

/**
 * Collaborative TipTap v3 rich-text editor backed by Liveblocks + Yjs.
 * Replaces RichBodyEditor at topic-body and Open Floor mount sites.
 *
 * Props:
 *   fragmentKey   — Yjs XmlFragment key (topic.id or "openFloor")
 *   valueHtml     — HTML seed content (loaded once on first sync)
 *   seedDocPath   — Firestore doc path string holding the seed flag
 *   seedFlagField — field name on that doc to lock seeding (string)
 *   onChangeHtml  — mirror callback, called with editor.getHTML() after debounce
 *   placeholder   — placeholder text when empty
 *   debounceMs    — debounce delay in ms (default 1500)
 *   mode          — "inline" (default): own bordered box + own toolbar.
 *                   "shared": chromeless; registers with EditorFocusContext on
 *                   focus so the Overview card's single sticky toolbar can act on it.
 */
export default function CollabBodyEditor({
  fragmentKey,
  valueHtml,
  seedDocPath,
  seedFlagField,
  onChangeHtml,
  placeholder = "Type here…",
  debounceMs = 1500,
  mode = "inline",
}) {
  const shared = mode === "shared";

  // Yjs doc from the Liveblocks room
  const room = useRoom();
  const yProvider = useMemo(() => getYjsProviderForRoom(room), [room]);
  const ydoc = useMemo(() => yProvider.getYDoc(), [yProvider]);

  // Auth profile for presence caret
  const { profile } = useAuth();

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
        // undoRedo: false is mandatory — Collaboration owns undo/redo history.
        // (NOT history: false — that's ignored in StarterKit v3.)
        undoRedo: false,

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
      }),

      // Placeholder is NOT bundled in StarterKit v3 — register it from
      // @tiptap/extensions. Emits data-placeholder attr + is-editor-empty class
      // on the empty first node, which the CSS rule above targets.
      Placeholder.configure({ placeholder }),

      // Collaboration takes over history and binds to the Yjs doc fragment.
      // NO `content` prop on useEditor — Yjs is the source.
      Collaboration.configure({ document: ydoc, field: fragmentKey }),

      // Presence carets — provider option name is "provider"; the extension
      // reads provider.awareness internally (verified against installed source).
      CollaborationCaret.configure({
        provider: yProvider,
        user: {
          name: profile?.displayName || "User",
          color: profile?.avatarColor || "#888888",
        },
      }),
    ],

    // In shared mode, report this editor as the active one when focused so the
    // Overview card's single sticky toolbar operates on it.
    onFocus({ editor: ed }) {
      if (shared) focusRef.current?.setActiveEditor(ed);
    },

    onUpdate({ editor: ed, transaction }) {
      // Only mirror on LOCAL user edits — remote y-prosemirror transactions are
      // tagged with isChangeOrigin: true and must NOT trigger a Firestore write
      // (would cause N-client write storms).
      if (!isLocalEditTransaction(transaction)) return;
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

  // Flush registry — lets SyncMeetingDialog force-flush pending mirrors before
  // the AI reads current content.
  const { register } = useCollabFlushRegistry();
  useEffect(() => {
    const flush = () => {
      if (!debounceRef.current) return undefined;
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      if (editor && !editor.isDestroyed) {
        onChangeHtmlRef.current(editor.getHTML());
      }
      return undefined;
    };
    const unregister = register(flush);
    return unregister;
  }, [editor, register]);

  // Seeding effect — run once the provider has synced. Wins a Firestore
  // transaction to ensure exactly one client seeds the Yjs fragment from the
  // legacy bodyHtml value. Uses seededRef so it runs at most once per mount.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!editor) return undefined;
    let cancelled = false;

    const attemptSeed = async () => {
      if (seededRef.current || cancelled) return;
      const frag = ydoc.get(fragmentKey, Y.XmlFragment);
      if (frag.length > 0) { seededRef.current = true; return; }   // already has content
      if (!valueHtml) { seededRef.current = true; return; }         // nothing to seed
      try {
        const seedRef = doc(db, ...seedDocPath.split("/"));          // build DocumentReference from path
        const won = await runTransaction(db, async (tx) => {
          const snap = await tx.get(seedRef);
          if (snap.data()?.[seedFlagField]) return false;
          tx.update(seedRef, { [seedFlagField]: true });
          return true;
        });
        if (won && !cancelled && ydoc.get(fragmentKey, Y.XmlFragment).length === 0) {
          // v3 options form; emitUpdate:false avoids a redundant same-content mirror write.
          editor.commands.setContent(sanitizeHtml(valueHtml) || "", { emitUpdate: false });
        }
      } catch {
        // best-effort; another client will have seeded
      } finally {
        seededRef.current = true;
      }
    };

    // The provider emits both "synced" and "sync" events (verified in source).
    // It also exposes a .synced boolean getter on LiveblocksYjsProvider.
    if (yProvider.synced) attemptSeed();
    const onSynced = (isSynced) => { if (isSynced) attemptSeed(); };
    yProvider.on("synced", onSynced);
    return () => {
      cancelled = true;
      yProvider.off("synced", onSynced);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, yProvider, ydoc]);

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
