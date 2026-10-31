// api/ai/_lib/boardRules.js
//
// Project Board change rules shared by Sync Meeting (_handlers/prepare.js) and
// Board Sync (_handlers/syncBoard.js), so the two features never drift on what
// belongs on a board or how moves/notes/subitems work. prepare.js's output is
// locked byte-for-byte by __tests__/prepare.snapshot.test.js.

// Vistamar board scope — prepended to the board rules for Vistamar (internal)
// and master runs.
export const VISTAMAR_BOARD_SCOPE = `## SCOPE — what belongs on the Vistamar board
Vistamar's board covers ONLY Vistamar's own work: (1) platform/product development of Vistamar's own apps and internal tooling, and (2) business development — promoting Vistamar's company & services AND outreach to PROSPECTIVE clients for new-business acquisition. Work that delivers services to an EXISTING client org (Unio, Bryn Mawr, Golden Vision, ID Care) does NOT belong here — it lives on that client's board, so do NOT propose it as a Vistamar create. Outreach to a PROSPECTIVE (not-yet) client IS Vistamar business development → include it.`;

// The shared tag the app adds to every task a sync creates. Twin:
// src/lib/syncNotes.js IN_MEETING_TAG (api/ can't import src/).
export const IN_MEETING_TAG = "in-meeting";

// Where each board change came from. The client turns it, plus the change's
// why / reason / note, into a Note on the task (src/lib/syncNotes.js).
export const MEETING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    date: { type: "string" },
    people: { type: "array", items: { type: "string" } },
  },
  required: ["title", "date", "people"],
};

export function normalizeMeeting(m) {
  return {
    title: String(m?.title || ""),
    date: String(m?.date || ""),
    people: Array.isArray(m?.people) ? m.people.map((p) => String(p).trim()).filter(Boolean) : [],
  };
}

// Drops the tag the app adds itself, so the model can't propose it on a topic
// or coin it as a Client Tag.
export function withoutAppTags(tags) {
  return (Array.isArray(tags) ? tags : []).map((t) => String(t)).filter((t) => t.trim().toLowerCase() !== IN_MEETING_TAG);
}

export const MEETING_RULES = `### Where each change came from (\`meeting\` on every create, move and note)
Every create, move and note becomes a Note on the task, read by teammates who were NOT in the meeting. Fill \`meeting\` so they know where it came from:
- title: the exact title of the meeting the work came from, as shown in the transcript heading; "" only when it came from the additional context rather than a meeting.
- date: that meeting's date, as shown in the heading (YYYY-MM-DD); "" when there is none.
- people: the names of the people who raised or discussed it. Action items are often grouped under the name of the person they belong to — use those names, and the attendee list. When the record doesn't say who raised it, name the owner. Never invent a name.`;

export const CREATE_BASE_RULES = `- Propose ONLY work that genuinely surfaced in the record and is NOT already on the board (don't duplicate existing tasks).
- Each create: a concrete action-oriented title; a one-line note stating the work + naming the owner/contact as "Owner: <name>" (use the SOPs — e.g. Bill = website, Cedric = technical); and \`why\`: one or two plain sentences on why this task exists — what was said, the decision or problem behind it, and what it unblocks. Write for a teammate who wasn't there.
- Never use or coin the tag "${IN_MEETING_TAG}" — the app adds it to every task a sync creates.`;

export const PARENT_REF_RULES = `- OPTIONAL: set \`parentRef\` when this task is a subitem.
  - Nest under an **existing** board item: set \`parentRef\` to that item's \`itemId\` (from the task list below).
  - Nest under a **newly proposed** task in this run: set \`parentRef\` to \`"new:N"\` where N is the 0-based index of the parent create in this \`creates\` array (e.g. \`"new:0"\` nests under the first proposed task).
  - One level deep only — never set \`parentRef\` on a task whose intended parent itself has a \`parentRef\`.
  - Leave \`parentRef\` empty or omit for top-level tasks.`;

export const MOVES_RULES = `### boardChanges.moves — STATUS MOVES on EXISTING tasks
- When the record clearly indicates an existing task progressed, propose a move. Set itemId (exact, from the existing list), title (copy the existing title), toStatus (one of: Assigned, In Progress, Blocked, Review, Done), and a one-line reason saying what in the record shows the progress.
- Examples: transcript says something shipped/aired/published → toStatus "Done"; work actively underway → "In Progress"; awaiting sign-off → "Review"; blocked/waiting → "Blocked". Only move when the record is clear — when unsure, omit.`;

export const NOTES_RULES = `### boardChanges.notes — context on EXISTING tasks
- When the record adds useful context to an existing task without changing its status, propose a note: itemId, title (copy existing), and the note text: what was said or decided, in plain words for a teammate who wasn't there.`;
