// Settings → Client SOPs (admin-only). View + edit each canonical category's
// SOP — the Tate-derived universal workflow + per-client deltas + contacts
// seeded from Switchboard. These feed AI Gen so it knows how the work gets
// done and who to contact per client. Same edit pattern as AI Integration:
// local draft per category, Save persists to categories/{id}.sop.
import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { orderBy } from "firebase/firestore";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCollection } from "../hooks/useCollection.js";
import { useAuth } from "../contexts/AuthContext.jsx";

function CategorySop({ category, uid }) {
  const [draft, setDraft] = useState(category.sop || "");
  const [busy, setBusy] = useState(false);
  // Reset the draft when the underlying doc changes (and we're not mid-edit
  // against a stale base) — mirrors AIIntegration's reset-on-source-change.
  useEffect(() => { setDraft(category.sop || ""); }, [category.id, category.sop]);

  const dirty = draft !== (category.sop || "");

  const save = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "categories", category.id), {
        sop: draft,
        updatedAt: serverTimestamp(),
        updatedByUid: uid || null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Accordion variant="outlined" disableGutters sx={{ "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: category.color || "#999", flexShrink: 0 }} />
          <Typography sx={{ fontWeight: 600 }}>{category.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {category.description}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          multiline
          minRows={10}
          maxRows={32}
          fullWidth
          disabled={busy}
          placeholder="SOP for this category — universal workflow, per-client deltas, who to contact…"
          InputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.5, alignItems: "flex-start" } }}
        />
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button variant="contained" size="small" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function ClientSops() {
  const { user } = useAuth();
  const constraints = useMemo(() => [orderBy("sortOrder", "asc")], []);
  const { data: categories } = useCollection("categories", constraints);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Client SOPs</Typography>
        <Typography variant="body2" color="text.secondary">
          How Vistamar runs each category of work — the universal workflow plus per-client specifics and who to
          contact. AI Gen reads these, so keeping them current sharpens what it proposes.
        </Typography>
      </Box>

      <Stack spacing={1}>
        {(categories || []).map((c) => (
          <CategorySop key={c.id} category={c} uid={user?.uid} />
        ))}
        {categories && categories.length === 0 && (
          <Typography variant="body2" color="text.secondary">No categories yet.</Typography>
        )}
      </Stack>

      <Chip label={`${categories?.length || 0} categories`} size="small" variant="outlined" sx={{ alignSelf: "flex-start" }} />
    </Stack>
  );
}
