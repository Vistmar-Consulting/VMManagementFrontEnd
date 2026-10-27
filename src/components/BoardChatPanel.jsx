// src/components/BoardChatPanel.jsx
//
// Board Chat drawer. Holds the conversation in memory (cleared by New chat or
// reload). The board snapshot goes in the first message; tools run here.
// propose_changes opens BoardChatChangesModal and waits for Apply / Cancel.
import { useEffect, useRef, useState } from "react";
import { serverTimestamp } from "firebase/firestore";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close as CloseIcon, Send as SendIcon } from "@mui/icons-material";
import BoardChatChangesModal from "./BoardChatChangesModal.jsx";
import { applyChangeSet } from "../lib/itemWrites.js";
import { postChat } from "../lib/boardChat/api.js";
import { MAX_CALLS_PER_TURN, formatUsd, runTurn } from "../lib/boardChat/conversation.js";
import { buildReviewRows, toChangeSet } from "../lib/boardChat/proposal.js";
import { buildBoardSnapshot, itemRef, makeLookups, memberName, toMillis } from "../lib/boardChat/snapshot.js";
import { runReadTool } from "../lib/boardChat/tools.js";
import appTheme from "../theme/index.js";

export const PANEL_WIDTH = 420;
// The drawer sits below the app bar. Read from the app theme module, not the
// sx theme arg, so the panel renders under any ThemeProvider (tests use a
// plain createTheme()).
const TOP = appTheme.appBar.height;

const STEP_LABEL = {
  get_item: (input, ctx) => `Read ${ctx.label(input.itemId)}`,
  search_items: (input) => `Searched "${input.query}"`,
  list_meetings: (input) => `Checked meetings ${input.startDate}${input.endDate !== input.startDate ? ` – ${input.endDate}` : ""}`,
};

function contextBlock(snapshotText, user, users) {
  const me = users.find((u) => u.id === user.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    "BOARD CONTEXT",
    `User: ${me ? memberName(me) : user.email} (id ${user.uid})`,
    `Now: ${new Date().toString()} (timezone ${tz})`,
    "",
    snapshotText,
  ].join("\n");
}

const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n") : "");

export default function BoardChatPanel({ open, onClose, items, users, orgs, categories, tags, user, onApplyFilter }) {
  const [history, setHistory] = useState([]);
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(null);
  const [pending, setPending] = useState(null);
  const seenRef = useRef({});
  const pendingSeenRef = useRef(new Set());
  const listRef = useRef(null);
  const proposalCount = useRef(0);

  const lookups = makeLookups({ users, orgs, categories, tags });
  const itemLabel = (id) => {
    const it = items.find((i) => i.id === id);
    return it ? `${itemRef(it)} ${it.title || "(untitled)"}` : id;
  };
  // A turn runs for many renders. Tools read the board through this ref so
  // each call sees the live items, not the ones from when the user hit Send.
  const latest = useRef(null);
  latest.current = { items, users, orgs, categories, tags, lookups, itemLabel, onApplyFilter };
  const total = entries.reduce((s, e) => s + (e.costUsd || 0), 0);
  const anyUnpriced = entries.some((e) => e.unpriced);

  // Applied writes get server timestamps; once the snapshot listener delivers
  // them, they become what the model "saw" (its own changes aren't stale).
  useEffect(() => {
    if (pendingSeenRef.current.size === 0) return;
    for (const id of [...pendingSeenRef.current]) {
      const it = items.find((i) => i.id === id);
      const ms = it ? toMillis(it.updatedAt) : null;
      if (!it || ms != null) {
        if (ms != null) seenRef.current[id] = ms;
        pendingSeenRef.current.delete(id);
      }
    }
  }, [items]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  const proposeChanges = (toolInput) => new Promise((resolve, reject) => {
    const { items: liveItems, orgs, users, categories, tags } = latest.current;
    const rows = buildReviewRows(toolInput.ops, {
      items: liveItems,
      orgIds: new Set(orgs.map((o) => o.id)),
      memberIds: new Set(users.map((u) => u.id)),
      categoryIds: new Set(categories.map((c) => c.id)),
      tagIds: new Set(tags.map((t) => t.id)),
      seen: seenRef.current,
      now: serverTimestamp(),
    });
    proposalCount.current += 1;
    setPending({ id: proposalCount.current, summary: toolInput.summary, rows, resolve, reject, applying: false, error: null });
  });

  const handleApply = async (checked) => {
    const { rows, resolve } = pending;
    const { ops, skipped } = toChangeSet(rows, checked);
    setPending((p) => ({ ...p, applying: true, error: null }));
    try {
      const created = await applyChangeSet(ops, { uid: user.uid, allItems: items });
      // Everything whose updatedAt this Apply bumps: updated items, new items,
      // and existing parents that gained a subtask.
      [
        ...ops.filter((o) => o.kind === "update").map((o) => o.itemId),
        ...ops.filter((o) => o.kind === "create" && o.parentId).map((o) => o.parentId),
        ...created.map((c) => c.itemId),
      ].forEach((id) => pendingSeenRef.current.add(id));
      const createdByTemp = new Map(created.map((c) => [c.tempId, c]));
      // Applied = exactly the rows that went into the change set: valid,
      // ticked, not skipped. Reported to the model by row index so a rejected
      // op on the same item can never be reported as applied.
      const skippedIdx = new Set(skipped.map((s) => s.index));
      const isApplied = (r) => r.ok && checked.has(r.index) && !skippedIdx.has(r.index);
      const applied = rows.filter(isApplied).map((r) => {
        if (r.op === "create") return { index: r.index, op: "create", title: r.fields.title, ...createdByTemp.get(r.tempId) };
        if (r.op === "delete") return { index: r.index, op: "delete", item: itemLabel(r.itemId), alsoDeletedSubtasks: r.cascadeIds.length };
        const { completedAt, ...newValues } = r.patch;
        return { index: r.index, op: "update", item: itemLabel(r.itemId), newValues, ...(completedAt !== undefined ? { completedAt: completedAt === null ? "cleared" : "now" } : {}) };
      });
      const declined = rows.filter((r) => !isApplied(r))
        .map((r) => ({ index: r.index, op: r.op, why: r.error || skipped.find((s) => s.index === r.index)?.reason || "unticked by the user" }));
      setPending(null);
      resolve({ result: { applied, declined }, step: `Applied ${applied.length} change${applied.length === 1 ? "" : "s"}` });
    } catch (err) {
      setPending((p) => ({ ...p, applying: false, error: err.message }));
    }
  };

  const handleCancel = () => {
    const { resolve, reject, error } = pending;
    setPending(null);
    if (error) reject(new Error(`Apply failed: ${error}`));
    else resolve({ result: { applied: [], declined: "all — the user cancelled the review" }, step: "Changes cancelled" });
  };

  const executeTool = async (name, toolInput) => {
    if (name === "propose_changes") return proposeChanges(toolInput);
    const live = latest.current;
    if (name === "set_board_filter") {
      const result = live.onApplyFilter(toolInput);
      return { result, step: toolInput.aiFilter ? `Filtered board: ${toolInput.aiFilter.label} (${toolInput.aiFilter.itemIds.length})` : "Filtered board" };
    }
    const out = await runReadTool(name, toolInput, { items: live.items, lookups: live.lookups });
    // A null updatedAt is a write still waiting on its server timestamp; it
    // must not replace a baseline the model already has.
    for (const [id, ms] of Object.entries(out.seen)) {
      if (ms != null) seenRef.current[id] = ms;
    }
    return { result: out.result, step: STEP_LABEL[name](toolInput, { label: live.itemLabel }) };
  };

  const runFrom = async (messages, entryIndex) => {
    setBusy(true);
    setRetry(null);
    setEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, error: null, notice: null } : e)));
    const update = ({ messages: m, turn }) => {
      const lastAssistant = [...m].reverse().find((x) => x.role === "assistant");
      setEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, reply: textOf(lastAssistant?.content), steps: [...(e.baseSteps || []), ...turn.steps], costUsd: (e.baseCost || 0) + turn.costUsd, unpriced: e.unpriced || turn.unpriced } : e)));
    };
    try {
      const out = await runTurn({ messages, post: postChat, executeTool, onUpdate: update });
      setHistory(out.messages);
      if (!out.done) setEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, notice: `Stopped after ${MAX_CALLS_PER_TURN} model calls — ask again to continue.` } : e)));
    } catch (err) {
      setHistory(err.messages);
      // A retry starts a fresh turn, so this attempt's steps and cost become
      // the entry's base and the retry's are added on top.
      setEntries((prev) => prev.map((e, i) => {
        if (i !== entryIndex) return e;
        const steps = [...(e.baseSteps || []), ...(err.turn?.steps || [])];
        const cost = (e.baseCost || 0) + (err.turn?.costUsd || 0);
        return { ...e, error: err.message, baseSteps: steps, steps, baseCost: cost, costUsd: cost, unpriced: e.unpriced || err.turn?.unpriced };
      }));
      setRetry({ messages: err.messages, entryIndex });
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    let content = text;
    if (history.length === 0) {
      const snap = buildBoardSnapshot({ items, users, orgs, categories, tags });
      seenRef.current = { ...snap.seen };
      content = [{ type: "text", text: contextBlock(snap.text, user, users) }, { type: "text", text }];
    }
    const entryIndex = entries.length;
    setEntries((prev) => [...prev, { user: text, reply: "", steps: [], costUsd: 0 }]);
    runFrom([...history, { role: "user", content }], entryIndex);
  };

  const newChat = () => {
    setHistory([]);
    setEntries([]);
    setRetry(null);
    seenRef.current = {};
  };

  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={open}
      PaperProps={{ sx: { width: PANEL_WIDTH, top: TOP, height: `calc(100% - ${TOP}px)` } }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Board Chat</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }} aria-label="Conversation cost">
          {formatUsd(total)}{anyUnpriced ? " + unpriced" : ""}
        </Typography>
        <Button size="small" onClick={newChat} disabled={busy}>New chat</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close Board Chat"><CloseIcon fontSize="small" /></IconButton>
      </Stack>

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ask about tasks, owners and meetings, filter the board, or ask for changes — you confirm every change before it's made.
          </Typography>
        )}
        {entries.map((e, i) => (
          <Box key={i} sx={{ mb: 2 }}>
            <Box sx={{ ml: 4, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{e.user}</Typography>
            </Box>
            {e.steps.length > 0 && (
              <Typography variant="caption" component="div" color="text.disabled" sx={{ mt: 0.5 }}>{e.steps.join(" · ")}</Typography>
            )}
            {e.reply && <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap" }}>{e.reply}</Typography>}
            {e.notice && <Alert severity="warning" sx={{ mt: 1 }}>{e.notice}</Alert>}
            {e.error && (
              <Alert severity="error" sx={{ mt: 1 }} action={retry?.entryIndex === i && !busy ? <Button size="small" onClick={() => runFrom(retry.messages, i)}>Retry</Button> : null}>
                {e.error}
              </Alert>
            )}
            {(e.costUsd > 0 || e.unpriced) && (
              <Typography variant="caption" component="div" color="text.disabled" sx={{ textAlign: "right" }}>
                {formatUsd(e.costUsd)}{e.unpriced ? " + unpriced" : ""}
              </Typography>
            )}
          </Box>
        ))}
        {busy && <Typography variant="caption" color="text.secondary">Thinking…</Typography>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={5}
          placeholder="Ask Board Chat…"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } }}
          disabled={busy}
        />
        <IconButton onClick={send} disabled={busy || !input.trim()} aria-label="Send"><SendIcon /></IconButton>
      </Stack>

      {pending && (
        <BoardChatChangesModal
          key={pending.id}
          open
          summary={pending.summary}
          rows={pending.rows}
          lookups={lookups}
          itemLabel={itemLabel}
          applying={pending.applying}
          error={pending.error}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}
    </Drawer>
  );
}
