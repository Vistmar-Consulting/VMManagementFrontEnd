import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Popover from "@mui/material/Popover";
import FormatColorText from "@mui/icons-material/FormatColorText";
import FormatColorFill from "@mui/icons-material/FormatColorFill";
import { t } from "../../theme/tokens.js";

const HEX = /^#[0-9a-f]{6}$/i;

const MODES = {
  color: {
    title: "Text color",
    Icon: FormatColorText,
    attr: "color",
    swatches: [t.ink, t.red, t.amber, t.green, t.blue, t.purple, t.copper, "#757575"],
    set: (chain, hex) => chain.setColor(hex),
    unset: (chain) => chain.unsetColor(),
  },
  background: {
    title: "Highlight",
    Icon: FormatColorFill,
    attr: "backgroundColor",
    swatches: ["#fff3a3", "#fde2e1", "#fdebd3", "#dcefdc", "#dde7f8", t.purpleLight, "#f3e3d3", "#eeeeee"],
    set: (chain, hex) => chain.setBackgroundColor(hex),
    unset: (chain) => chain.unsetBackgroundColor(),
  },
};

/**
 * Toolbar Text color / Highlight button. Opens swatches, a hex field and the
 * native color picker; the bar under the icon shows the color at the cursor.
 * Dragging the native picker only updates the hex field — the color is applied
 * on the picker's commit (native change) or Enter, so each pick is one undo step.
 *
 * Props:
 *   editor — TipTap Editor instance, or null (renders disabled)
 *   mode   — "color" | "background"
 *   sx     — the toolbar's shared IconButton sx (colours, hover, disabled)
 */
export default function ColorMenu({ editor, mode, sx }) {
  const m = MODES[mode];
  const [anchorEl, setAnchorEl] = useState(null);
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(null);
  // As in TableMenu: close rather than act on a different or destroyed body.
  const [target, setTarget] = useState(null);
  const isOpen = Boolean(anchorEl) && !!editor && editor === target && !editor.isDestroyed;
  const current = editor && !editor.isDestroyed ? editor.getAttributes("textStyle")[m.attr] : null;

  const close = () => {
    setAnchorEl(null);
    setTarget(null);
  };

  useEffect(() => {
    if (anchorEl && !isOpen) close();
  }, [anchorEl, isOpen]);

  const open = (e) => {
    setDraft(HEX.test(current || "") ? current : "");
    setTarget(editor);
    setAnchorEl(e.currentTarget);
  };

  const apply = (value) => {
    // Accept "c62828" as well as "#c62828".
    const hex = value.startsWith("#") ? value : `#${value}`;
    if (!HEX.test(hex)) return;
    m.set(editor.chain().focus(), hex).run();
    close();
  };

  // Native commit event (fires when the picker closes), not React's onChange,
  // which fires on every drag step.
  useEffect(() => {
    if (!picker) return undefined;
    const onCommit = (e) => apply(e.target.value);
    picker.addEventListener("change", onCommit);
    return () => picker.removeEventListener("change", onCommit);
  });

  return (
    <>
      <IconButton
        size="small"
        title={m.title}
        disabled={!editor}
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
        sx={{ ...sx, flexDirection: "column", gap: 0 }}
      >
        <m.Icon fontSize="small" />
        <Box sx={{ width: 14, height: 3, mt: "-2px", borderRadius: "1px", backgroundColor: current || "transparent" }} />
      </IconButton>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1, width: 168 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 32px)", gap: "8px" }}>
            {m.swatches.map((hex) => (
              <Box
                key={hex}
                component="button"
                type="button"
                aria-label={`${m.title} ${hex}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(hex)}
                sx={{
                  width: 32,
                  height: 24,
                  p: 0,
                  cursor: "pointer",
                  borderRadius: "4px",
                  backgroundColor: hex,
                  border: `1px solid ${current?.toLowerCase() === hex.toLowerCase() ? t.copper : t.cream3}`,
                }}
              />
            ))}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <input
              ref={setPicker}
              type="color"
              aria-label="Pick color"
              value={HEX.test(draft) ? draft : "#000000"}
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 28, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer" }}
            />
            <InputBase
              value={draft}
              placeholder="#rrggbb"
              onChange={(e) => setDraft(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply(draft);
                }
              }}
              inputProps={{ "aria-label": "Hex color", maxLength: 7 }}
              sx={{ flex: 1, fontSize: 13, px: 1, border: `1px solid ${t.cream3}`, borderRadius: "4px" }}
            />
          </Box>
          <Button
            size="small"
            fullWidth
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              m.unset(editor.chain().focus()).run();
              close();
            }}
            sx={{ mt: 1, fontSize: 12, color: t.ink3, textTransform: "none" }}
          >
            Clear
          </Button>
        </Box>
      </Popover>
    </>
  );
}
