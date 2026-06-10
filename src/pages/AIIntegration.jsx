// Settings → AI Integration (admin-only). Authors + stores the prompts that
// drive AI features. Slice 1: the "Meeting Agenda Gen" prompt, with a Default
// that all orgs inherit and per-org overrides. No LLM here — storage + editing.
//
// Store: aiPrompts/default + aiPrompts/{orgSlug}. An org doc is created only on
// override; absence of its meetingAgendaGen field = inherits Default.
import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { getContrastText } from "../theme/pillColors.js";
import { useDoc } from "../hooks/useDoc.js";
import { useCollection } from "../hooks/useCollection.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// Starter prompt seeded into aiPrompts/default the first time it's saved, so
// there's real text to iterate. The true content gets refined in a later slice
// (see dev/Features/AI Prompt Management/prompts/refresh-agenda.v0.md).
const SEED_MEETING_AGENDA_GEN = `You generate the next Vistamar Consulting client meeting agenda, reconciling the current agenda with what's happened across the client since the meeting last occurred into a SHORT, concise agenda — never a multi-page document.

Meeting style: {{meetingStyle}}  (working | executive)
- executive: higher-level initiatives, decisions, approvals, and progress — not day-to-day mechanics.
- working: granular content/SEO/web deliverables and the next concrete step per item.

For each topic, give a clear title and a few tight bullets capturing what's on the table now. Lead with what's most decision-ready or time-sensitive, and drop a topic entirely if nothing is live on it. A human reviews every proposal before it's applied — never fabricate or assume facts the inputs don't support.`;

const VARIABLES_HINT = "Available variables: {{meetingStyle}} (working | executive). More are added as the engine defines its inputs.";

// Human-readable explanation of what the Meeting Agenda Gen engine actually
// does — the parts that live in the code (inputs, window, guardrails), NOT in
// the editable prompt below. Keep this in sync with src/lib/aiAgenda.js
// (assembleGenInputs) + api/ai/prepare.js (buildSystem). Organized by
// component so it's easy to refine: ask Claude Code to update a row when the
// engine changes.
const HOW_IT_WORKS = [
  {
    group: "What it reads",
    items: [
      ["Current agenda", "The meeting's existing topics and Open Floor — the starting point it moves forward."],
      ["Meeting transcripts", "Every Fireflies meeting since this meeting last occurred — this client's meetings plus internal Vistamar meetings (auto-detected by who attended). What was said."],
      ["Other client agendas", "The current content of the client's other meeting agendas, whatever stage they're in. What's planned across the org."],
      ["Project Board", "The client's tasks created or updated in the window — with status, on-hold, and brand-new flags. Task state."],
      ["Your note", "The optional “Additional context” you type when you click Generate (e.g. “these two articles are published”)."],
      ["Client SOPs", "Category descriptions guide topic categorization (fast, ~1 min). For deeper who-to-contact context in the agenda draft, tick “Include full Client SOPs” in the AI Gen modal (slower, ~2 min). AI-suggested tasks always use the full SOPs."],
    ],
  },
  {
    group: "What it categorizes",
    items: [
      ["Topic categories + tags", "Each generated topic gets the 1–3 most relevant categories + tags, so its Working-view mini-board surfaces the org's related tasks."],
      ["New tags", "The AI can coin a new specific tag when nothing fits — shown flagged “new” in the review so you approve it before it's added to the shared vocabulary."],
    ],
  },
  {
    group: "How it scopes & frames",
    items: [
      ["The window", "“Since this meeting last occurred” — anchored to the meeting's most recent past occurrence. Falls back to the last ~21 days if the meeting isn't mapped to Fireflies yet."],
      ["Meeting style", "Working vs Executive, set per meeting and remembered. Working = granular deliverables + next steps; Executive = higher-level initiatives, decisions, progress. Fills {{meetingStyle}} in the prompt."],
    ],
  },
  {
    group: "Guardrails (always on)",
    items: [
      ["Internal / client boundary", "Internal Vistamar meetings are for the assistant's awareness only — their mechanics and candor are never surfaced into a client-facing agenda. Vistamar always reads as strong and prepared."],
      ["Org coherence", "It won't duplicate or contradict what's already on the client's other agendas, and it surfaces cross-meeting dependencies."],
      ["No invoicing topics", "Topics whose primary purpose is invoicing, billing, or payment status are never created or retained on a client agenda — that belongs on the private Project Board."],
      ["Topic titles are frozen", "Existing topic titles are never renamed. The AI may only set a title on a brand-new topic; continuing topics keep their current title exactly."],
      ["Concise output", "A short, tight agenda — never a multi-page document."],
    ],
  },
  {
    group: "Bullet format (always on)",
    items: [
      ["Pattern", "Each bullet in a topic body follows: item text — Person, Status (M/D). The em-dash and what follows are only added when relevant — bare bullets are fine."],
      ["Person", "Owner name is included when ownership is non-obvious. Exception: content-social topics — owner name is always omitted there."],
      ["Status", "Included only when it meaningfully qualifies the item: canonical words (In Review, Blocked, Done) or content workflow phases (outline, draft, published, etc.)."],
      ["Date", "Only when a specific date was explicitly discussed in the meeting. Short M/D format in parens, always last."],
    ],
  },
  {
    group: "Safe to run",
    items: [
      ["Review before apply", "Nothing changes until you click Apply on the proposal. Applying saves the current agenda to version history first, so it's always revertible."],
      ["Admin-only", "The AI Gen button appears only for admins."],
    ],
  },
];

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

      {/* How it works — explains the under-the-hood engine (inputs, window,
          guardrails) that lives in code, not in the editable prompt below. */}
      <Accordion defaultExpanded variant="outlined" disableGutters sx={{ "&:before": { display: "none" }, borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>How Meeting Agenda Gen works</Typography>
            <Typography variant="caption" color="text.secondary">
              What's built into the system. The editable prompt below sets voice, priorities, and emphasis.
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Clicking <strong>AI Gen</strong> on a meeting agenda reconciles that meeting with everything happening
            across the client since it last occurred, then proposes a new agenda for you to review.
          </Typography>
          <Stack spacing={2}>
            {HOW_IT_WORKS.map((section) => (
              <Box key={section.group}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
                  {section.group}
                </Typography>
                <Divider sx={{ mb: 1, mt: 0.25 }} />
                <Stack spacing={1}>
                  {section.items.map(([label, desc]) => (
                    <Box key={label} sx={{ display: "flex", gap: 1.5, alignItems: "baseline" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 170, flexShrink: 0 }}>
                        {label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {desc}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, fontStyle: "italic" }}>
            To change any of the above (inputs, window, guardrails), ask Claude Code — they live in the codebase, not this prompt.
          </Typography>
        </AccordionDetails>
      </Accordion>

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
              sx={{ ...(scope === org.id && { bgcolor: org.accentColor || "primary.main", color: org.accentColor ? getContrastText(org.accentColor) : "#fff" }) }}
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
