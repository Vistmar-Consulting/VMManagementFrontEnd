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

export const CREATE_BASE_RULES = `- Propose ONLY work that genuinely surfaced in the record and is NOT already on the board (don't duplicate existing tasks).
- Each create: a concrete action-oriented title; a one-line note citing the source (meeting/date) + naming the owner/contact (use the SOPs — e.g. Bill = website, Cedric = technical).`;

export const PARENT_REF_RULES = `- OPTIONAL: set \`parentRef\` when this task is a subitem.
  - Nest under an **existing** board item: set \`parentRef\` to that item's \`itemId\` (from the task list below).
  - Nest under a **newly proposed** task in this run: set \`parentRef\` to \`"new:N"\` where N is the 0-based index of the parent create in this \`creates\` array (e.g. \`"new:0"\` nests under the first proposed task).
  - One level deep only — never set \`parentRef\` on a task whose intended parent itself has a \`parentRef\`.
  - Leave \`parentRef\` empty or omit for top-level tasks.`;

export const MOVES_RULES = `### boardChanges.moves — STATUS MOVES on EXISTING tasks
- When the record clearly indicates an existing task progressed, propose a move. Set itemId (exact, from the existing list), title (copy the existing title), toStatus (one of: Assigned, In Progress, Blocked, Review, Done), and a one-line reason citing the source.
- Examples: transcript says something shipped/aired/published → toStatus "Done"; work actively underway → "In Progress"; awaiting sign-off → "Review"; blocked/waiting → "Blocked". Only move when the record is clear — when unsure, omit.`;

export const NOTES_RULES = `### boardChanges.notes — context on EXISTING tasks
- When the record adds useful context to an existing task without changing its status, propose a note: itemId, title (copy existing), and the note text (cite the source).`;
