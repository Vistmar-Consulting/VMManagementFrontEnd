// src/lib/syncNotes.js
//
// Provenance for the board changes Sync Meeting and Board Sync write. Each
// create, move and note becomes a Note (items/{id}/comments) saying which
// meeting it came from, who discussed it and why, and every created task gets
// the shared in-meeting tag. Pure — no Firebase imports; unit-tested in
// __tests__/syncNotes.test.js. aiAgenda.js and boardSync.js do the writes.

// Twin: api/ai/_lib/boardRules.js IN_MEETING_TAG (api/ can't import src/).
// __tests__/syncNotes.test.js asserts the two match.
export const IN_MEETING_TAG = "in-meeting";

// The tags/in-meeting doc a sync creates when it is missing. A Shared Tag
// (organizationId null), so it shows in every org's picker.
export const IN_MEETING_TAG_FIELDS = Object.freeze({
  name: IN_MEETING_TAG,
  color: "#0ea5e9",
  layer: 2,
  organizationId: null,
});

// Comment `source` values → the label the Notes modal shows.
export const SYNC_NOTE_SOURCES = Object.freeze({
  "sync-meeting": "Sync Meeting",
  "board-sync": "Board Sync",
});

// Attendee names for a Fireflies list row, sent with each transcript so the
// model can name who raised a task. Display names first, then any participant
// email with no display name; the Fireflies notetaker is left out.
export function attendeeNames(row) {
  const out = [];
  const seenEmails = new Set();
  const add = (name) => {
    const n = String(name || "").trim();
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  const isBot = (email) => /fireflies/i.test(email || "");
  for (const a of row?.meeting_attendees || []) {
    const email = String(a?.email || "").toLowerCase().trim();
    if (isBot(email)) continue;
    if (email) seenEmails.add(email);
    add(a?.displayName || email);
  }
  for (const p of row?.participants || []) {
    const email = String(p || "").toLowerCase().trim();
    if (!email || isBot(email) || seenEmails.has(email)) continue;
    seenEmails.add(email);
    add(email);
  }
  return out;
}

// The Note body for one accepted change. kind: "create" | "move" | "note".
//   create → its why;  move → "Moved to <status>: <reason>";  note → its text.
// Then the meeting (title · date) and who discussed it, each line only when known.
export function syncNoteBody(kind, change) {
  const c = change || {};
  const m = c.meeting || {};
  const lead = kind === "create"
    ? String(c.why || "").trim()
    : kind === "move"
      ? `Moved to ${c.toStatus}${String(c.reason || "").trim() ? `: ${String(c.reason).trim()}` : ""}`
      : String(c.note || "").trim();
  const where = [String(m.title || "").trim(), String(m.date || "").trim()].filter(Boolean).join(" · ");
  const people = (Array.isArray(m.people) ? m.people : []).map((p) => String(p).trim()).filter(Boolean);
  return [
    lead,
    where ? `Meeting: ${where}` : "",
    people.length ? `Discussed by: ${people.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

// A created task's tags: the reviewer's picks plus in-meeting, once.
export function withInMeetingTag(tagIds) {
  const list = Array.isArray(tagIds) ? tagIds : [];
  return list.includes(IN_MEETING_TAG) ? [...list] : [...list, IN_MEETING_TAG];
}
