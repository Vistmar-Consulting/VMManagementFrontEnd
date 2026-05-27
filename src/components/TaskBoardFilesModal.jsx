// Files modal for an item — URL links (SharePoint, Drive, webpages,
// anything with a URL). Actual file uploads (PDF/docx/xlsx via Firebase
// Storage) land when Blaze enables. Same dialog will get an Attach
// button at that point.
//
// File doc shape: items/{itemId}/files/{fileId}
//   { itemId, name, url, authorId, createdAt }
// itemId denormalized for collectionGroup file-count badge.

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  InsertDriveFileOutlined as FileIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

import MemberAvatar from "./MemberAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { db } from "../firebase.js";
import { useCollection } from "../hooks/useCollection.js";

const FILES_ORDER = Object.freeze([orderBy("createdAt", "asc")]);

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

function isValidUrl(s) {
  if (!s) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function deriveNameFromUrl(s) {
  try {
    const u = new URL(s.trim());
    return u.hostname + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    return s.trim();
  }
}

export default function TaskBoardFilesModal({ open, onClose, item, users = [] }) {
  const { user } = useAuth();

  const filesPath = open && item ? `items/${item.id}/files` : null;
  const { data: files, loading } = useCollection(filesPath, FILES_ORDER);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setNewUrl("");
      setDeleteConfirmId(null);
    }
  }, [open]);

  const userById = useMemo(() => {
    const map = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  const urlValid = isValidUrl(newUrl);

  const handleAdd = async () => {
    if (!urlValid || !item || !user) return;
    const url = newUrl.trim();
    const name = newName.trim() || deriveNameFromUrl(url);
    await addDoc(collection(db, "items", item.id, "files"), {
      itemId: item.id,
      name,
      url,
      authorId: user.uid,
      createdAt: serverTimestamp(),
    });
    setNewName("");
    setNewUrl("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId || !item) return;
    await deleteDoc(doc(db, "items", item.id, "files", deleteConfirmId));
    setDeleteConfirmId(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Files — {item?.title || "Untitled"}
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ maxHeight: 360, overflowY: "auto", p: 3 }}>
            {loading && files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            ) : null}

            {!loading && files.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No files yet. Paste a URL below — SharePoint, Drive, webpage, anything.
              </Typography>
            ) : null}

            <Stack spacing={2}>
              {files.map((f) => {
                const author = userById[f.authorId];
                const isMine = f.authorId === user?.uid;
                const created = tsToDate(f.createdAt);
                const time = created ? formatDistanceToNow(created, { addSuffix: true }) : "";

                return (
                  <Box
                    key={f.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      p: 1.5,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1.5,
                      "&:hover .file-actions": { opacity: 1 },
                    }}
                  >
                    <FileIcon sx={{ fontSize: 22, color: "text.secondary", flexShrink: 0 }} />

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Link
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="hover"
                        sx={{
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          color: "primary.main",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.5,
                          wordBreak: "break-word",
                        }}
                      >
                        {f.name}
                        <OpenInNewIcon sx={{ fontSize: 12 }} />
                      </Link>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
                        <MemberAvatar user={author} size={18} border={false} />
                        <Typography variant="caption" color="text.secondary">
                          {author?.displayName || author?.email || "Unknown"} · {time}
                        </Typography>
                      </Stack>
                    </Box>

                    {isMine && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          className="file-actions"
                          onClick={() => setDeleteConfirmId(f.id)}
                          sx={{ opacity: 0, transition: "opacity 0.15s", flexShrink: 0 }}
                        >
                          <DeleteIcon sx={{ fontSize: 16, color: "error.main" }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </DialogContent>

        <DialogActions sx={{ p: 2, flexDirection: "column", alignItems: "stretch" }}>
          <Stack spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              placeholder="URL — https://… (SharePoint, Drive, webpage)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              error={Boolean(newUrl) && !urlValid}
              helperText={Boolean(newUrl) && !urlValid ? "Must start with http:// or https://" : " "}
              FormHelperTextProps={{ sx: { m: 0, fontSize: 11 } }}
            />
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                placeholder="Display name (optional — defaults to the URL)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <Button
                variant="contained"
                onClick={handleAdd}
                disabled={!urlValid}
                sx={{ flexShrink: 0 }}
              >
                Save
              </Button>
            </Stack>
          </Stack>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteConfirmId)} onClose={() => setDeleteConfirmId(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Delete file link?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Removes the link from this item. The original file at the URL is unaffected.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
