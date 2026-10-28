import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";

// The content extensions of the topic body editor — the ones that define its
// schema. Shared by CollabBodyEditor and topicBodyYjs so content written
// straight into a Yjs fragment parses exactly as the editor would.
export function bodyContentExtensions() {
  return [
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

    // Table, TableRow, TableHeader, TableCell. No column resizing.
    TableKit.configure({ table: { resizable: false } }),

    // Text color + highlight: <span style="color / background-color">.
    TextStyle,
    Color,
    BackgroundColor,
  ];
}
