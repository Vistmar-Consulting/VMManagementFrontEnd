// V2.2.2f — Assign organizationId to a calendar_series doc.
//
// Surfaced from the AgendaDetail hero when calendar_series.organizationId is
// null (the 11 series reconciled from non-meetings@ calendars where Tate's
// or Cedric's events don't carry the orgId extendedProperty). Without an
// org assignment, the MiniProjectBoard inside topic cards renders zero
// items even when categories are set, because the V1 items collection is
// org-scoped.

import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../firebase.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function OrgAssignDialog({ seriesId, currentOrgId, orgs, onClose }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleAssign = async (orgId) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "calendar_series", seriesId), {
        organizationId: orgId,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...(orgs || [])].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Assign organization
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: 12 }}>
          Click an organization to assign it to this series. Items on the
          embedded project board are scoped to this org.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8, mt: 1 }}>
          {sorted.map((o) => {
            const active = currentOrgId === o.id;
            return (
              <Chip
                key={o.id}
                label={o.name}
                size="small"
                onClick={() => handleAssign(o.id)}
                disabled={busy}
                sx={{
                  bgcolor: active ? (o.accentColor || "#b87333") : "#f5f3ee",
                  color: active ? "#fff" : "#3d3d5c",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  "&:hover": { opacity: 0.85 },
                }}
              />
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
