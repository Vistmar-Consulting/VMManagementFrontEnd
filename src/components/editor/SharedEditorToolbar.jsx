import Box from "@mui/material/Box";
import EditorToolbar from "./EditorToolbar.jsx";
import { useEditorFocus } from "./editorFocus.jsx";
import { promptLink } from "./linkHelper.js";
import { t } from "../../theme/tokens.js";

// The single Word-style toolbar at the top of the Overview agenda card. Acts on
// whichever shared-mode body is currently focused (via the focus context);
// renders disabled buttons until a body is focused.
//
// NOTE: `position: sticky` is currently INERT — the app shell (SignedInLayout)
// lets the window scroll while <main> carries overflow:auto, which scopes the
// sticky to a non-scrolling element. It will start sticking automatically once
// the shell makes <main> the scroll container. Keeping non-sticky for now was a
// deliberate call (avoids an app-wide layout change); revisit later.
export default function SharedEditorToolbar() {
  const focus = useEditorFocus();
  // Guard against a stale reference if the focused body was just unmounted
  // (e.g. its topic was deleted) — a destroyed editor would throw on isActive.
  const active = focus?.activeEditor ?? null;
  const editor = active && !active.isDestroyed ? active : null;
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 3,
        backgroundColor: "#fff",
        borderBottom: `1px solid ${t.cream3}`,
        borderTopLeftRadius: "10px",
        borderTopRightRadius: "10px",
      }}
    >
      <EditorToolbar editor={editor} onLink={() => promptLink(editor)} />
    </Box>
  );
}
