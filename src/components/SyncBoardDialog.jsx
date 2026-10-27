// Board Sync dialog (Task Board, Andy only). Pre-flight lists every org with
// its NEW transcript count (orgs with nothing new start unticked) → Run fires
// one /api/ai/sync-board call per ticked org in parallel → one review grouped
// by org (each org done / failed + Retry) → Apply writes every done org in one
// transaction. Spec: docs/superpowers/specs/2026-10-26-board-sync-design.md.
import { useEffect, useMemo, useState } from "react";
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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "../contexts/AuthContext.jsx";
import { gatherBoardSyncInputs, runOrgSync, applyBoardSync } from "../lib/boardSync.js";
import { initPromotion } from "../lib/boardSyncCore.js";
import { validateProposal } from "../lib/syncMeeting.js";
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import ProposedBoardRow from "./ProposedBoardRow.jsx";

const STATUS_BY_ID = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s]));

function idxSet(list, keep) {
  const out = new Set();
  (list || []).forEach((x, i) => { if (keep.has(x)) out.add(i); });
  return out;
}

export default function SyncBoardDialog({ items, users, categories, tags, onClose }) {
  const { user } = useAuth();
  const [step, setStep] = useState("loading"); // loading | preflight | review | applying | done
  const [error, setError] = useState(null);
  const [gathered, setGathered] = useState(null);
  const [included, setIncluded] = useState(() => new Set());
  const [extraContext, setExtraContext] = useState("");
  // Per org: { status: "running" | "done" | "failed", error?, result?, valid?, sel?, promotions? }
  const [runs, setRuns] = useState({});
  const [applyResult, setApplyResult] = useState(null);
  // Discard after a run throws away paid proposals, so it takes two clicks;
  // any other action in the dialog disarms it.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    gatherBoardSyncInputs()
      .then((g) => {
        setGathered(g);
        setIncluded(new Set(g.orgs.filter((o) => o.fresh.length > 0).map((o) => o.slug)));
        setStep("preflight");
      })
      .catch((err) => { setError(err.message || "Couldn't load sync inputs"); setStep("preflight"); });
  }, []);

  const itemsById = useMemo(() => new Map((items || []).map((it) => [it.id, it])), [items]);
  const orgBySlug = useMemo(() => new Map((gathered?.orgs || []).map((o) => [o.slug, o])), [gathered]);

  // Caller marks the org "running" first (runAll for all ticked orgs at once,
  // retry for one).
  const startRun = async (slug) => {
    try {
      const result = await runOrgSync(orgBySlug.get(slug), gathered, items, extraContext.trim());
      const v = validateProposal({ topics: [], boardChanges: result.boardChanges, existingTasks: result.existingTasks, requireTopic: false });
      const bc = result.boardChanges;
      const valid = { creates: idxSet(bc.creates, new Set(v.acceptedCreates)), moves: idxSet(bc.moves, new Set(v.acceptedMoves)), notes: idxSet(bc.notes, new Set(v.acceptedNotes)) };
      const promotions = {};
      valid.creates.forEach((i) => { promotions[i] = initPromotion(bc.creates[i], { categories, tags, users }); });
      setRuns((prev) => ({
        ...prev,
        [slug]: { status: "done", result, validation: v, valid, sel: { creates: new Set(valid.creates), moves: new Set(valid.moves), notes: new Set(valid.notes) }, promotions },
      }));
    } catch (err) {
      setRuns((prev) => ({ ...prev, [slug]: { status: "failed", error: err.message || "Failed" } }));
    }
  };

  const runAll = () => {
    const slugs = [...included];
    setError(null);
    setRuns(Object.fromEntries(slugs.map((slug) => [slug, { status: "running" }])));
    setStep("review");
    slugs.forEach(startRun);
  };

  const retry = (slug) => {
    setConfirmDiscard(false);
    setRuns((prev) => ({ ...prev, [slug]: { status: "running" } }));
    startRun(slug);
  };

  const toggleSel = (slug, kind, i) => { setConfirmDiscard(false); setRuns((prev) => {
    const r = prev[slug];
    if (!r.valid[kind].has(i)) return prev;
    const next = new Set(r.sel[kind]);
    if (next.has(i)) next.delete(i); else next.add(i);
    return { ...prev, [slug]: { ...r, sel: { ...r.sel, [kind]: next } } };
  }); };

  const setCreateField = (slug) => (idx, field, value) => { setConfirmDiscard(false); setRuns((prev) => {
    const r = prev[slug];
    const creates = [...r.result.boardChanges.creates];
    creates[idx] = { ...creates[idx], [field]: value };
    return { ...prev, [slug]: { ...r, result: { ...r.result, boardChanges: { ...r.result.boardChanges, creates } } } };
  }); };

  const updatePromotion = (slug) => (idx, patch) => { setConfirmDiscard(false); setRuns((prev) => {
    const r = prev[slug];
    return { ...prev, [slug]: { ...r, promotions: { ...r.promotions, [idx]: { ...(r.promotions[idx] || {}), ...patch } } } };
  }); };

  // Drop a coined tag from every create in this org (it won't be added).
  const removeNewTag = (slug, name) => { setConfirmDiscard(false); setRuns((prev) => {
    const r = prev[slug];
    const promotions = Object.fromEntries(Object.entries(r.promotions).map(([i, p]) => [i, { ...p, newTags: (p.newTags || []).filter((t) => t !== name) }]));
    return { ...prev, [slug]: { ...r, promotions } };
  }); };

  // Spec 7: failed or still-running orgs block nothing — Apply takes the done
  // orgs as of the click; a run that lands afterwards is not in that apply.
  const runEntries = Object.entries(runs);
  const runningCount = runEntries.filter(([, r]) => r.status === "running").length;
  const doneSlugs = runEntries.filter(([, r]) => r.status === "done").map(([s]) => s);
  const hasPaidWork = runningCount > 0 || doneSlugs.length > 0;

  const discard = () => {
    if (step === "review" && hasPaidWork && !confirmDiscard) { setConfirmDiscard(true); return; }
    onClose();
  };

  const apply = async () => {
    setConfirmDiscard(false);
    setStep("applying");
    setError(null);
    try {
      const doneRuns = {};
      const selections = {};
      doneSlugs.forEach((slug) => {
        const r = runs[slug];
        doneRuns[slug] = r.result;
        const createIdxs = [...r.sel.creates];
        const promotions = {};
        createIdxs.forEach((i) => { promotions[i] = r.promotions[i]; });
        selections[slug] = { createIdxs, moveIdxs: [...r.sel.moves], noteIdxs: [...r.sel.notes], promotions };
      });
      setApplyResult(await applyBoardSync(doneRuns, selections, user?.uid || null));
      setStep("done");
    } catch (err) {
      setError(err.message || "Apply failed");
      setStep("review");
    }
  };

  const renderOrg = (slug) => {
    const org = orgBySlug.get(slug);
    const r = runs[slug] || {};
    const accent = org?.accentColor || "#888";
    const bc = r.result?.boardChanges;
    const v = r.validation;
    return (
      <Box key={slug} sx={{ mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5, px: 1, borderLeft: `4px solid ${accent}`, bgcolor: `${accent}14`, borderRadius: 0.5, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>{org?.name || slug}</Typography>
          {r.status === "running" && <CircularProgress size={16} />}
          {r.status === "done" && (
            <Typography variant="caption" color="text.secondary">
              {bc.creates.length} new · {bc.moves.length} moves · {bc.notes.length} notes
            </Typography>
          )}
          {r.status === "failed" && step !== "applying" && <Button size="small" onClick={() => retry(slug)}>Retry</Button>}
        </Box>
        {r.status === "failed" && <Alert severity="error">{r.error}</Alert>}
        {r.status === "done" && (
          <Box>
            {r.result.failedTranscripts.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1 }}>Couldn't load: {r.result.failedTranscripts.join(", ")} — not used, not marked synced.</Alert>
            )}
            {v.hasRejections && (
              <Alert severity="warning" sx={{ mb: 1 }}>
                Dropped: {[...v.rejectedCreates.map((c) => `"${c.title}" (${c.reason})`), ...v.droppedMoves.map((m) => `move "${m.title}" (${m.reason})`), ...v.droppedNotes.map((n) => `note "${n.title}" (${n.reason})`)].join("; ")}
              </Alert>
            )}
            {bc.creates.length + bc.moves.length + bc.notes.length === 0 && (
              <Typography variant="body2" color="text.secondary">No changes proposed.</Typography>
            )}
            {bc.creates.map((c, i) => (r.valid.creates.has(i) ? (
              <ProposedBoardRow
                key={`c${i}`}
                create={c}
                idx={i}
                isChecked={r.sel.creates.has(i)}
                onToggle={() => toggleSel(slug, "creates", i)}
                promotion={r.promotions[i]}
                onUpdateCreate={setCreateField(slug)}
                onUpdatePromotion={updatePromotion(slug)}
                itemsById={itemsById}
                creates={bc.creates}
                users={users || []}
                categories={categories || []}
                tags={tags || []}
              />
            ) : null))}
            {(() => {
              const coined = [...new Set(bc.creates.flatMap((c, i) => (r.sel.creates.has(i) ? r.promotions[i]?.newTags || [] : [])))];
              if (!coined.length) return null;
              return (
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">New tags to add:</Typography>
                  {coined.map((name) => (
                    <Chip key={name} label={name} size="small" variant="outlined" onDelete={() => removeNewTag(slug, name)} />
                  ))}
                </Box>
              );
            })()}
            {bc.moves.map((m, i) => (r.valid.moves.has(i) ? (
              <Box key={`m${i}`} sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 0.5, opacity: r.sel.moves.has(i) ? 1 : 0.5 }}>
                <Checkbox size="small" checked={r.sel.moves.has(i)} onChange={() => toggleSel(slug, "moves", i)} sx={{ p: 0.25 }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 600 }} noWrap>{m.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {STATUS_BY_ID[itemsById.get(m.itemId)?.statusId]?.name || "?"} → {m.toStatus}
                </Typography>
              </Box>
            ) : null))}
            {bc.notes.map((n, i) => (r.valid.notes.has(i) ? (
              <Box key={`n${i}`} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.5, opacity: r.sel.notes.has(i) ? 1 : 0.5 }}>
                <Checkbox size="small" checked={r.sel.notes.has(i)} onChange={() => toggleSel(slug, "notes", i)} sx={{ p: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{n.note}</Typography>
                </Box>
              </Box>
            ) : null))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Dialog
      open
      // Never dismiss on backdrop/Escape — a stray click would discard paid
      // proposals. Closes only via the explicit buttons.
      onClose={(_e, reason) => { if (reason === "backdropClick" || reason === "escapeKeyDown") return; onClose(); }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>Sync Board — all organizations</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {step === "loading" && (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Reading the last 30 days of meetings and the sync ledger…</Typography>
          </Stack>
        )}

        {step === "preflight" && gathered && (
          <Box>
            <Typography variant="caption" sx={{ display: "block", mb: 1.5, color: gathered.lastSyncAt ? "text.secondary" : "warning.main" }}>
              {gathered.lastSyncAt
                ? `Last Board Sync ${format(gathered.lastSyncAt, "MMM d, yyyy · h:mm a")} (${formatDistanceToNow(gathered.lastSyncAt, { addSuffix: true })}).`
                : "No Board Sync yet."}
              {" "}New = meetings in the last 30 days not yet synced for that org.
            </Typography>
            {gathered.orgs.map((o) => (
              <Box key={o.slug} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}>
                <Checkbox
                  size="small"
                  checked={included.has(o.slug)}
                  onChange={() => setIncluded((prev) => { const n = new Set(prev); if (n.has(o.slug)) n.delete(o.slug); else n.add(o.slug); return n; })}
                />
                <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: o.accentColor || "#888" }} />
                <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{o.name}</Typography>
                <Typography variant="caption" color={o.fresh.length ? "text.primary" : "text.secondary"}>
                  {o.fresh.length ? `${o.fresh.length} new` : "nothing new"} · {o.context.length} context
                  {o.droppedNew ? ` · ${o.droppedNew} older not included` : ""}
                </Typography>
              </Box>
            ))}
            {gathered.unclassified > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {gathered.unclassified} meeting(s) couldn't be matched to an org and are not included.
              </Typography>
            )}
            {gathered.ambiguousTitles.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {gathered.ambiguousTitles.length} meeting title(s) are mapped to agendas in more than one org and were classified by attendees instead:{" "}
                {gathered.ambiguousTitles.map((a) => `${a.title} (${a.orgs.map((s) => orgBySlug.get(s)?.name || s).join(", ")})`).join("; ")}
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />
            <TextField
              label="Additional context (sent to every org)"
              placeholder="e.g. “Blog A published Friday; Unio paused the GBP work.”"
              multiline
              minRows={3}
              fullWidth
              size="small"
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
            />
          </Box>
        )}

        {(step === "review" || step === "applying") && (
          <Box>{[...included].map(renderOrg)}</Box>
        )}

        {step === "done" && applyResult && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>Board Sync applied.</Alert>
            {Object.entries(applyResult.counts).map(([slug, c]) => (
              <Typography key={slug} variant="body2">
                <strong>{orgBySlug.get(slug)?.name || slug}</strong>: {c.created} created · {c.moved} moved · {c.noted} noted
              </Typography>
            ))}
            {applyResult.dropped.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                Not applied: {applyResult.dropped.map((d) => `${orgBySlug.get(d.org)?.name || d.org} — "${d.title}" (${d.reason})`).join("; ")}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === "done" ? (
          <Button variant="contained" onClick={onClose}>Close</Button>
        ) : (
          <>
            {(step === "review" || step === "applying") && runningCount > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
                {runningCount} still running — not included in this apply.
              </Typography>
            )}
            <Button onClick={discard} disabled={step === "applying"} color={confirmDiscard ? "error" : "primary"}>
              {step === "review" || step === "applying" ? (confirmDiscard ? "Discard paid proposals?" : "Discard") : "Cancel"}
            </Button>
            {step === "preflight" && (
              <Button variant="contained" onClick={runAll} disabled={!gathered || included.size === 0}>
                Run ({included.size} org{included.size === 1 ? "" : "s"})
              </Button>
            )}
            {(step === "review" || step === "applying") && (
              <Button variant="contained" onClick={apply} disabled={doneSlugs.length === 0 || step === "applying"}>
                {step === "applying" ? <CircularProgress size={18} color="inherit" /> : `Apply ${doneSlugs.length} org${doneSlugs.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
