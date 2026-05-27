// Standard color-picker UX for dialogs (Figma/Linear/GitHub pattern):
//   1. Free-form HSV picker — saturation/value rectangle + hue strip.
//   2. Hex input with live preview swatch.
//   3. Preset row at the bottom for quick-picks.
//
// Wraps `react-colorful` (small, modern, ~6KB). All three controls stay in
// sync via a single controlled `color` prop.

import { HexColorInput, HexColorPicker } from "react-colorful";
import { Box, Stack, Typography } from "@mui/material";

export default function ColorPicker({ color, onChange, presets = [] }) {
  const normalized = (color || "").toLowerCase();

  return (
    <Stack spacing={2}>
      {/* Free-form picker */}
      <Box
        sx={{
          "& .react-colorful": {
            width: "100%",
            height: 180,
          },
          "& .react-colorful__saturation": {
            borderRadius: "8px 8px 0 0",
            borderBottom: "none",
          },
          "& .react-colorful__hue": {
            borderRadius: "0 0 8px 8px",
            height: 18,
          },
          "& .react-colorful__pointer": {
            width: 18,
            height: 18,
          },
        }}
      >
        <HexColorPicker color={color || "#3b82f6"} onChange={onChange} />
      </Box>

      {/* Hex input with preview */}
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1,
            backgroundColor: color || "transparent",
            border: "1px solid rgba(0,0,0,0.12)",
            flexShrink: 0,
          }}
        />
        <Box
          sx={{
            flex: 1,
            "& input": {
              width: "100%",
              border: "1px solid rgba(0,0,0,0.23)",
              borderRadius: 4,
              padding: "8px 10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              outline: "none",
              "&:focus": { borderColor: "#3b82f6" },
            },
          }}
        >
          <HexColorInput color={color || "#3b82f6"} onChange={onChange} prefixed />
        </Box>
      </Stack>

      {/* Preset row */}
      {presets.length > 0 && (
        <Box>
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 0.75, color: "text.secondary", letterSpacing: 0.4 }}
          >
            PRESETS
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {presets.map((p) => {
              const selected = p.toLowerCase() === normalized;
              return (
                <Box
                  key={p}
                  onClick={() => onChange(p)}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    backgroundColor: p,
                    cursor: "pointer",
                    transition: "transform 0.1s ease",
                    border: selected ? "2px solid #fff" : "2px solid transparent",
                    boxShadow: selected
                      ? `0 0 0 2px ${p}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.05)",
                    "&:hover": { transform: "scale(1.1)" },
                  }}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
