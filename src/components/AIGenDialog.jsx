// AI Meeting Agenda generation dialog (Slice 3a). Admin-triggered from the
// agenda Overview. Flow: choose working/executive → snapshot current agenda
// (pre-ai-gen, so it's revertible) → resolve prompt + assemble mapped Fireflies
// transcripts → call Claude → review the proposal → Apply or Discard.
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { snapshotAgenda } from "../lib/agendaVersions.js";
import { composeAgendaHtml } from "../lib/agendaHtml.js";
import {
  resolvePrompt,
  assembleTranscripts,
  generateAgenda,
  applyProposal,
} from "../lib/aiAgenda.js";

export default function AIGenDialog({ agendaId, agenda, topics, orgSlug, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("choose"); // choose | working | review
  const [meetingStyle, setMeetingStyle] = useState("working");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);

  const previewHtml = useMemo(
    () => (proposal ? composeAgendaHtml(proposal, proposal.topics || []) : ""),
    [proposal],
  );

  const generate = async () => {
    setBusy(true);
    setError(null);
    setStep("working");
    try {
      // Snapshot first — the result is fully revertible from version history.
      await snapshotAgenda(agendaId, { source: "pre-ai-gen", uid: user?.uid || null });

      const prompt = await resolvePrompt(orgSlug);
      if (!prompt) {
        throw new Error("No Meeting Agenda Gen prompt is configured. Set one in Settings → AI Integration.");
      }
      const transcripts = await assembleTranscripts(agenda?.firefliesTitles);
      const payload = {
        prompt,
        meetingStyle,
        agenda: {
          title: agenda?.title || "",
          preBriefHtml: agenda?.preBriefHtml || "",
          openFloorHtml: agenda?.openFloorHtml || "",
          topics: (topics || []).map((t) => ({ name: t.name || "", bodyHtml: t.bodyHtml || "" })),
        },
        transcripts,
      };
      const result = await generateAgenda(payload);
      setProposal(result);
      setStep("review");
    } catch (err) {
      setError(err.message || "Generation failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyProposal(agendaId, proposal, user?.uid || null);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>Generate agenda with AI</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {step === "review" && proposal ? (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Proposed agenda — review before applying
            </Typography>
            <Box
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2,
                maxHeight: 440, overflow: "auto", fontSize: 13, lineHeight: 1.4,
                "& h2": { fontSize: 15, fontWeight: 700, mt: 2, mb: 0.5 },
                "& ul, & ol": { pl: 3, m: 0 }, "& li": { mb: 0.3 }, "& li p": { m: 0 },
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || "<em>Empty proposal</em>" }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              Applying replaces the Pre-Brief, topics, and Open Floor. The current agenda was saved to
              version history first — you can restore it from the history dialog.
            </Typography>
          </Box>
        ) : step === "working" ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              Reading recent meetings and drafting the next {meetingStyle} agenda…
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assistant reconciles this meeting's current agenda and its recent transcripts into a
              proposed next agenda. Pick the meeting style:
            </Typography>
            <ToggleButtonGroup
              value={meetingStyle}
              exclusive
              onChange={(_e, v) => v && setMeetingStyle(v)}
              size="small"
            >
              <ToggleButton value="working">Working</ToggleButton>
              <ToggleButton value="executive">Executive</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              {meetingStyle === "executive"
                ? "Executive: higher-level initiatives, decisions, approvals, progress — not day-to-day mechanics."
                : "Working: granular content/SEO/web deliverables and the next concrete step per item."}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {step === "review" ? "Discard" : "Cancel"}
        </Button>
        {step === "review" ? (
          <Button variant="contained" onClick={apply} disabled={busy}>
            {busy ? "Applying…" : "Apply"}
          </Button>
        ) : (
          <Button variant="contained" onClick={generate} disabled={busy}>
            Generate
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
