// src/lib/boardChat/api.js
import { auth } from "../../firebase.js";

// POST /api/ai/chat (Board Chat) or /api/ai/agenda-chat. Errors carry
// costUsd/model when the server billed the call anyway (refusal, cut-off), so
// the cost tracker stays honest.
export async function postChat(messages, route = "chat") {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch(`/api/ai/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Token": token },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { costUsd: data.costUsd, model: data.model });
  }
  return data;
}
