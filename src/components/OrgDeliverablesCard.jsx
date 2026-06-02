import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";

import { db } from "../firebase.js";
import { deliverablesSummary } from "../lib/orgMembers.js";

const CADENCES = ["week", "month", "quarter"];

const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "#6b6b8a",
};

function blankRow() {
  return { label: "", quantity: "", cadence: "month", note: "" };
}

function seedRows(deliverables) {
  if (!Array.isArray(deliverables) || deliverables.length === 0) return [blankRow()];
  return deliverables.map((d) => ({
    label: d.label || "",
    quantity: d.quantity != null ? String(d.quantity) : "",
    cadence: d.cadence || "month",
    note: d.note || "",
  }));
}

export default function OrgDeliverablesCard({ org }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([blankRow()]);
  const [orgNote, setOrgNote] = useState("");
  const [saving, setSaving] = useState(false);

  const activeDeliverables = Array.isArray(org.deliverables)
    ? org.deliverables.filter((d) => d && Number(d.quantity) > 0)
    : [];
  const hasContent = activeDeliverables.length > 0 || org.deliverablesNote?.trim();

  const handleOpen = () => {
    setRows(seedRows(org.deliverables));
    setOrgNote(org.deliverablesNote || "");
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const updateRow = (idx, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, blankRow()]);

  const removeRow = (idx) => {
    setRows((prev) => (prev.length === 1 ? [blankRow()] : prev.filter((_, i) => i !== idx)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const deliverables = rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label.trim(),
          quantity: Number(r.quantity) || 0,
          cadence: r.cadence || "month",
          ...(r.note?.trim() ? { note: r.note.trim() } : {}),
        }));
      await updateDoc(doc(db, "organizations", org.id), {
        deliverables,
        deliverablesNote: orgNote.trim(),
        updatedAt: serverTimestamp(),
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          {/* Header row */}
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", mb: 1 }}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
                Content Deliverables
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.4 }}>
                {deliverablesSummary(org.deliverables)}
              </Typography>
            </Box>
            <Button size="small" onClick={handleOpen} sx={{ mt: 0.25, flexShrink: 0 }}>
              Edit
            </Button>
          </Box>

          <Divider sx={{ mb: 1.5 }} />

          {/* Read rows */}
          {!hasContent ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
              No deliverables set — Edit to add.
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {activeDeliverables.map((d, idx) => (
                <Box key={idx} sx={{ display: "flex", gap: 2 }}>
                  <Typography sx={{ ...sectionLabel, pt: 0.1, minWidth: 110 }}>
                    {d.label}
                  </Typography>
                  <Box>
                    <Typography sx={{ fontSize: 13 }}>
                      {d.quantity} / {d.cadence}
                    </Typography>
                    {d.note && (
                      <Typography variant="caption" color="text.secondary">
                        {d.note}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}

              {org.deliverablesNote?.trim() && (
                <Box sx={{ display: "flex", gap: 2 }}>
                  <Typography sx={{ ...sectionLabel, pt: 0.1, minWidth: 110 }}>
                    Note
                  </Typography>
                  <Typography sx={{ fontSize: 13 }}>{org.deliverablesNote.trim()}</Typography>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Content Deliverables</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {rows.map((row, idx) => (
              <Box
                key={idx}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 110px auto",
                  gap: 1,
                  alignItems: "flex-start",
                }}
              >
                <TextField
                  size="small"
                  label="Label"
                  value={row.label}
                  onChange={(e) => updateRow(idx, "label", e.target.value)}
                />
                <TextField
                  size="small"
                  label="Qty"
                  type="number"
                  inputProps={{ min: 0 }}
                  value={row.quantity}
                  onChange={(e) => updateRow(idx, "quantity", e.target.value)}
                />
                <Select
                  size="small"
                  value={row.cadence}
                  onChange={(e) => updateRow(idx, "cadence", e.target.value)}
                  displayEmpty
                >
                  {CADENCES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
                <IconButton
                  size="small"
                  onClick={() => removeRow(idx)}
                  aria-label="Remove row"
                  sx={{ mt: 0.5 }}
                >
                  <Close sx={{ fontSize: 16 }} />
                </IconButton>

                {/* Note field spans full width on next row */}
                <TextField
                  size="small"
                  label="Note (optional)"
                  value={row.note}
                  onChange={(e) => updateRow(idx, "note", e.target.value)}
                  sx={{ gridColumn: "1 / -1" }}
                />
              </Box>
            ))}

            <Button size="small" variant="outlined" onClick={addRow} sx={{ alignSelf: "flex-start" }}>
              + Add row
            </Button>

            <Divider />

            <TextField
              size="small"
              label="Org note"
              multiline
              minRows={2}
              value={orgNote}
              onChange={(e) => setOrgNote(e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
