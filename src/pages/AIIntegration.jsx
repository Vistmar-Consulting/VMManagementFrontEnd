// Settings → AI Integration (admin-only). Authors + stores the prompts that
// drive AI features. Slice 1: the "Meeting Agenda Gen" prompt, with a Default
// that all orgs inherit and per-org overrides. No LLM here — storage + editing.
//
// Store: aiPrompts/default + aiPrompts/{orgSlug}. An org doc is created only on
// override; absence of its meetingAgendaGen field = inherits Default.
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useDoc } from "../hooks/useDoc.js";
import { useCollection } from "../hooks/useCollection.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// Starter prompt seeded into aiPrompts/default the first time it's saved, so
// there's real text to iterate. The true content gets refined in a later slice
// (see dev/Features/AI Prompt Management/prompts/refresh-agenda.v0.md).
const SEED_MEETING_AGENDA_GEN = `You generate the next Vistamar Consulting client meeting agenda for an org, reconciling the prior agenda + recent meeting transcripts (incl. internal Vistamar meetings) into a SHORT, concise agenda — never a 5-page document.

Meeting style: {{meetingStyle}}  (working | executive)
- executive: higher-level initiatives, decisions, approvals, progress. NOT day-to-day mechanics.
- working: granular content/SEO/web deliverables + the next concrete step per item.

For each topic give a title + a few tight bullets (what's on the table now). Propose strategic categories/tags for the topic's mini project board (categories broad + rare; tags specific + frequent). Also propose Project Board task creates (status = AI Gen) and status moves. A human reviews everything; never fabricate; cite sources.`;

const VARIABLES_HINT = "Available variables: {{meetingStyle}} (working | executive). More are added as the engine defines its inputs.";

export default function AIIntegration() {
  const { user } = useAuth();
  const { data: orgs } = useCollection("organizations");

  // scope: "default" or an org slug (org.id)
  const [scope, setScope] = useState("default");
  const isDefault = scope === "default";

  const { data: defaultDoc, loading: defaultLoading } = useDoc("aiPrompts/default");
  const { data: orgDoc } = useDoc(isDefault ? null : `aiPrompts/${scope}`);

  const defaultPrompt = defaultDoc?.meetingAgendaGen?.prompt ?? "";
  const orgHasOverride = !isDefault && !!orgDoc?.meetingAgendaGen;
  const orgPrompt = orgDoc?.meetingAgendaGen?.prompt ?? "";

  // Seed the Default editor with the starter when the doc doesn't exist yet.
  const defaultMissing = !defaultLoading && defaultDoc === null;
  const editable = isDefault || orgHasOverride;
  const sourceText = isDefault
    ? (defaultPrompt || (defaultMissing ? SEED_MEETING_AGENDA_GEN : ""))
    : orgHasOverride
      ? orgPrompt
      : defaultPrompt; // inherited, read-only

  // Local draft. Reset only when the scope switches or the underlying source
  // (re)loads — typing changes `draft` only, so onSnapshot won't clobber edits.
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(sourceText); }, [scope, sourceText]);

  // Dirty when edited, OR when the Default doc doesn't exist yet (so the first
  // Save can persist the seed without requiring a throwaway edit first).
  const dirty = editable && (draft !== sourceText || (isDefault && defaultMissing));
  const [busy, setBusy] = useState(false);

  const stamp = useMemo(() => () => ({ updatedAt: serverTimestamp(), updatedByUid: user?.uid || null }), [user?.uid]);

  const save = async () => {
    setBusy(true);
    try {
      await setDoc(
        doc(db, "aiPrompts", scope),
        { meetingAgendaGen: { prompt: draft }, ...stamp() },
        { merge: true },
      );
    } finally {
      setBusy(false);
    }
  };

  const createOverride = async () => {
    setBusy(true);
    try {
      await setDoc(
        doc(db, "aiPrompts", scope),
        { meetingAgendaGen: { prompt: defaultPrompt }, ...stamp() },
        { merge: true },
      );
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = async () => {
    if (!window.confirm("Remove this org's override and go back to the Default prompt?")) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "aiPrompts", scope), { meetingAgendaGen: deleteField(), ...stamp() });
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = isDefault ? "Default" : (orgs || []).find((o) => o.id === scope)?.name || scope;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>AI Integration</Typography>
        <Typography variant="body2" color="text.secondary">
          Author the prompts that drive AI features. The <strong>Default</strong> applies to every org; pick an org to override it.
        </Typography>
      </Box>

      {/* Scope pills — Default first + default-selected, then one per org */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }} useFlexGap>
        <Chip
          label="Default"
          onClick={() => setScope("default")}
          variant={isDefault ? "filled" : "outlined"}
          color={isDefault ? "primary" : "default"}
          size="small"
        />
        {[...(orgs || [])]
          .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
          .map((org) => (
            <Chip
              key={org.id}
              label={org.name}
              onClick={() => setScope(org.id)}
              variant={scope === org.id ? "filled" : "outlined"}
              size="small"
              sx={{ ...(scope === org.id && { bgcolor: org.accentColor || "primary.main", color: "#fff" }) }}
            />
          ))}
      </Stack>

      {/* Meeting Agenda Gen card */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>Meeting Agenda Gen</Typography>
          <Typography variant="caption" color="text.secondary">
            {isDefault ? "Default" : orgHasOverride ? `${scopeLabel} — override` : `${scopeLabel} — inheriting Default`}
          </Typography>
        </Stack>

        {!isDefault && !orgHasOverride && (
          <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
            This org inherits the Default prompt. Create an override to customize it.
          </Alert>
        )}

        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          multiline
          minRows={12}
          fullWidth
          disabled={!editable || busy}
          placeholder="Prompt text…"
          InputProps={{ sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.5, alignItems: "flex-start" } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          {VARIABLES_HINT}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {editable && (
            <Button variant="contained" size="small" disabled={!dirty || busy} onClick={save}>
              Save
            </Button>
          )}
          {!isDefault && !orgHasOverride && (
            <Button variant="contained" size="small" disabled={busy} onClick={createOverride}>
              Create override
            </Button>
          )}
          {!isDefault && orgHasOverride && (
            <Button variant="outlined" size="small" color="error" disabled={busy} onClick={resetToDefault}>
              Reset to Default
            </Button>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
