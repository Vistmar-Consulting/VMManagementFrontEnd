// src/lib/agendaRoom.js
// Stable Liveblocks room id for an agenda. No React, no Firestore.
//
// Normally an agenda's collab room is `agenda:<firestoreDocId>`. One agenda has
// an abnormally long (181-char) doc id; its room `agenda:<id>` (188 chars) is
// rejected by Liveblocks ("no access to this room"), so collab can't connect and
// its topic bodies render blank. The underlying data is safe in Firestore
// `bodyHtml` — only the live room can't be reached.
//
// For such over-long ids we derive a stable, BOUNDED room id from a hash so
// Liveblocks accepts it. The fresh room is empty and self-heals from Firestore
// `bodyHtml` on first open (see CollabBodyEditor's content-based seed). Normal
// ids are returned unchanged, so every existing agenda keeps its room + content.
const MAX_ROOM_ID_LEN = 100; // well under Liveblocks' 256 cap; flags the anomaly

// Deterministic FNV-1a → base36. Stable across reloads and clients (a given
// agenda always maps to the same room), and Math.imul keeps it 32-bit.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function agendaRoomId(agendaId) {
  const id = String(agendaId || "");
  const full = `agenda:${id}`;
  if (full.length <= MAX_ROOM_ID_LEN) return full;
  // Keep a readable prefix for debuggability + the hash for uniqueness.
  return `agenda:${id.slice(0, 40)}-${hash32(id)}`;
}
