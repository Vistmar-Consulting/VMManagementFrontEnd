import { useEffect, useReducer } from "react";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import FormatBold from "@mui/icons-material/FormatBold";
import FormatItalic from "@mui/icons-material/FormatItalic";
import FormatUnderlined from "@mui/icons-material/FormatUnderlined";
import FormatListBulleted from "@mui/icons-material/FormatListBulleted";
import FormatListNumbered from "@mui/icons-material/FormatListNumbered";
import FormatIndentIncrease from "@mui/icons-material/FormatIndentIncrease";
import FormatIndentDecrease from "@mui/icons-material/FormatIndentDecrease";
import LinkIcon from "@mui/icons-material/Link";
import { t } from "../../theme/tokens.js";

/**
 * Compact MUI toolbar bound to a TipTap editor.
 * Exposes: bold, italic, underline, bullet list, numbered list,
 * indent (sink list item), outdent (lift list item), link (cmd+K).
 *
 * Props:
 *   editor   — TipTap Editor instance, or null. In shared-toolbar mode this is
 *              the currently-focused body's editor (null until one is focused);
 *              when null the buttons render disabled rather than hiding.
 *   onLink   — callback to open the link prompt (shared with cmd+K handler)
 */
export default function EditorToolbar({ editor, onLink }) {
  // Re-render on the editor's selection/transaction changes so active-states
  // stay in sync. Required when this toolbar is rendered OUTSIDE the editor's
  // own component (shared-toolbar mode) — there it won't otherwise re-render
  // when the cursor moves inside the editor. Harmless (no-op extra) inline.
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => force();
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", update);
    return () => {
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", update);
    };
  }, [editor]);

  const disabled = !editor;
  const active = (name, attrs) =>
    !disabled && editor.isActive(name, attrs)
      ? { backgroundColor: t.copperFaint, color: t.copper }
      : { color: t.ink3 };

  const btn = (icon, title, onClickFn, isActiveName, isActiveAttrs) => (
    <IconButton
      size="small"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClickFn}
      sx={{
        p: "4px",
        borderRadius: "4px",
        ...active(isActiveName, isActiveAttrs),
        "&:hover": disabled ? {} : { backgroundColor: t.copperFaint, color: t.copper },
        "&.Mui-disabled": { color: t.cream3 },
      }}
    >
      {icon}
    </IconButton>
  );

  return (
    <Toolbar
      variant="dense"
      disableGutters
      sx={{
        minHeight: 36,
        gap: "2px",
        px: "4px",
        borderBottom: `1px solid ${t.cream3}`,
        flexWrap: "wrap",
      }}
    >
      {btn(
        <FormatBold fontSize="small" />,
        "Bold (Ctrl+B)",
        () => editor.chain().focus().toggleBold().run(),
        "bold",
      )}
      {btn(
        <FormatItalic fontSize="small" />,
        "Italic (Ctrl+I)",
        () => editor.chain().focus().toggleItalic().run(),
        "italic",
      )}
      {btn(
        <FormatUnderlined fontSize="small" />,
        "Underline (Ctrl+U)",
        () => editor.chain().focus().toggleUnderline().run(),
        "underline",
      )}
      {btn(
        <FormatListBulleted fontSize="small" />,
        "Bullet list",
        () => editor.chain().focus().toggleBulletList().run(),
        "bulletList",
      )}
      {btn(
        <FormatListNumbered fontSize="small" />,
        "Numbered list",
        () => editor.chain().focus().toggleOrderedList().run(),
        "orderedList",
      )}
      {btn(
        <FormatIndentIncrease fontSize="small" />,
        "Indent (Tab)",
        () => editor.chain().focus().sinkListItem("listItem").run(),
        // indent has no "active" state — always use default colour
        "__never__",
      )}
      {btn(
        <FormatIndentDecrease fontSize="small" />,
        "Outdent (Shift+Tab)",
        () => editor.chain().focus().liftListItem("listItem").run(),
        "__never__",
      )}
      {btn(
        <LinkIcon fontSize="small" />,
        "Link (Ctrl+K)",
        onLink,
        "link",
      )}
    </Toolbar>
  );
}
