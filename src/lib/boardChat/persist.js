// src/lib/boardChat/persist.js
//
// Keeps a chat panel's unsent draft in localStorage so it survives leaving the
// page (conversations themselves are saved in Firestore, lib/chatHistory).
// One record per key (callers key by chat + user). A record expires after
// CHAT_TTL_MS without activity.

export const CHAT_TTL_MS = 12 * 60 * 60 * 1000;

// A record that can't be parsed, or has no savedAt, is treated as expired.
function readRecord(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const expired = (record, now) => typeof record?.savedAt !== "number" || now - record.savedAt > CHAT_TTL_MS;

export function loadChat(key, now = Date.now()) {
  const record = readRecord(key);
  if (!record) return null;
  if (expired(record, now)) {
    localStorage.removeItem(key);
    return null;
  }
  return record.state;
}

// Removes every expired record whose key starts with `prefix`. Agenda Chat
// keeps one record per agenda, and one never reopened would otherwise stay
// in storage for good.
export function purgeExpiredChats(prefix, now = Date.now()) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) {
    if (expired(readRecord(k), now)) localStorage.removeItem(k);
  }
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
