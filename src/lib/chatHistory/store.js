// src/lib/chatHistory/store.js
//
// Board Chat / Meeting Chat history in Firestore (spec 2026-10-29-chat-history-design).
//   users/{uid}/chats/{chatId}               summary: kind, agendaId, title, cost, seen
//   users/{uid}/chats/{chatId}/turns/{index} one exchange: status, messagesJson, entryJson
// Private to the owner (firestore.rules). Messages are stored as JSON strings:
// Firestore rejects nested arrays and undefined, and the string length gives
// the exact size for the 1 MB document limit.
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../firebase.js";

// Firestore's limit is 1,048,576 bytes per document; the rest is headroom for
// field names and the other fields.
export const MAX_TURN_BYTES = 1_000_000;
export const INTERRUPTED_NOTICE = "Interrupted when you left the page — ask again.";
const TITLE_MAX = 60;
// Firestore allows 500 writes per batch.
const BATCH_SIZE = 450;

export class ChatTooLargeError extends Error {
  constructor() {
    super("This chat can't be saved any further — start a new chat.");
    this.name = "ChatTooLargeError";
  }
}

const chatsPath = (uid) => collection(db, "users", uid, "chats");
const chatRef = (uid, chatId) => doc(db, "users", uid, "chats", chatId);
const turnsPath = (uid, chatId) => collection(db, "users", uid, "chats", chatId, "turns");
const turnRef = (uid, chatId, index) => doc(db, "users", uid, "chats", chatId, "turns", String(index).padStart(5, "0"));

export const newChatId = () => doc(chatsPath("_")).id;

export function chatTitle(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

const byteLength = (s) => new TextEncoder().encode(s).length;

// Throws ChatTooLargeError when the exchange can't fit in one document.
export function turnDoc({ index, status, messages, entry }) {
  const messagesJson = JSON.stringify(messages);
  const entryJson = JSON.stringify(entry);
  if (byteLength(messagesJson) + byteLength(entryJson) > MAX_TURN_BYTES) throw new ChatTooLargeError();
  return { index, status, messagesJson, entryJson };
}

// One exchange plus the chat summary, in one batch. The first save of a chat
// (turn 0, at Send) also creates the summary.
export async function saveTurn(uid, chatId, turn, summary) {
  const batch = writeBatch(db);
  batch.set(turnRef(uid, chatId, turn.index), { ...turnDoc(turn), savedAt: serverTimestamp() });
  batch.set(chatRef(uid, chatId), {
    kind: summary.kind,
    agendaId: summary.agendaId ?? null,
    title: summary.title,
    costUsd: summary.costUsd,
    unpriced: summary.unpriced,
    turnCount: summary.turnCount,
    seenJson: JSON.stringify(summary.seen),
    updatedAt: serverTimestamp(),
    ...(turn.index === 0 && turn.status === "running" ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true });
  await batch.commit();
}

// The stored turns as the panel's state. A "running" turn is one the page was
// closed during: it is shown as interrupted and adds nothing to the model
// history, so the model never sees a half-finished exchange.
export function restoreTurns(turns) {
  const sorted = [...turns].sort((a, b) => a.index - b.index);
  return {
    history: sorted.filter((t) => t.status !== "running").flatMap((t) => JSON.parse(t.messagesJson)),
    entries: sorted.map((t) => {
      const entry = JSON.parse(t.entryJson);
      return t.status === "running" ? { ...entry, notice: INTERRUPTED_NOTICE } : entry;
    }),
  };
}

// Null when the chat no longer exists (deleted in another tab).
export async function loadChat(uid, chatId) {
  const summary = await getDoc(chatRef(uid, chatId));
  if (!summary.exists()) return null;
  const snap = await getDocs(query(turnsPath(uid, chatId), orderBy("index")));
  const { history, entries } = restoreTurns(snap.docs.map((d) => d.data()));
  return { history, entries, seen: JSON.parse(summary.data().seenJson || "{}") };
}

export async function deleteChat(uid, chatId) {
  const snap = await getDocs(turnsPath(uid, chatId));
  const refs = [...snap.docs.map((d) => d.ref), chatRef(uid, chatId)];
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// Newest first; a summary still waiting on its server timestamp is the newest.
export function sortChats(chats) {
  const ms = (c) => (c.updatedAt ? c.updatedAt.toMillis() : Infinity);
  return [...chats].sort((a, b) => ms(b) - ms(a));
}
