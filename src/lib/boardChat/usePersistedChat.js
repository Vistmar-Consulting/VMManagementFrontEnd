// src/lib/boardChat/usePersistedChat.js
//
// Board Chat / Meeting Chat persistence wiring (see persist.js). The
// conversation is saved when it changes; the draft has its own small record so
// typing never re-serializes a conversation that may hold a board snapshot or
// transcripts. `prefix` covers every record of this chat, for the expiry purge.
import { useEffect, useState } from "react";
import { clearChat, entriesToStore, loadChat, purgeExpiredChats, saveChat } from "./persist.js";

export function restoreChat(storeKey, prefix) {
  purgeExpiredChats(prefix);
  return { ...(loadChat(storeKey) || {}), draft: loadChat(`${storeKey}:draft`) ?? "" };
}

export function usePersistedChat(storeKey, { history, entries, busy, seenRef, input }) {
  const [conversationFull, setConversationFull] = useState(false);
  const [draftFull, setDraftFull] = useState(false);

  useEffect(() => {
    if (entries.length === 0 && history.length === 0) {
      clearChat(storeKey);
      setConversationFull(false);
      return;
    }
    setConversationFull(!saveChat(storeKey, { history, entries: entriesToStore(entries, busy), seen: seenRef.current }));
  }, [storeKey, history, entries, busy, seenRef]);

  useEffect(() => {
    const key = `${storeKey}:draft`;
    if (!input) {
      clearChat(key);
      setDraftFull(false);
      return;
    }
    setDraftFull(!saveChat(key, input));
  }, [storeKey, input]);

  return { storageFull: conversationFull || draftFull };
}
