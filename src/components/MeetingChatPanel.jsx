// src/components/MeetingChatPanel.jsx
//
// Meeting Chat drawer on an agenda page (spec 2026-10-28-meeting-chat-design).
// Same loop as Board Chat: the agenda goes in the first message, tools run
// here, propose_agenda_changes opens MeetingChatChangesModal and waits for
// Apply / Cancel. Chats are saved per user in Firestore until deleted
// (lib/chatHistory); History lists this agenda's chats. The unsent draft stays
// in localStorage. Rendered inside the agenda's RoomProvider: Apply
// writes rewritten bodies into the live editor, as Sync Meeting does.
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Drawer, IconButton, Stack, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import SendIcon from "@mui/icons-material/Send";
import { getYjsProviderForRoom } from "@liveblocks/yjs";
import ChatHistoryView from "./ChatHistoryView.jsx";
import MeetingChatChangesModal from "./MeetingChatChangesModal.jsx";
import { useCollabFlushRegistry } from "./editor/CollabFlushRegistry.jsx";
import { writeTopicBodies } from "./editor/topicBodyYjs.js";
import { useOthers, useRoom } from "../lib/liveblocks.js";
import { postChat } from "../lib/boardChat/api.js";
import { MAX_CALLS_PER_TURN, formatUsd, runTurn } from "../lib/boardChat/conversation.js";
import { usePersistedDraft } from "../lib/boardChat/usePersistedChat.js";
import { makeLookups } from "../lib/boardChat/snapshot.js";
import { chatTitle, nextTurnIndex } from "../lib/chatHistory/store.js";
import { useChatSession } from "../lib/chatHistory/useChatSession.js";
import { applyAgendaPlan } from "../lib/meetingChat/apply.js";
import { OPEN_FLOOR, buildAgendaContext, mergeSeen, seenOf } from "../lib/meetingChat/context.js";
import { buildReviewRows, planAgendaWrites, restale } from "../lib/meetingChat/proposal.js";
import { firefliesSource, runMeetingReadTool } from "../lib/meetingChat/tools.js";
import appTheme from "../theme/index.js";

export const MEETING_CHAT_WIDTH = 420;
const TOP = appTheme.appBar.height;
// What a saved exchange keeps of a panel entry (retry bookkeeping is dropped:
// a reopened chat has no Retry).
const storedEntry = ({ user, reply, steps, costUsd, unpriced, notice, error, historyStart }) => ({ user, reply, steps, costUsd, unpriced, notice, error, historyStart });
const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n") : "");

const EXAMPLES = [
  "What did we decide about the website last meeting?",
  "Update the Website topic with this body: …",
  "Move the Tools topic to the Open Floor.",
  "Which tasks under Content are blocked?",
];

export default function MeetingChatPanel({ open, onClose, agendaId, agenda, topics, isMaster, orgs, orgName, organizationId, items, users, user }) {
  const [history, setHistory] = useState([]);
  const [entries, setEntries] = useState([]);
  // Mirrors `entries` synchronously: a turn saves the entry it just finished.
  const entriesRef = useRef([]);
  const patchEntries = (fn) => {
    entriesRef.current = fn(entriesRef.current);
    setEntries(entriesRef.current);
  };
  const [input, setInput] = usePersistedDraft(`vm-meeting-chat:${user.uid}:${agendaId}`, "vm-meeting-chat:");
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
    kind: "meeting",
    agendaId,
    pointerKey: `vm-meeting-chat-current:${user.uid}:${agendaId}`,
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

  const room = useRoom();
  const yProvider = useMemo(() => getYjsProviderForRoom(room), [room]);
  const others = useOthers();
  const { flushAll } = useCollabFlushRegistry();

  const lookups = makeLookups({ users, orgs, categories: [], tags: [] });
  // A turn runs for many renders; tools read the agenda through this ref so
  // each call sees the live topics, not those from when the user hit Send.
  const latest = useRef(null);
  latest.current = { agenda, topics: topics || [], orgs, isMaster, items, organizationId, lookups, source: firefliesSource };
  const total = entries.reduce((s, e) => s + (e.costUsd || 0), 0);
  const anyUnpriced = entries.some((e) => e.unpriced);

  // Leaving the agenda ends a running turn: no further (billed) model calls.
  // Set in the effect body, not the ref's initial value, so StrictMode's
  // mount-unmount-mount leaves it alive.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const post = (messages) => (mountedRef.current
    ? postChat(messages, "meeting-chat")
    : Promise.reject(new Error("Stopped — you left the agenda.")));

  // A null updatedAt is a write still waiting on its server timestamp.
  const settleSeen = () => {
    if (pendingSeenRef.current.size === 0) return;
    const live = seenOf(latest.current);
    for (const id of [...pendingSeenRef.current]) {
      if (!(id in live)) pendingSeenRef.current.delete(id);
      else if (live[id] != null) {
        seenRef.current[id] = live[id];
        pendingSeenRef.current.delete(id);
      }
    }
  };
  useEffect(settleSeen, [topics, agenda]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  const proposeChanges = (toolInput) => new Promise((resolve, reject) => {
    const live = latest.current;
    const rows = buildReviewRows(toolInput.ops, {
      topics: live.topics,
      agenda: live.agenda,
      isMaster: live.isMaster,
      orgIds: new Set(live.orgs.map((o) => o.id)),
      seen: seenRef.current,
    });
    proposalCount.current += 1;
    setPending({ id: proposalCount.current, summary: toolInput.summary, rows, resolve, reject, applying: false, error: null });
  });

  const handleApply = async (checked) => {
    const { rows, resolve } = pending;
    // Updated bodies are written into the live editor after the commit; refuse
    // before writing anything if it isn't connected.
    if (!yProvider.synced) {
      setPending((p) => ({ ...p, error: "Live editor not connected — reload the agenda and retry." }));
      return;
    }
    // Someone may have edited a ticked topic while the review was open: show
    // the review again with it flagged and unticked (the modal remounts).
    const fresh = restale(rows, { topics: latest.current.topics, agenda: latest.current.agenda, seen: seenRef.current });
    const newlyStale = fresh.filter((r) => r.stale && checked.has(r.index) && !rows[r.index].stale);
    if (newlyStale.length) {
      proposalCount.current += 1;
      setPending((p) => ({
        ...p,
        id: proposalCount.current,
        rows: fresh,
        // Keep the user's other choices; only the newly stale rows untick.
        checked: new Set([...checked].filter((i) => !newlyStale.some((r) => r.index === i))),
        error: `Changed by someone else while you were reviewing: ${newlyStale.map((r) => r.topicName || "the Open Floor").join(", ")}. Now unticked — tick to replace their edit, then Apply.`,
      }));
      return;
    }
    setPending((p) => ({ ...p, applying: true, error: null }));
    let plan;
    let createdIds;
    try {
      // Pending debounced edits land first, so they can't save over the new bodies.
      await flushAll();
      plan = planAgendaWrites(rows, checked, { topics: latest.current.topics, isMaster: latest.current.isMaster, orgs: latest.current.orgs });
      createdIds = await applyAgendaPlan(agendaId, plan, user.uid);
    } catch (err) {
      setPending((p) => ({ ...p, applying: false, error: err.message }));
      return;
    }
    // plan.creates (and so createdIds) follow the kept create rows in order.
    const keptCreates = rows.filter((r) => r.op === "create_topic" && r.ok && checked.has(r.index)).map((r) => r.index);
    const applied = rows.filter((r) => r.ok && checked.has(r.index)).map((r) => ({
      index: r.index,
      op: r.op,
      topic: r.topicName || r.name || "Open Floor",
      ...(r.op === "create_topic" ? { topicId: createdIds[keptCreates.indexOf(r.index)] } : {}),
    }));
    const declined = rows.filter((r) => !(r.ok && checked.has(r.index))).map((r) => ({ index: r.index, op: r.op, why: r.error || "unticked by the user" }));
    // Committed: once the listener delivers their server timestamps, what the
    // model wrote becomes what it has "seen" (its own changes aren't stale).
    plan.updates.forEach((u) => pendingSeenRef.current.add(u.id));
    if (plan.openFloorHtml !== null) pendingSeenRef.current.add(OPEN_FLOOR);
    settleSeen();
    try {
      writeTopicBodies(yProvider.getYDoc(), plan.liveBodies);
    } catch (err) {
      setPending(null);
      resolve({
        result: { applied, declined, warning: `Saved, but the live editor update failed (${err.message}). The user must reload the agenda before editing.` },
        step: `Applied ${applied.length} change${applied.length === 1 ? "" : "s"} — reload needed`,
      });
      return;
    }
    setPending(null);
    resolve({ result: { applied, declined }, step: `Applied ${applied.length} change${applied.length === 1 ? "" : "s"}` });
  };

  const handleCancel = () => {
    const { resolve, reject, error } = pending;
    setPending(null);
    if (error) reject(new Error(`Apply failed: ${error}`));
    else resolve({ result: { applied: [], declined: "all — the user cancelled the review" }, step: "Changes cancelled" });
  };

  const executeTool = async (name, toolInput) => {
    if (name === "propose_agenda_changes") return proposeChanges(toolInput);
    const out = await runMeetingReadTool(name, toolInput, latest.current);
    if (name === "get_agenda") seenRef.current = mergeSeen(seenRef.current, seenOf(latest.current));
    return out;
  };

  const runFrom = async (messages, entryIndex, chatId) => {
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
      const live = latest.current;
      const ctx = buildAgendaContext({ agenda: live.agenda, topics: live.topics, orgs: live.orgs, orgName, isMaster: live.isMaster, user, users });
      seenRef.current = { ...ctx.seen };
      content = [{ type: "text", text: ctx.text }, { type: "text", text }];
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

  const deleteChat = async (id) => {
    const wasOpen = id === session.chatId;
    if ((await session.remove(id)) && wasOpen) resetTo({ history: [], entries: [], seen: {} });
  };

  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={open}
      PaperProps={{ sx: { width: MEETING_CHAT_WIDTH, top: TOP, height: `calc(100% - ${TOP}px)` } }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Meeting Chat</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }} aria-label="Conversation cost">
          {formatUsd(total)}{anyUnpriced ? " + unpriced" : ""}
        </Typography>
        <IconButton size="small" onClick={() => setShowHistory((v) => !v)} disabled={busy} aria-label="Chat history" aria-pressed={showHistory} color={showHistory ? "primary" : "default"}>
          <HistoryIcon fontSize="small" />
        </IconButton>
        <Button size="small" onClick={newChat} disabled={busy}>New chat</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close Meeting Chat"><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      {currentTitle && !showHistory && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ px: 2, pt: 0.5 }}>{currentTitle}</Typography>
      )}
      {session.error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{session.error}</Alert>}

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {showHistory && (
          <ChatHistoryView chats={session.chats} currentId={session.chatId} busy={busy} onOpen={openChat} onDelete={deleteChat} />
        )}
        {!showHistory && session.loading && <Typography variant="body2" color="text.secondary">Loading chat…</Typography>}
        {!showHistory && !session.loading && entries.length === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Ask about this meeting and its past recordings, or ask for agenda changes — you review every change before it&apos;s made, and the agenda is saved to Version history first.
            </Typography>
            {EXAMPLES.map((ex) => (
              <Typography key={ex} variant="caption" component="div" color="text.disabled" sx={{ mb: 0.5 }}>“{ex}”</Typography>
            ))}
          </Box>
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
          maxRows={8}
          placeholder="Ask Meeting Chat…"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } }}
          disabled={busy || session.loading}
        />
        <IconButton onClick={send} disabled={busy || session.loading || !input.trim()} aria-label="Send"><SendIcon /></IconButton>
      </Stack>

      {pending && (
        <MeetingChatChangesModal
          key={pending.id}
          summary={pending.summary}
          rows={pending.rows}
          initialChecked={pending.checked}
          orgName={(id) => lookups.orgName(id)}
          othersCount={others.length}
          applying={pending.applying}
          error={pending.error}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}
    </Drawer>
  );
}
