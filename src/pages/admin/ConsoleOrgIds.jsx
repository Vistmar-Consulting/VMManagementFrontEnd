// V2.1.1 — admin tool for setting the consoleOrgId field on each org doc.
// The numeric Console-era org IDs are how meetings@'s Graph events carry
// org attribution via extendedProperties.private.orgId. The reconciliation
// worker (src/lib/reconcileMeetings.js) resolves Graph numeric ↔ Management
// slug via this field.
//
// Known values are pre-populated from Console SQL (admin.Organizations).
// "Apply known values" is a one-click bulk-write of every row whose current
// consoleOrgId differs from the known value. The per-row input lets an admin
// override or fix later additions (e.g., a new client org).

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { db } from "../../firebase.js";
import { useCollection } from "../../hooks/useCollection.js";
import { useAuth } from "../../contexts/AuthContext.jsx";

// Source of truth: Console SQL admin.Organizations table.
// vistamar is a Management-internal convention (not in admin.Organizations)
// — meetings@ stamps `orgId=-1` on internal meeting events.
const KNOWN = {
  vistamar: -1,
  unio: 2,
  "bryn-mawr": 3,
  "golden-vision": 5,
  "id-care": 15,
};

export default function ConsoleOrgIds() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { data: orgs, loading: orgsLoading } = useCollection("organizations");
  const [overrides, setOverrides] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    return [...(orgs || [])]
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
      .map((o) => {
        const known = KNOWN[o.id];
        const current = o.consoleOrgId;
        const override = overrides[o.id];
        const effectiveValue = override !== undefined ? override : current;
        const needsApply = known !== undefined && known !== current;
        return { ...o, known, current, override, effectiveValue, needsApply };
      });
  }, [orgs, overrides]);

  const drift = rows.filter((r) => r.needsApply);

  const applyKnown = async () => {
    if (drift.length === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      await Promise.all(
        drift.map((r) =>
          updateDoc(doc(db, "organizations", r.id), {
            consoleOrgId: r.known,
            updatedAt: serverTimestamp(),
            updatedByUid: user?.uid || null,
          })
        )
      );
      setStatus({ kind: "success", msg: `Updated ${drift.length} org${drift.length === 1 ? "" : "s"}.` });
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setBusy(false);
    }
  };

  const writeOne = async (orgId) => {
    const raw = overrides[orgId];
    if (raw === undefined || raw === "") return;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      setStatus({ kind: "error", msg: `Value for ${orgId} is not a number` });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await updateDoc(doc(db, "organizations", orgId), {
        consoleOrgId: num,
        updatedAt: serverTimestamp(),
        updatedByUid: user?.uid || null,
      });
      setOverrides((o) => {
        const next = { ...o };
        delete next[orgId];
        return next;
      });
      setStatus({ kind: "success", msg: `Updated ${orgId}.` });
    } catch (err) {
      setStatus({ kind: "error", msg: err.message });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || orgsLoading) {
    return <Typography sx={{ p: 4 }}>Loading…</Typography>;
  }

  if (!isAdmin) {
    return <Typography sx={{ p: 4 }}>Admin only.</Typography>;
  }

  return (
    <Box sx={{ p: 4, maxWidth: 800 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>Console org ID mapping</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Maps Management slug org IDs to Console SQL <code>admin.Organizations.Id</code> numbers.
        Used by the meetings reconciliation worker to resolve Graph events' numeric
        <code> extendedProperties.private.orgId</code> back to a Management slug.
      </Typography>

      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {rows.map((r) => (
          <Box
            key={r.id}
            sx={{
              display: "grid",
              gridTemplateColumns: "180px 1fr 100px 80px 80px",
              alignItems: "center",
              gap: 2,
              p: 1.5,
              border: "1px solid",
              borderColor: r.needsApply ? "warning.main" : "divider",
              borderRadius: 1,
              bgcolor: r.needsApply ? "warning.50" : "transparent",
            }}
          >
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
              <Typography variant="caption" color="text.secondary">{r.id}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Current</Typography>
              <Typography variant="body2">{r.current == null ? "—" : r.current}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Known</Typography>
              <Typography variant="body2">{r.known == null ? "—" : r.known}</Typography>
            </Box>
            <TextField
              size="small"
              type="number"
              placeholder="set…"
              value={r.override ?? ""}
              onChange={(e) => setOverrides((o) => ({ ...o, [r.id]: e.target.value }))}
              sx={{ width: 80 }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={() => writeOne(r.id)}
              disabled={busy || r.override === undefined || r.override === ""}
            >
              Save
            </Button>
          </Box>
        ))}
      </Stack>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button
          variant="contained"
          onClick={applyKnown}
          disabled={busy || drift.length === 0}
        >
          {drift.length === 0 ? "All known values applied" : `Apply known values (${drift.length})`}
        </Button>
        {busy && <Typography variant="caption" color="text.secondary">Writing…</Typography>}
      </Stack>

      {status && (
        <Alert severity={status.kind === "success" ? "success" : "error"} sx={{ mt: 2 }}>
          {status.msg}
        </Alert>
      )}
    </Box>
  );
}
