// src/components/BoardChatPanel.jsx
//
// Board Chat drawer. Every chat is saved per user in Firestore until the user
// deletes it (lib/chatHistory); History lists them to reopen or delete. The
// unsent draft stays in localStorage. The board snapshot goes in the first
// message; tools run here.
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
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import SendIcon from "@mui/icons-material/Send";
import BoardChatChangesModal from "./BoardChatChangesModal.jsx";
import BoardChatHints from "./BoardChatHints.jsx";
import ChatHistoryView from "./ChatHistoryView.jsx";
import { applyChangeSet } from "../lib/itemWrites.js";
import { postChat } from "../lib/boardChat/api.js";
import { MAX_CALLS_PER_TURN, formatUsd, runTurn } from "../lib/boardChat/conversation.js";
import { buildReviewRows, toChangeSet } from "../lib/boardChat/proposal.js";
import { buildBoardSnapshot, itemRef, makeLookups, memberName, toMillis } from "../lib/boardChat/snapshot.js";
import { usePersistedDraft } from "../lib/boardChat/usePersistedChat.js";
import { chatTitle, nextTurnIndex } from "../lib/chatHistory/store.js";
import { useChatSession } from "../lib/chatHistory/useChatSession.js";
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

// What a saved exchange keeps of a panel entry (retry bookkeeping is dropped:
// a reopened chat has no Retry).
const storedEntry = ({ user, reply, steps, costUsd, unpriced, notice, error, historyStart }) => ({ user, reply, steps, costUsd, unpriced, notice, error, historyStart });

const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n") : "");

export default function BoardChatPanel({ open, onClose, items, users, orgs, categories, tags, user, onApplyFilter, views = [], onDeleteChatViews }) {
  const [history, setHistory] = useState([]);
  const [entries, setEntries] = useState([]);
  // Mirrors `entries` synchronously: a turn saves the entry it just finished.
  const entriesRef = useRef([]);
  const patchEntries = (fn) => {
    entriesRef.current = fn(entriesRef.current);
    setEntries(entriesRef.current);
  };
  const [input, setInput] = usePersistedDraft(`vm-board-chat:${user.uid}`, "vm-board-chat:");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(null);
  const [pending, setPending] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const seenRef = useRef({});
  const pendingSeenRef = useRef(new Set());
  const listRef = useRef(null);
  const proposalCount = useRef(0);

  const resetTo = ({ history: h, entries: e, seen }) => {
    setHistory(h);
    patchEntries(() => e);
    setRetry(null);
    seenRef.current = { ...seen };
    pendingSeenRef.current = new Set();
  };
  // Saved chats are read once the panel is first opened.
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => { if (open) setEverOpened(true); }, [open]);
  const session = useChatSession({
    uid: user.uid,
    kind: "board",
    pointerKey: `vm-board-chat-current:${user.uid}`,
    enabled: everOpened,
    onRestore: resetTo,
  });
  const currentTitle = session.chats.find((c) => c.id === session.chatId)?.title;

  // One exchange, saved at Send ("running") and again when its turn ends, to
  // the chat it was sent in. The panel can't switch chats while a turn runs,
  // so entriesRef still holds that chat.
  const saveEntry = (chatId, index, status, messages) => {
    const all = entriesRef.current;
    const entry = all[index];
    session.save(
      chatId,
      { index: entry.turnIndex, status, messages: messages.slice(entry.historyStart), entry: storedEntry(entry) },
      {
        title: chatTitle(all[0].user),
        costUsd: all.reduce((s, e) => s + (e.costUsd || 0), 0),
        unpriced: all.some((e) => e.unpriced),
        turnCount: all.length,
        seen: seenRef.current,
      },
    );
  };

  const lookups = makeLookups({ users, orgs, categories, tags });
  const itemLabel = (id) => {
    const it = items.find((i) => i.id === id);
    return it ? `${itemRef(it, items)} ${it.title || "(untitled)"}` : id;
  };
  // A turn runs for many renders. Tools read the board through this ref so
  // each call sees the live items, not the ones from when the user hit Send.
  const latest = useRef(null);
  latest.current = { items, users, orgs, categories, tags, lookups, itemLabel, onApplyFilter, onDeleteChatViews };
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

  // Leaving the board ends a running turn: no further (billed) model calls.
  // Set in the effect body so StrictMode's mount-unmount-mount leaves it alive.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const post = (messages) => (mountedRef.current
    ? postChat(messages)
    : Promise.reject(new Error("Stopped — you left the Task Board.")));

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
      // completedAt holds a serverTimestamp sentinel (or null), so it is
      // reported as "now" / "cleared"; createdVia is ours, not the model's.
      const completed = (completedAt) => (completedAt !== undefined ? { completedAt: completedAt === null ? "cleared" : "now" } : {});
      const applied = rows.filter(isApplied).map((r) => {
        if (r.op === "create") {
          const { completedAt, createdVia, ...newValues } = r.fields;
          return { index: r.index, op: "create", title: r.fields.title, ...createdByTemp.get(r.tempId), newValues, ...completed(completedAt) };
        }
        if (r.op === "delete") return { index: r.index, op: "delete", item: itemLabel(r.itemId), alsoDeletedSubtasks: r.cascadeIds.length };
        const { completedAt, ...newValues } = r.patch;
        return { index: r.index, op: "update", item: itemLabel(r.itemId), newValues, ...completed(completedAt) };
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
      const result = live.onApplyFilter(toolInput, turnChatRef.current);
      return { result, step: result.view ? `Filtered board: ${result.view}` : "Cleared board filters" };
    }
    const out = await runReadTool(name, toolInput, { items: live.items, lookups: live.lookups });
    // A null updatedAt is a write still waiting on its server timestamp; it
    // must not replace a baseline the model already has.
    for (const [id, ms] of Object.entries(out.seen)) {
      if (ms != null) seenRef.current[id] = ms;
    }
    return { result: out.result, step: STEP_LABEL[name](toolInput, { label: live.itemLabel }) };
  };

  // The chat the running turn belongs to: a filter view it makes is that chat's.
  const turnChatRef = useRef(null);
  const runFrom = async (messages, entryIndex, chatId) => {
    turnChatRef.current = chatId;
    setBusy(true);
    setRetry(null);
    patchEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, error: null, notice: null } : e)));
    const update = ({ messages: m, turn }) => {
      const lastAssistant = [...m].reverse().find((x) => x.role === "assistant");
      patchEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, reply: textOf(lastAssistant?.content), steps: [...(e.baseSteps || []), ...turn.steps], costUsd: (e.baseCost || 0) + turn.costUsd, unpriced: e.unpriced || turn.unpriced } : e)));
    };
    try {
      const out = await runTurn({ messages, post, executeTool, onUpdate: update });
      setHistory(out.messages);
      if (!out.done) patchEntries((prev) => prev.map((e, i) => (i === entryIndex ? { ...e, notice: `Stopped after ${MAX_CALLS_PER_TURN} model calls — ask again to continue.` } : e)));
      saveEntry(chatId, entryIndex, "done", out.messages);
    } catch (err) {
      setHistory(err.messages);
      // A retry starts a fresh turn, so this attempt's steps and cost become
      // the entry's base and the retry's are added on top.
      patchEntries((prev) => prev.map((e, i) => {
        if (i !== entryIndex) return e;
        const steps = [...(e.baseSteps || []), ...(err.turn?.steps || [])];
        const cost = (e.baseCost || 0) + (err.turn?.costUsd || 0);
        return { ...e, error: err.message, baseSteps: steps, steps, baseCost: cost, costUsd: cost, unpriced: e.unpriced || err.turn?.unpriced };
      }));
      setRetry({ messages: err.messages, entryIndex, chatId });
      // After leaving the page the exchange stays saved as "running", and
      // comes back as interrupted with nothing added to the model history.
      if (mountedRef.current) saveEntry(chatId, entryIndex, "error", err.messages);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy || session.loading) return;
    setInput("");
    setShowHistory(false);
    let content = text;
    if (history.length === 0) {
      const snap = buildBoardSnapshot({ items, users, orgs, categories, tags });
      seenRef.current = { ...snap.seen };
      content = [{ type: "text", text: contextBlock(snap.text, user, users) }, { type: "text", text }];
    }
    const chatId = session.claimId();
    const entryIndex = entriesRef.current.length;
    const turnIndex = nextTurnIndex(entriesRef.current);
    const messages = [...history, { role: "user", content }];
    patchEntries((prev) => [...prev, { user: text, reply: "", steps: [], costUsd: 0, historyStart: history.length, turnIndex }]);
    saveEntry(chatId, entryIndex, "running", messages);
    runFrom(messages, entryIndex, chatId);
  };

  const newChat = () => {
    session.startNew();
    resetTo({ history: [], entries: [], seen: {} });
    setShowHistory(false);
  };

  const openChat = (id) => {
    setShowHistory(false);
    if (id !== session.chatId) session.open(id);
  };

  // The chat is deleted first: if that fails, its views are left alone.
  const deleteChat = async (id, { deleteViews }) => {
    const wasOpen = id === session.chatId;
    if (!(await session.remove(id))) return;
    if (deleteViews) latest.current.onDeleteChatViews(id);
    if (wasOpen) resetTo({ history: [], entries: [], seen: {} });
  };

  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={open}
      PaperProps={{ sx: { width: PANEL_WIDTH, top: TOP, height: `calc(100% - ${TOP}px)` } }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Board Chat</Typography>
        <Box sx={{ flexGrow: 1 }}><BoardChatHints /></Box>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }} aria-label="Conversation cost">
          {formatUsd(total)}{anyUnpriced ? " + unpriced" : ""}
        </Typography>
        <IconButton size="small" onClick={() => setShowHistory((v) => !v)} disabled={busy} aria-label="Chat history" aria-pressed={showHistory} color={showHistory ? "primary" : "default"}>
          <HistoryIcon fontSize="small" />
        </IconButton>
        <Button size="small" onClick={newChat} disabled={busy}>New chat</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close Board Chat"><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      {currentTitle && !showHistory && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ px: 2, pt: 0.5 }}>{currentTitle}</Typography>
      )}
      {session.error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{session.error}</Alert>}

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {showHistory && (
          <ChatHistoryView
            chats={session.chats}
            currentId={session.chatId}
            busy={busy}
            onOpen={openChat}
            onDelete={deleteChat}
            viewCount={(id) => views.filter((v) => v.chatId === id).length}
          />
        )}
        {!showHistory && session.loading && <Typography variant="body2" color="text.secondary">Loading chat…</Typography>}
        {!showHistory && !session.loading && entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Ask about tasks, owners and meetings, filter the board, or ask for changes — you confirm every change before it's made.
          </Typography>
        )}
        {!showHistory && !session.loading && entries.map((e, i) => (
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
              <Alert severity="error" sx={{ mt: 1 }} action={retry?.entryIndex === i && !busy ? <Button size="small" onClick={() => runFrom(retry.messages, i, retry.chatId)}>Retry</Button> : null}>
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
        {busy && !showHistory && <Typography variant="caption" color="text.secondary">Thinking…</Typography>}
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
          disabled={busy || session.loading}
        />
        <IconButton onClick={send} disabled={busy || session.loading || !input.trim()} aria-label="Send"><SendIcon /></IconButton>
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
