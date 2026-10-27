// src/components/BoardChatHints.jsx
//
// "?" button in the Board Chat header: a popover explaining how to use it.
import { useState } from "react";
import { Box, IconButton, Popover, Tooltip, Typography } from "@mui/material";
import { HelpOutline as HelpIcon } from "@mui/icons-material";

const HINTS = [
  ["Ask anything about the board", "\"What do I need to get done today?\", \"Has Andy finished the appointment import?\", \"What's blocked for Unio?\""],
  ["What it can see", "Every task and subtask on the board (archived ones on request), item comments, and the meeting calendar. It does not read Fireflies transcripts."],
  ["Filtering the board", "Say show, list or filter: \"Show me everything related to appointment data.\" A plain question gets an answer in the chat and leaves the board as it is."],
  ["Filter views", "Each filter becomes an AI chip above the board. Click a chip to turn it on or off, or click another chip to switch views. Turning a view off brings back the filters you had before. The x deletes a view."],
  ["Reset", "The Reset button beside the search box turns every view off and clears the search, column and scorecard filters. Views stay saved; the org pill is not changed."],
  ["Changing the board", "Ask it to create, update or delete tasks and subtasks. Nothing is written until you review the changes and click Apply. Untick any change you don't want."],
  ["Cost", "Each reply shows its cost, and the header shows the total for this chat. New chat starts over."],
];

export default function BoardChatHints() {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <Tooltip title="How to use Board Chat">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="How to use Board Chat">
          <HelpIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 360, p: 2 } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>How to use Board Chat</Typography>
        {HINTS.map(([title, body]) => (
          <Box key={title} sx={{ mb: 1.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
            <Typography variant="body2" color="text.secondary">{body}</Typography>
          </Box>
        ))}
      </Popover>
    </>
  );
}
