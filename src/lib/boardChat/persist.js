// src/lib/boardChat/persist.js
//
// Keeps a chat conversation in localStorage so it survives leaving the page.
// One record per key (callers key by chat + user). A record expires after
// CHAT_TTL_MS without activity — a working day's conversation comes back, the
// next morning starts fresh.

export const CHAT_TTL_MS = 12 * 60 * 60 * 1000;

export function loadChat(key, now = Date.now()) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (typeof record?.savedAt !== "number" || now - record.savedAt > CHAT_TTL_MS) {
    localStorage.removeItem(key);
    return null;
  }
  return record.state;
}

// Returns false when the browser's storage quota can't hold the record. The
// key is removed so an older copy is never restored in its place.
export function saveChat(key, state, now = Date.now()) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: now, state }));
    return true;
  } catch (err) {
    if (err?.name !== "QuotaExceededError") throw err;
    localStorage.removeItem(key);
    return false;
  }
}

export function clearChat(key) {
  localStorage.removeItem(key);
}

// The transcript to store while a turn may be in flight. Leaving the page ends
// the turn, so the in-flight entry is stored as interrupted; the stored model
// history stops before it, so the model never sees a half-finished turn.
export const INTERRUPTED_NOTICE = "Interrupted when you left the page — ask again.";

export function entriesToStore(entries, busy) {
  if (!busy || entries.length === 0) return entries;
  const last = entries[entries.length - 1];
  return [...entries.slice(0, -1), { ...last, notice: INTERRUPTED_NOTICE }];
}
