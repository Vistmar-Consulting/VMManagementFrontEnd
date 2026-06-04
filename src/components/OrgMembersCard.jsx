import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close, EditOutlined } from "@mui/icons-material";

import { useOrgMembers } from "../hooks/useOrgMembers.js";
import { isClientEmail, memberIdFromEmail, removeOrgMember, upsertOrgMember } from "../lib/orgMembers.js";

export default function OrgMembersCard({ orgSlug, allowVMDomain = false }) {
  const { data: members, loading, error: loadError } = useOrgMembers(orgSlug);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  // Inline edit state — only one row editable at a time.
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const sorted = [...(members || [])].sort((a, b) =>
    (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
  );

  const handleAdd = async () => {
    setAddError(null);
    const trimmedEmail = email.trim();
    const emailValid = allowVMDomain
      ? !!trimmedEmail && trimmedEmail.includes("@")
      : isClientEmail(trimmedEmail);
    if (!emailValid) {
      setAddError(allowVMDomain ? "Enter a valid email" : "Enter a valid non-Vistamar email");
      return;
    }
    setBusy(true);
    try {
      await upsertOrgMember(orgSlug, { name: name.trim(), email: trimmedEmail, source: "manual", allowVMDomain });
      setName("");
      setEmail("");
    } catch (err) {
      setAddError(err.message || "Add failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (memberId) => {
    try {
      await removeOrgMember(orgSlug, memberId);
    } catch (err) {
      setAddError(err.message || "Remove failed");
    }
  };

  const startEdit = (member) => {
    setEditingId(member.id);
    setEditName(member.name || "");
    setEditEmail(member.email || "");
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (member) => {
    setEditError(null);
    const trimmedEmail = editEmail.trim();
    const emailValid = allowVMDomain
      ? !!trimmedEmail && trimmedEmail.includes("@")
      : isClientEmail(trimmedEmail);
    if (!emailValid) {
      setEditError(allowVMDomain ? "Enter a valid email" : "Enter a valid non-Vistamar email");
      return;
    }
    setEditBusy(true);
    try {
      const newId = memberIdFromEmail(trimmedEmail);
      if (newId !== member.id) {
        // Email changed — delete old doc, create new one.
        await removeOrgMember(orgSlug, member.id);
      }
      await upsertOrgMember(orgSlug, { name: editName.trim(), email: trimmedEmail, source: member.source || "manual", allowVMDomain });
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || "Save failed");
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: "#6b6b8a",
            mb: 1.5,
          }}
        >
          Members
        </Typography>

        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {loadError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {loadError.message || "Failed to load members"}
          </Alert>
        )}

        {!loading && !loadError && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1.5 }}>
            {sorted.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No members yet — added automatically when you schedule meetings, or add one above.
              </Typography>
            ) : (
              sorted.map((member) =>
                editingId === member.id ? (
                  <Box key={member.id} sx={{ display: "flex", flexDirection: "column", gap: 0.75, py: 0.5 }}>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        size="small"
                        placeholder="Name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={editBusy}
                        sx={{ flex: 1 }}
                        autoFocus
                      />
                      <TextField
                        size="small"
                        placeholder="Email"
                        value={editEmail}
                        onChange={(e) => { setEditEmail(e.target.value); if (editError) setEditError(null); }}
                        disabled={editBusy}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" onClick={() => handleSaveEdit(member)} disabled={editBusy || !editEmail.trim()}>
                        {editBusy ? "Saving…" : "Save"}
                      </Button>
                      <Button size="small" onClick={cancelEdit} disabled={editBusy}>Cancel</Button>
                    </Stack>
                    {editError && <Alert severity="error" sx={{ py: 0 }}>{editError}</Alert>}
                  </Box>
                ) : (
                  <Box
                    key={member.id}
                    sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                        {member.name || member.email}
                      </Typography>
                      {member.name && (
                        <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.3 }}>
                          {member.email}
                        </Typography>
                      )}
                    </Box>
                    <IconButton size="small" onClick={() => startEdit(member)} aria-label={`Edit ${member.name || member.email}`}>
                      <EditOutlined sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleRemove(member.id)} aria-label={`Remove ${member.name || member.email}`}>
                      <Close sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                )
              )
            )}
          </Box>
        )}

        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            size="small"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            placeholder={allowVMDomain ? "name@vistamarconsulting.com" : "email@client.com"}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (addError) setAddError(null);
            }}
            disabled={busy}
            sx={{ flex: 1 }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={handleAdd}
            disabled={busy || !email.trim()}
          >
            {busy ? "Adding…" : "Add"}
          </Button>
        </Stack>

        {addError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {addError}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
