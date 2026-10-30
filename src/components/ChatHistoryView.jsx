// src/components/ChatHistoryView.jsx
//
// The History view of a chat panel (Board Chat, Agenda Chat): saved chats,
// newest first, to open or delete. Deleting asks first; a Board Chat chat that
// made filter views also asks whether to delete them.
import { useState } from "react";
import { format } from "date-fns";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { formatUsd } from "../lib/boardChat/conversation.js";

const when = (c) => (c.updatedAt ? format(c.updatedAt.toDate(), "MMM d, h:mm a") : "Just now");

// While an answer is running nothing here is clickable: the turn is saved to
// the chat it was sent in, and switching or deleting under it would mix chats.
export default function ChatHistoryView({ chats, currentId, busy, onOpen, onDelete, viewCount = () => 0 }) {
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const confirm = async (deleteViews) => {
    setDeleting(true);
    await onDelete(confirming.id, { deleteViews });
    setDeleting(false);
    setConfirming(null);
  };

  if (chats.length === 0) {
    return <Typography variant="body2" color="text.secondary">No saved chats yet.</Typography>;
  }
  const views = confirming ? viewCount(confirming.id) : 0;

  return (
    <Box>
      <List dense disablePadding>
        {chats.map((c) => (
          <ListItemButton key={c.id} selected={c.id === currentId} disabled={busy} onClick={() => onOpen(c.id)} sx={{ pr: 6, borderRadius: 1 }}>
            <ListItemText
              primary={c.title || "(untitled)"}
              secondary={`${when(c)} · ${formatUsd(c.costUsd || 0)}${c.unpriced ? " + unpriced" : ""}`}
              primaryTypographyProps={{ noWrap: true }}
            />
            <IconButton
              size="small"
              edge="end"
              disabled={busy}
              aria-label={`Delete chat ${c.title}`}
              onClick={(ev) => { ev.stopPropagation(); setConfirming(c); }}
              sx={{ position: "absolute", right: 8 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>

      <Dialog open={Boolean(confirming)} onClose={() => !deleting && setConfirming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this chat?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">&ldquo;{confirming?.title}&rdquo; will be deleted for good.</Typography>
          {views > 0 && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              It made {views} filter view{views === 1 ? "" : "s"} on the board. Delete {views === 1 ? "it" : "them"} too?
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} disabled={deleting}>Cancel</Button>
          {views > 0 ? (
            <>
              <Button color="error" onClick={() => confirm(false)} disabled={deleting}>Delete chat, keep views</Button>
              <Button color="error" variant="contained" onClick={() => confirm(true)} disabled={deleting}>Delete both</Button>
            </>
          ) : (
            <Button color="error" variant="contained" onClick={() => confirm(false)} disabled={deleting}>Delete</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
