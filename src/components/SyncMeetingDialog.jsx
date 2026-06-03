// Sync Meeting dialog. ONE AI pass produces a meeting agenda AND the project-board
// changes (creates / moves / notes); the user reviews both together and applies
// them in a single transaction.
//
// Flow: choose working/executive + optional context → snapshot agenda
// (pre-ai-gen, revertible) → assembleGenInputs → prepareMeeting → review
// (agenda + Refine + board changes with inline promote) → applyUnified.
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
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
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
  prepareMeeting,
  refineProposal,
  applyUnified,
  setAgendaStyle,
} from "../lib/aiAgenda.js";
import { validateProposal, normalizeTopicRefs, classifyTopicChanges } from "../lib/syncMeeting.js";
import { useOthers } from "../lib/liveblocks.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { STATUS_MAP } from "../lib/itemStatusMap.js";

// Inline-promotion status choices for a new (AI Gen) create. Leaving this unset
// keeps the create at statusId 8 (triage). Restricted to the moveable
// lifecycle statuses (Assigned / In Progress / Review / Pending).
const PROMOTE_STATUSES = STATUS_OPTIONS.filter((s) => Object.prototype.hasOwnProperty.call(STATUS_MAP, s.name));

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

export default function SyncMeetingDialog({
  agendaId,
  agenda,
  topics,
  items,
  orgSlug,
  master = false,
  users,
  categories: _categories,
  tags: _tags,
  onClose,
}) {
  const { user } = useAuth();
  const [step, setStep] = useState("choose"); // choose | working | review
  const others = useOthers(); // live collaborators in this agenda's room (presence-aware apply warning)
  const [meetingStyle, setMeetingStyle] = useState(agenda?.meetingStyle === "executive" ? "executive" : "working");
  const [extraContext, setExtraContext] = useState("");
  const [includeSops, setIncludeSops] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [summary, setSummary] = useState(null);
  const [existingTags, setExistingTags] = useState(() => new Set());
  const [existingTasks, setExistingTasks] = useState([]);
  // Validation result recomputed on receipt + after each refine.
  const [validation, setValidation] = useState(null);
  // Refine loop (review step).
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [catCtx, setCatCtx] = useState({ categories: [], tagVocab: [], orgMeta: [] });
  // Board-change review selections (indexes into proposal.boardChanges.*).
  const [selCreates, setSelCreates] = useState(() => new Set());
  const [selMoves, setSelMoves] = useState(() => new Set());
  const [selNotes, setSelNotes] = useState(() => new Set());
  // Inline promotions per create index: { [idx]: { statusId, assigneeIds } }.
  const [promotions, setPromotions] = useState({});

  const previewHtml = useMemo(
    () => (proposal ? composeAgendaHtml(proposal, proposal.topics || []) : ""),
    [proposal],
  );
  const lastGen = agenda?.lastUnifiedGenAt?.toDate ? agenda.lastUnifiedGenAt.toDate() : null;

  const itemsById = useMemo(() => new Map((items || []).map((it) => [it.id, it])), [items]);
  const topicNameById = useMemo(
    () => new Map((proposal?.topics || []).map((t) => [t.topicId, t.name])),
    [proposal],
  );

  // Indexes of VALID (accepted) creates — anything validateProposal rejected is
  // excluded here and never selectable. Compared by object identity against the
  // accepted-creates list.
  const validCreateIdxs = useMemo(() => {
    if (!proposal || !validation) return new Set();
    const accepted = new Set(validation.acceptedCreates);
    const creates = proposal.boardChanges?.creates || [];
    const out = new Set();
    creates.forEach((c, i) => { if (accepted.has(c)) out.add(i); });
    return out;
  }, [proposal, validation]);

  const statusName = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "";

  // Recompute validation; reset the board-change selections to "all valid
  // checked" and clear stale promotions. Used on receipt and after each refine.
  const applyValidation = (prop, tasks) => {
    const v = validateProposal({
      topics: prop.topics,
      boardChanges: prop.boardChanges,
      existingTasks: tasks,
    });
    setValidation(v);
    const accepted = new Set(v.acceptedCreates);
    const creates = prop.boardChanges?.creates || [];
    const moves = prop.boardChanges?.moves || [];
    const notes = prop.boardChanges?.notes || [];
    const nextCreates = new Set();
    creates.forEach((c, i) => { if (accepted.has(c)) nextCreates.add(i); });
    const acceptedMoveSet = new Set(v.acceptedMoves);
    const acceptedNoteSet = new Set(v.acceptedNotes);
    const nextMoves = new Set();
    moves.forEach((m, i) => { if (acceptedMoveSet.has(m)) nextMoves.add(i); });
    const nextNotes = new Set();
    notes.forEach((n, i) => { if (acceptedNoteSet.has(n)) nextNotes.add(i); });
    setSelCreates(nextCreates);
    setSelMoves(nextMoves);
    setSelNotes(nextNotes);
    setPromotions({});
    return v;
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    setStep("working");
    try {
      await snapshotAgenda(agendaId, { source: "pre-ai-gen", uid: user?.uid || null });
      if (meetingStyle !== agenda?.meetingStyle) {
        await setAgendaStyle(agendaId, meetingStyle, user?.uid || null);
      }

      const prompt = await resolvePrompt(orgSlug, { master });
      if (!prompt) {
        throw new Error("No Meeting Agenda Gen prompt is configured. Set one in Settings → AI Integration.");
      }
      const inputs = await assembleGenInputs(agenda, items, orgSlug, { master });
      const {
        transcripts, projectBoard, existingTasks: tasks, orgAgendas,
        categories, tagVocab, internal, orgMeta, summary: sum,
      } = inputs;
      setSummary(sum);
      setExistingTasks(tasks || []);
      setExistingTags(new Set((tagVocab || []).map((t) => (t.name || "").toLowerCase())));
      setCatCtx({
        categories: (categories || []).map((c) => ({ slug: c.slug, name: c.name })),
        tagVocab,
        orgMeta,
      });

      const result = await prepareMeeting({
        prompt,
        meetingStyle,
        agenda: {
          title: agenda?.title || "",
          preBriefHtml: agenda?.preBriefHtml || "",
          openFloorHtml: agenda?.openFloorHtml || "",
          topics: (topics || []).map((t) => ({ id: t.id, name: t.name || "", bodyHtml: t.bodyHtml || "" })),
        },
        transcripts,
        projectBoard,
        existingTasks: tasks,
        orgAgendas,
        categories: includeSops
          ? categories
          : (categories || []).map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
        tagVocab,
        internal,
        master,
        orgMeta,
        extraContext: extraContext.trim() || undefined,
      });
      const currentTopicIds = (topics || []).map((t) => t.id);
      const normalized = { ...result, topics: normalizeTopicRefs(result.topics, currentTopicIds) };
      setProposal(normalized);
      applyValidation(normalized, tasks || []);
      setStep("review");
    } catch (err) {
      setError(err.message || "Generation failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  };

  const refine = async () => {
    const instruction = refineText.trim();
    if (!instruction || !proposal) return;
    setRefining(true);
    setError(null);
    try {
      const result = await refineProposal({
        proposal,
        instruction,
        categories: catCtx.categories,
        tagVocab: catCtx.tagVocab,
        master,
        orgMeta: catCtx.orgMeta,
      });
      // Refine returns refreshed agenda content (topics/preBrief/openFloor). It
      // does NOT touch the board changes, so carry those forward unchanged.
      const currentTopicIds = (topics || []).map((t) => t.id);
      const merged = {
        ...result,
        topics: normalizeTopicRefs(result.topics, currentTopicIds),
        boardChanges: proposal.boardChanges,
      };
      setProposal(merged);
      setExistingTags(new Set((catCtx.tagVocab || []).map((t) => (t.name || "").toLowerCase())));
      // A refine can orphan a create whose owning topic was deleted → re-run
      // validation against the merged proposal so the banner + selectable set
      // stay correct.
      applyValidation(merged, existingTasks);
      setRefineText("");
    } catch (err) {
      setError(err.message || "Refine failed");
    } finally {
      setRefining(false);
    }
  };

  const toggle = (setFn, guard) => (i) => setFn((prev) => {
    if (guard && !guard(i)) return prev;
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const setPromoStatus = (idx, statusId) => setPromotions((prev) => {
    const next = { ...prev };
    const cur = next[idx] || {};
    if (statusId === "") {
      const { statusId: _drop, ...rest } = cur;
      if (Object.keys(rest).length) next[idx] = rest; else delete next[idx];
    } else {
      next[idx] = { ...cur, statusId };
    }
    return next;
  });

  const setPromoAssignees = (idx, assigneeIds) => setPromotions((prev) => {
    const next = { ...prev };
    const cur = next[idx] || {};
    if (!assigneeIds.length) {
      const { assigneeIds: _drop, ...rest } = cur;
      if (Object.keys(rest).length) next[idx] = rest; else delete next[idx];
    } else {
      next[idx] = { ...cur, assigneeIds };
    }
    return next;
  });

  const apply = async () => {
    // Presence-aware guard: applyUnified replaces ALL topics. If others are live
    // in this agenda right now, confirm before blowing away what they're editing.
    if (others.length > 0) {
      const ok = window.confirm(
        `${others.length} other ${others.length === 1 ? "person is" : "people are"} editing this agenda right now. Applying Sync Meeting replaces all topics. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      // Only checked + valid creates are accepted (rejected creates are never
      // selectable, but intersect defensively against the valid set).
      const createIdxs = [...selCreates].filter((i) => validCreateIdxs.has(i));
      const moveIdxs = [...selMoves];
      const noteIdxs = [...selNotes];
      // Keep only promotions for accepted creates.
      const promo = {};
      createIdxs.forEach((i) => { if (promotions[i]) promo[i] = promotions[i]; });

      const accepted = {
        createIdxs,
        moveIdxs,
        noteIdxs,
        promotions: promo,
        existingTasks, // threaded through for applyUnified's at-apply re-validation
      };
      await applyUnified(agendaId, orgSlug, proposal, accepted, user?.uid || null, { master });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply");
      setBusy(false);
    }
  };

  const creates = proposal?.boardChanges?.creates || [];
  const moves = proposal?.boardChanges?.moves || [];
  const notes = proposal?.boardChanges?.notes || [];
  const rejectedCreates = validation?.rejectedCreates || [];
  const droppedMoves = validation?.droppedMoves || [];
  const droppedNotes = validation?.droppedNotes || [];
  const hasRejections = !!validation?.hasRejections;
  const totalBoardChanges = creates.length + moves.length + notes.length;

  return (
    <Dialog
      open
      onClose={(_e, reason) => {
        // Never dismiss on backdrop click or Escape — a stray click would throw
        // away an expensive (paid, ~80s) generated proposal and force a re-run.
        // The dialog closes only via the explicit Discard / Cancel / Apply
        // actions (which call onClose directly).
        if (reason === "backdropClick" || reason === "escapeKeyDown") return;
        onClose();
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>Sync meeting with AI</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {step === "review" && proposal ? (
          <Box>
            {/* Refine — edit the proposed draft with an instruction (no data
                sources). Sits above the proposal per design. */}
            <Box sx={{ mb: 2, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                Refine this draft with AI
              </Typography>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  multiline
                  minRows={5}
                  maxRows={5}
                  fullWidth
                  size="small"
                  placeholder="Tell the AI how to refine this draft — e.g. “Add these two blogs: …”, “Drop the GBP topic”, “Tighten the Unio section.” Only the agenda draft is edited; no other data is pulled in."
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  disabled={refining}
                />
                <Button
                  variant="contained"
                  onClick={refine}
                  disabled={refining || !refineText.trim()}
                  sx={{ minWidth: 96, alignSelf: "stretch" }}
                >
                  {refining ? <CircularProgress size={18} color="inherit" /> : "Refine"}
                </Button>
              </Stack>
            </Box>

            {/* Warning banner — anything validation rejected/dropped. Rejected
                creates are listed here and are NOT selectable below. */}
            {hasRejections && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Some proposed changes can't be applied and were dropped:
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {rejectedCreates.map((c, i) => (
                    <li key={`rc-${i}`}>
                      <Typography variant="caption">
                        New task <strong>{c.title || c.topicId}</strong> — {c.reason}
                      </Typography>
                    </li>
                  ))}
                  {droppedMoves.map((m, i) => (
                    <li key={`dm-${i}`}>
                      <Typography variant="caption">
                        Status update <strong>{m.title || m.itemId}</strong> — {m.reason}
                      </Typography>
                    </li>
                  ))}
                  {droppedNotes.map((n, i) => (
                    <li key={`dn-${i}`}>
                      <Typography variant="caption">
                        Note on <strong>{n.title || n.itemId}</strong> — {n.reason}
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Proposed agenda — review before applying
            </Typography>
            {summary && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                {summaryText(summary)}
              </Typography>
            )}
            {(() => {
              const { statuses, dropped } = classifyTopicChanges(topics, proposal.topics || []);
              return (
                <Box sx={{ mb: 1.5 }}>
                  <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: dropped.length ? 0.75 : 0 }}>
                    {(proposal.topics || []).map((tp, i) => (
                      <Chip
                        key={i}
                        size="small"
                        label={`${tp.name || "(untitled)"} · ${statuses[i] === "retained" ? "Retained" : "New"}`}
                        color={statuses[i] === "retained" ? "default" : "primary"}
                        variant={statuses[i] === "retained" ? "outlined" : "filled"}
                      />
                    ))}
                  </Stack>
                  {dropped.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Dropped: {dropped.map((d) => d.name).join(", ")}
                    </Typography>
                  )}
                </Box>
              );
            })()}
            <Box
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2,
                maxHeight: 360, overflow: "auto", fontSize: 13, lineHeight: 1.4,
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

            {/* Board changes — three reviewable groups. */}
            <Divider sx={{ my: 2.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Project Board changes
            </Typography>
            {totalBoardChanges === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No board changes proposed beyond what's already tracked.
              </Typography>
            ) : null}

            {creates.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>New tasks → AI Gen</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {creates.map((c, i) => {
                  if (!validCreateIdxs.has(i)) return null; // rejected → shown in banner only
                  const promo = promotions[i] || {};
                  const topicName = topicNameById.get(c.topicId) || "—";
                  return (
                    <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                      <Checkbox
                        size="small"
                        checked={selCreates.has(i)}
                        onChange={() => toggle(setSelCreates, (idx) => validCreateIdxs.has(idx))(i)}
                        sx={{ mt: -0.5 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.title}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          Topic: {topicName}
                        </Typography>
                        {c.note && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>{c.note}</Typography>}
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                          <FormControl size="small" sx={{ minWidth: 140 }}>
                            <InputLabel id={`status-${i}`}>Status</InputLabel>
                            <Select
                              labelId={`status-${i}`}
                              label="Status"
                              value={promo.statusId ?? ""}
                              onChange={(e) => setPromoStatus(i, e.target.value)}
                              disabled={!selCreates.has(i)}
                            >
                              <MenuItem value=""><em>Triage (AI Gen)</em></MenuItem>
                              {PROMOTE_STATUSES.map((s) => (
                                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
                            <InputLabel id={`assignee-${i}`}>Assignee</InputLabel>
                            <Select
                              labelId={`assignee-${i}`}
                              label="Assignee"
                              multiple
                              value={promo.assigneeIds || []}
                              onChange={(e) => setPromoAssignees(i, e.target.value)}
                              disabled={!selCreates.has(i)}
                              renderValue={(sel) =>
                                sel
                                  .map((uid) => (users || []).find((u) => u.id === uid))
                                  .filter(Boolean)
                                  .map((u) => u.displayName || u.email)
                                  .join(", ")
                              }
                            >
                              {(users || []).map((u) => (
                                <MenuItem key={u.id} value={u.id}>{u.displayName || u.email}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Stack>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            {moves.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Status updates (existing tasks)</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {moves.map((m, i) => {
                  const dropped = droppedMoves.includes(m);
                  if (dropped) return null; // shown in banner only
                  const cur = statusName(itemsById.get(m.itemId)?.statusId) || "?";
                  return (
                    <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                      <Checkbox size="small" checked={selMoves.has(i)} onChange={() => toggle(setSelMoves)(i)} sx={{ mt: -0.5 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.title}</Typography>
                        <Typography variant="caption" sx={{ display: "block" }}>
                          <strong>{cur}</strong> → <strong>{m.toStatus}</strong>
                        </Typography>
                        {m.reason && <Typography variant="caption" color="text.secondary">{m.reason}</Typography>}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            {notes.length > 0 && (
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Notes (added to existing tasks)</Typography>
                <Divider sx={{ mb: 0.5 }} />
                {notes.map((n, i) => {
                  if (droppedNotes.includes(n)) return null; // shown in banner only
                  return (
                    <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.75 }}>
                      <Checkbox size="small" checked={selNotes.has(i)} onChange={() => toggle(setSelNotes)(i)} sx={{ mt: -0.5 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{n.note}</Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}

            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
              Applying replaces the Pre-Brief, topics, and Open Floor, and writes the checked board changes —
              all in one transaction. The current agenda was saved to version history first.
            </Typography>
          </Box>
        ) : step === "working" ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary" align="center">
              {summary
                ? `${summaryText(summary)} — drafting the next ${meetingStyle} agenda + board changes…`
                : `Reading recent meetings + Project Board, drafting the next ${meetingStyle} agenda + board changes…`}
            </Typography>
          </Stack>
        ) : (
          <Box>
            <Typography
              variant="caption"
              sx={{ display: "block", mb: 1.5, color: lastGen ? "text.secondary" : "warning.main" }}
            >
              {lastGen
                ? `Last synced ${format(lastGen, "MMM d, yyyy · h:mm a")} (${formatDistanceToNow(lastGen, { addSuffix: true })}) — this run reconciles everything since then.`
                : "Not yet synced — this first run reconciles since the last meeting."}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The assistant reconciles this meeting's agenda with everything since it last occurred — this
              client's meetings, internal Vistamar meetings, and recent Project Board activity — and proposes
              both the next agenda and the board changes it implies. Pick the meeting style:
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
        <Button onClick={onClose} disabled={busy || refining}>
          {step === "review" ? "Discard" : "Cancel"}
        </Button>
        {step === "review" ? (
          <Button variant="contained" onClick={apply} disabled={busy || refining}>
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
