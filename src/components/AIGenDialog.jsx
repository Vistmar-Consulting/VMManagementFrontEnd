// AI Meeting Agenda generation dialog (Slice 3a + 3a.2). Admin-triggered from
// the agenda Overview. Flow: choose working/executive (defaults to the meeting's
// saved style) + optional extra context → snapshot current agenda (pre-ai-gen,
// revertible) → assemble inputs (windowed org + Vistamar transcripts + Project
// Board activity) → call Claude → review the proposal → Apply or Discard.
import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { snapshotAgenda } from "../lib/agendaVersions.js";
import { composeAgendaHtml } from "../lib/agendaHtml.js";
import {
  resolvePrompt,
  assembleGenInputs,
  generateAgenda,
  applyProposal,
  setAgendaStyle,
} from "../lib/aiAgenda.js";

// One-line summary of what fed the model — so the user always sees the actual
// input set (no silent caps / dropped data).
function summaryText(s) {
  if (!s) return "";
  const since = s.usedFallbackWindow
    ? "in the last 21 days"
    : s.windowStart
      ? `since ${new Date(s.windowStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : "recently";
  const meetings = s.orgCount + s.internalCount;
  const parts = [`Read ${meetings} meeting${meetings === 1 ? "" : "s"} ${since} — ${s.orgCount} client, ${s.internalCount} Vistamar internal`];
  if (s.orgAgendaCount) parts.push(`${s.orgAgendaCount} other client agenda${s.orgAgendaCount === 1 ? "" : "s"}`);
  if (s.projectCount) parts.push(`${s.projectCount} Project Board update${s.projectCount === 1 ? "" : "s"} (${s.projectNewCount} new)`);
  const notes = [];
  if (s.failedCount) notes.push(`couldn't load ${s.failedCount} transcript${s.failedCount === 1 ? "" : "s"}`);
  if (s.droppedTranscripts) notes.push(`${s.droppedTranscripts} older meeting(s) not included`);
  if (s.droppedItems) notes.push(`${s.droppedItems} older board item(s) not included`);
  let txt = parts.join(" · ");
  if (notes.length) txt += ` — ${notes.join("; ")}`;
  return txt;
}

export default function AIGenDialog({ agendaId, agenda, topics, items, orgSlug, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("choose"); // choose | working | review
  const [meetingStyle, setMeetingStyle] = useState(agenda?.meetingStyle === "executive" ? "executive" : "working");
  const [extraContext, setExtraContext] = useState("");
  const [includeSops, setIncludeSops] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [summary, setSummary] = useState(null);
  const [existingTags, setExistingTags] = useState(new Set());

  const previewHtml = useMemo(
    () => (proposal ? composeAgendaHtml(proposal, proposal.topics || []) : ""),
    [proposal],
  );
  const lastGen = agenda?.lastAgendaGenAt?.toDate ? agenda.lastAgendaGenAt.toDate() : null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    setStep("working");
    try {
      // Snapshot first — the result is fully revertible from version history.
      await snapshotAgenda(agendaId, { source: "pre-ai-gen", uid: user?.uid || null });
      // Persist the chosen style so it's inherited next time.
      if (meetingStyle !== agenda?.meetingStyle) {
        await setAgendaStyle(agendaId, meetingStyle, user?.uid || null);
      }

      const prompt = await resolvePrompt(orgSlug);
      if (!prompt) {
        throw new Error("No Meeting Agenda Gen prompt is configured. Set one in Settings → AI Integration.");
      }
      const { transcripts, projectBoard, orgAgendas, categories, tagVocab, summary: sum } = await assembleGenInputs(agenda, items, orgSlug);
      setSummary(sum);
      setExistingTags(new Set((tagVocab || []).map((t) => (t.name || "").toLowerCase())));

      const result = await generateAgenda({
        prompt,
        meetingStyle,
        agenda: {
          title: agenda?.title || "",
          preBriefHtml: agenda?.preBriefHtml || "",
          openFloorHtml: agenda?.openFloorHtml || "",
          topics: (topics || []).map((t) => ({ name: t.name || "", bodyHtml: t.bodyHtml || "" })),
        },
        transcripts,
        projectBoard,
        orgAgendas,
        // Default: category name + description (fast, ~1 min). The "Include
        // full SOPs" toggle sends the full SOP bodies for deeper context at
        // the cost of a slower (~2 min) generation.
        categories: includeSops
          ? categories
          : (categories || []).map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
        tagVocab,
        extraContext: extraContext.trim() || undefined,
      });
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
      await applyProposal(agendaId, proposal, user?.uid || null, { style: meetingStyle });
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
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Proposed agenda — review before applying
            </Typography>
            {summary && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                {summaryText(summary)}
              </Typography>
            )}
            <Box
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2,
                maxHeight: 420, overflow: "auto", fontSize: 13, lineHeight: 1.4,
                "& h2": { fontSize: 15, fontWeight: 700, mt: 2, mb: 0.5 },
                "& ul, & ol": { pl: 3, m: 0 }, "& li": { mb: 0.3 }, "& li p": { m: 0 },
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || "<em>Empty proposal</em>" }}
            />
            {(proposal.topics || []).some((t) => (t.categories?.length || t.tags?.length)) && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Topic categorization <Typography component="span" variant="caption" color="text.secondary">(drives each topic's mini-board; “new” tags get created on Apply)</Typography>
                </Typography>
                <Stack spacing={1.25}>
                  {(proposal.topics || []).map((t, i) => (
                    <Box key={i}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }} useFlexGap>
                        {(t.categories || []).map((c) => (
                          <Chip key={`c-${c}`} label={c} size="small" color="primary" variant="outlined" />
                        ))}
                        {(t.tags || []).map((tag) => {
                          const isNew = !existingTags.has(String(tag).toLowerCase());
                          return (
                            <Chip
                              key={`t-${tag}`}
                              label={isNew ? `${tag} · new` : tag}
                              size="small"
                              color={isNew ? "secondary" : "default"}
                              variant={isNew ? "filled" : "outlined"}
                            />
                          );
                        })}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
              Applying replaces the Pre-Brief, topics, and Open Floor. The current agenda was saved to
              version history first — you can restore it from the history dialog.
            </Typography>
          </Box>
        ) : step === "working" ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" align="center">
              {summary
                ? `${summaryText(summary)} — drafting the next ${meetingStyle} agenda…`
                : `Reading recent meetings + Project Board, drafting the next ${meetingStyle} agenda…`}
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Typography
              variant="caption"
              sx={{ display: "block", mb: 1.5, color: lastGen ? "text.secondary" : "warning.main" }}
            >
              {lastGen
                ? `Last AI-generated ${format(lastGen, "MMM d, yyyy · h:mm a")} (${formatDistanceToNow(lastGen, { addSuffix: true })}) — this run reconciles everything since then.`
                : "Not yet AI-generated — this first run reconciles since the last meeting."}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assistant reconciles this meeting's agenda with everything since it last occurred — this
              client's meetings, internal Vistamar meetings, and recent Project Board activity. Pick the
              meeting style:
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
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, mb: 2 }}>
              {meetingStyle === "executive"
                ? "Executive: higher-level initiatives, decisions, approvals, progress — not day-to-day mechanics."
                : "Working: granular content/SEO/web deliverables and the next concrete step per item."}
              {" "}Saved as this meeting's default for next time.
            </Typography>
            <TextField
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              label="Additional context (optional)"
              placeholder="e.g. We published the CyberKnife and Open-Access articles — they're done. Skip the photo-shoot topic this week."
              multiline
              minRows={3}
              fullWidth
              disabled={busy}
            />
            <FormControlLabel
              sx={{ mt: 1, display: "block" }}
              control={<Checkbox size="small" checked={includeSops} onChange={(e) => setIncludeSops(e.target.checked)} disabled={busy} />}
              label={
                <Typography variant="caption" color="text.secondary">
                  Include full Client SOPs (deeper who-to-contact context — slower, ~2 min vs ~1)
                </Typography>
              }
            />
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
