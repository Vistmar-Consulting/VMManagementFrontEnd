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
import { Close } from "@mui/icons-material";

import { useOrgMembers } from "../hooks/useOrgMembers.js";
import { isClientEmail, removeOrgMember, upsertOrgMember } from "../lib/orgMembers.js";

export default function OrgMembersCard({ orgSlug }) {
  const { data: members, loading, error: loadError } = useOrgMembers(orgSlug);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  const sorted = [...(members || [])].sort((a, b) =>
    (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
  );

  const handleAdd = async () => {
    setAddError(null);
    const trimmedEmail = email.trim();
    if (!isClientEmail(trimmedEmail)) {
      setAddError("Enter a valid non-Vistamar email");
      return;
    }
    setBusy(true);
    try {
      await upsertOrgMember(orgSlug, { name: name.trim(), email: trimmedEmail, source: "manual" });
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
              sorted.map((member) => (
                <Box
                  key={member.id}
                  sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                      {member.name || member.email}
                    </Typography>
                    {member.name && (
                      <Typography
                        sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.3 }}
                      >
                        {member.email}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => handleRemove(member.id)}
                    aria-label={`Remove ${member.name || member.email}`}
                  >
                    <Close sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))
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
            placeholder="email@client.com"
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
