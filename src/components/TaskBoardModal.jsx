// Notes modal for an item — flat list of comments, author-only edit + delete,
// add via textarea + Enter.
//
// Comment doc shape: items/{itemId}/comments/{commentId}
//   { itemId, authorId, body, parentCommentId, createdAt, updatedAt? }
// parentCommentId reserved for future reply nesting; always null in V1.
//
// Firestore rules already gate create on (authorId == auth.uid) and
// update/delete on (resource.data.authorId == auth.uid), so the UI gate
// is defense-in-depth, not the only protection.

import { useEffect, useRef, useState } from "react";
import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
} from "@mui/icons-material";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import MemberAvatar from "./MemberAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { db } from "../firebase.js";
import { useCollection } from "../hooks/useCollection.js";

const COMMENTS_ORDER = Object.freeze([orderBy("createdAt", "asc")]);

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

export default function TaskBoardModal({ open, onClose, item, users = [] }) {
  const { user } = useAuth();

  // Path is null when the modal is closed so useCollection tears the
  // subscription down (no orphan listeners across modal opens).
  const commentsPath = open && item ? `items/${item.id}/comments` : null;
  const { data: comments, loading } = useCollection(commentsPath, COMMENTS_ORDER);

  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const scrollRef = useRef(null);

  // Auto-scroll to newest comment when the list grows.
  useEffect(() => {
    if (!scrollRef.current || !open) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, comments.length]);

  // Reset transient state when modal closes (avoid stale edit values
  // sticking around if user re-opens for a different item).
  useEffect(() => {
    if (!open) {
      setNewText("");
      setEditingId(null);
      setEditText("");
      setDeleteConfirmId(null);
    }
  }, [open]);

  const userById = useMemo(() => {
    const map = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  const handleSend = async () => {
    const body = newText.trim();
    if (!body || !item || !user) return;
    await addDoc(collection(db, "items", item.id, "comments"), {
      itemId: item.id,
      authorId: user.uid,
      body,
      parentCommentId: null,
      createdAt: serverTimestamp(),
    });
    setNewText("");
  };

  const handleSaveEdit = async () => {
    const body = editText.trim();
    if (!editingId || !body || !item) return;
    await updateDoc(doc(db, "items", item.id, "comments", editingId), {
      body,
      updatedAt: serverTimestamp(),
    });
    setEditingId(null);
    setEditText("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId || !item) return;
    await deleteDoc(doc(db, "items", item.id, "comments", deleteConfirmId));
    setDeleteConfirmId(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Notes — {item?.title || "Untitled"}
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0 }}>
          <Box ref={scrollRef} sx={{ maxHeight: 400, overflowY: "auto", p: 3 }}>
            {loading && comments.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            ) : null}

            {!loading && comments.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No notes yet. Add the first one below.
              </Typography>
            ) : null}

            <Stack spacing={3}>
              {comments.map((c) => {
                const author = userById[c.authorId];
                const isMine = c.authorId === user?.uid;
                const created = tsToDate(c.createdAt);
                const time = created ? formatDistanceToNow(created, { addSuffix: true }) : "";
                const edited = Boolean(c.updatedAt);
                const isEditing = editingId === c.id;

                return (
                  <Box
                    key={c.id}
                    sx={{
                      display: "flex",
                      gap: 1.5,
                      "&:hover .comment-actions": { opacity: 1 },
                    }}
                  >
                    <Box sx={{ flexShrink: 0 }}>
                      <MemberAvatar user={author} size={28} border={false} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="baseline">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {author?.displayName || author?.email || "Unknown"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">{time}</Typography>
                        {edited && !isEditing && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                            (edited)
                          </Typography>
                        )}
                      </Stack>

                      {isEditing ? (
                        <Stack spacing={1} sx={{ mt: 0.5 }}>
                          <TextField
                            autoFocus
                            fullWidth
                            multiline
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveEdit();
                              }
                              if (e.key === "Escape") {
                                setEditingId(null);
                                setEditText("");
                              }
                            }}
                            size="small"
                          />
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button size="small" onClick={() => { setEditingId(null); setEditText(""); }}>
                              Cancel
                            </Button>
                            <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={!editText.trim()}>
                              Save
                            </Button>
                          </Stack>
                        </Stack>
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.25, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                        >
                          {c.body}
                        </Typography>
                      )}
                    </Box>

                    {isMine && !isEditing && (
                      <Stack
                        direction="row"
                        spacing={0.25}
                        className="comment-actions"
                        sx={{ opacity: 0, transition: "opacity 0.15s", flexShrink: 0, alignSelf: "flex-start" }}
                      >
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => { setEditingId(c.id); setEditText(c.body); }}>
                            <EditIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => setDeleteConfirmId(c.id)}>
                            <DeleteIcon sx={{ fontSize: 14, color: "error.main" }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ width: "100%" }}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder="Add a note… (Enter to save · Shift+Enter for newline)"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              size="small"
            />
            <Button
              variant="contained"
              onClick={handleSend}
              disabled={!newText.trim()}
              sx={{ flexShrink: 0 }}
            >
              Save
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteConfirmId)} onClose={() => setDeleteConfirmId(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Delete note?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
