// "Meeting in Progress" — hides other users' carets, name labels, and
// selection tint on THIS screen only, for screen-sharing during a live
// meeting. Purely presentational: the flag and its persistence live in
// AgendaDetail. Spec:
// docs/superpowers/specs/2026-09-09-presentation-mode-design.md

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PresentToAllIcon from "@mui/icons-material/PresentToAll";
import { t } from "../theme/tokens.js";

export default function PresentationModeToggle({ active, onToggle }) {
  return (
    <Tooltip
      title={
        active
          ? "Meeting in Progress — collaborator cursors hidden on your screen"
          : "Meeting in Progress — hide collaborator cursors on your screen"
      }
    >
      <IconButton
        onClick={onToggle}
        size="small"
        aria-pressed={active}
        aria-label={`Meeting in Progress: ${active ? "on" : "off"}`}
        sx={{ color: active ? t.copper : t.ink3 }}
      >
        <PresentToAllIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
