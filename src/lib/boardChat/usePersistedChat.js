// src/lib/boardChat/usePersistedChat.js
//
// Board Chat / Agenda Chat unsent draft, kept per user (see persist.js).
// `prefix` covers every record of this chat, for the expiry purge. The
// conversation record this key held before chats moved to Firestore is removed.
import { useEffect, useState } from "react";
import { clearChat, loadChat, purgeExpiredChats, saveChat } from "./persist.js";

export function usePersistedDraft(storeKey, prefix) {
  const draftKey = `${storeKey}:draft`;
  const [input, setInput] = useState(() => {
    purgeExpiredChats(prefix);
    clearChat(storeKey);
    return loadChat(draftKey) ?? "";
  });

  useEffect(() => {
    if (!input) clearChat(draftKey);
    else saveChat(draftKey, input);
  }, [draftKey, input]);

  return [input, setInput];
}
