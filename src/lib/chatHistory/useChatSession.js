// src/lib/chatHistory/useChatSession.js
//
// Which saved chat a chat panel shows, the list for its History view, and the
// writes (see store.js). Nothing is read until the panel is first opened.
// The chat last open on the page is remembered per browser (`pointerKey`)
// and reopened on return; a chat id is assigned at the first save, so New
// chat writes nothing until the first Send.
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
  // Set once an exchange is too large to store: later saves would leave a gap.
  const [blocked, setBlocked] = useState(false);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;

  const open = async (id) => {
    setLoading(true);
    setError(null);
    try {
      const state = await loadChat(uid, id);
      if (!state) {
        setChatId(null);
        restoreRef.current({ history: [], entries: [], seen: {} });
        return;
      }
      setChatId(id);
      setBlocked(false);
      restoreRef.current(state);
    } catch (err) {
      setError(`Could not open the chat: ${err.message}`);
    } finally {
      setLoading(false);
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
    setChatId(null);
    setBlocked(false);
    setError(null);
  };

  // Saves run in the background; a failure is shown in the panel, never dropped.
  const save = (turn, summary) => {
    if (blocked) return;
    if (!chatIdRef.current) setChatId(newChatId());
    const id = chatIdRef.current;
    saveTurn(uid, id, turn, { kind, agendaId, ...summary }).catch((err) => {
      if (err instanceof ChatTooLargeError) setBlocked(true);
      else setError(`Could not save this chat: ${err.message}`);
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
    // The id saves are going to, current even mid-render (a turn's tools run
    // between renders).
    idNow: () => chatIdRef.current,
    chats,
    loading,
    blocked,
    error: error || (listError ? `Could not load your chats: ${listError.message}` : null),
    open,
    startNew,
    save,
    remove,
  };
}
