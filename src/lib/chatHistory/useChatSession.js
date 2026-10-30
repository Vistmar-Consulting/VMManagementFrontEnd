// src/lib/chatHistory/useChatSession.js
//
// Which saved chat a chat panel shows, the list for its History view, and the
// writes (see store.js). Nothing is read until the panel is first opened.
// The chat last open on the page is remembered per browser (`pointerKey`)
// and reopened on return. A chat id is assigned at the first Send (claimId),
// so New chat writes nothing until then; a turn saves to the id it claimed,
// whatever chat the panel shows by the time it ends.
import { useEffect, useMemo, useRef, useState } from "react";
import { where } from "firebase/firestore";
import { useCollection } from "../../hooks/useCollection.js";
import { ChatTooLargeError, deleteChat, loadChat, newChatId, saveTurn, sortChats } from "./store.js";

const readPointer = (key) => localStorage.getItem(key);
const writePointer = (key, id) => (id ? localStorage.setItem(key, id) : localStorage.removeItem(key));

export function useChatSession({ uid, kind, agendaId = null, pointerKey, enabled, onRestore }) {
  const constraints = useMemo(
    () => [kind === "meeting" ? where("agendaId", "==", agendaId) : where("kind", "==", "board")],
    [kind, agendaId],
  );
  const { data, error: listError } = useCollection(enabled ? `users/${uid}/chats` : null, constraints);
  const chats = useMemo(() => sortChats(data), [data]);

  const [chatId, setChatIdState] = useState(null);
  const chatIdRef = useRef(null);
  const setChatId = (id) => {
    chatIdRef.current = id;
    setChatIdState(id);
    writePointer(pointerKey, id);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Chats whose saving has stopped: after a failed save, a later exchange
  // would be stored with an earlier one missing.
  // A ref: a turn's saves run from closures of the render that sent it.
  const stopped = useRef(new Set());
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  // Only the latest open() may restore: an earlier, slower load is dropped.
  const openSeq = useRef(0);

  const open = async (id) => {
    const seq = ++openSeq.current;
    setLoading(true);
    setError(null);
    try {
      const state = await loadChat(uid, id);
      if (seq !== openSeq.current) return;
      if (!state) {
        setChatId(null);
        restoreRef.current({ history: [], entries: [], seen: {} });
        return;
      }
      setChatId(id);
      restoreRef.current(state);
    } catch (err) {
      if (seq === openSeq.current) setError(`Could not open the chat: ${err.message}`);
    } finally {
      if (seq === openSeq.current) setLoading(false);
    }
  };

  // First open: the chat last open on this page.
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    const id = readPointer(pointerKey);
    if (id) open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on first open
  }, [enabled]);

  const startNew = () => {
    openSeq.current += 1;
    setLoading(false);
    setChatId(null);
    setError(null);
  };

  // The id the next exchange is saved under; a new chat gets one here.
  const claimId = () => {
    if (!chatIdRef.current) setChatId(newChatId());
    return chatIdRef.current;
  };

  // Saves run in the background; a failure is shown in the panel, never dropped.
  const save = (id, turn, summary) => {
    if (stopped.current.has(id)) return;
    saveTurn(uid, id, turn, { kind, agendaId, ...summary }).catch((err) => {
      stopped.current.add(id);
      setError(err instanceof ChatTooLargeError
        ? err.message
        : `Could not save this chat (${err.message}). Later messages in it won't be saved — start a New chat to keep them.`);
    });
  };

  const remove = async (id) => {
    setError(null);
    try {
      await deleteChat(uid, id);
      if (id === chatIdRef.current) startNew();
      return true;
    } catch (err) {
      setError(`Could not delete the chat: ${err.message}`);
      return false;
    }
  };

  return {
    chatId,
    chats,
    loading,
    error: error || (listError ? `Could not load your chats: ${listError.message}` : null),
    open,
    startNew,
    claimId,
    save,
    remove,
  };
}
