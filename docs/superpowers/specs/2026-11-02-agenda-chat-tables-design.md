# Agenda Chat Creates Tables — Design

Date: 2026-11-02 · Owner: Andy · Status: approved

## Goal

Let **Agenda Chat** create a table in a topic body or the Open Floor when the user asks for one.
Today every agenda AI operation shares `BODY_HTML_RULES` (`api/ai/_lib/htmlRules.js`), whose last
clause is "never create a new table". Agenda Chat therefore cannot do it; a table had to be built
by hand in the editor (2026-11-02, Unio Biweekly Google Ads "Campaign results").

## Decision

Only Agenda Chat may create tables, and only on the user's request. Sync Meeting (`prepare.js`),
Refine (`refine.js`) and Generate (`generate.js`) keep "never create a new table": they rewrite
topics without a user asking, so they must not turn lists into tables on their own.

Rejected: a structured `create_table` agenda op (rows/columns as JSON, HTML built in code). More
deterministic, but a second way to write bodies and more tool-schema surface, while `bodyHtml`
already carries tables end to end.

## What already works (no change)

- Editor schema: `TableKit` in `bodyContentExtensions()` (`src/components/editor/editorExtensions.js`).
- Apply: `AgendaChatPanel` → `writeTopicBodies` (`src/components/editor/topicBodyYjs.js`) parses
  with the same extensions, so a `<table>` in `bodyHtml` lands as a real table.
- Sanitizer: `sanitizeHtml` (`src/lib/agendaHtml.js:10`) keeps table markup. The proposal step
  sanitizes every `bodyHtml`, Open Floor included (`src/lib/agendaChat/proposal.js`); the Changes
  modal's `sanitizeRedlineHtml` allows tables; `api/` has no sanitizer. Nothing on the path strips
  a new `<table>`.

## Changes

### 1. `api/ai/_lib/htmlRules.js`

Add a second export, used only by Agenda Chat:

```js
// Agenda Chat only: it may build a table when the user asks. Overrides the
// tag list and the "never create a new table" clause of BODY_HTML_RULES.
export const CHAT_TABLE_RULES = `Tables (overrides the tag list and "never create a new table" above, for this case only): create a new table ONLY when the user explicitly asks for a table, or pastes tab- or pipe-separated data. Never turn content into a table otherwise. Tags: <table>, <tbody>, <tr>, <th>, <td>. Shape: <table><tbody>, the first <tr> is a header row of <th> cells, then one <tr> of <td> cells per data row; every cell's text inside a <p>. If the source has no header line, write short column names for the header row. Inside a cell's <p> the usual inline tags apply (<strong>, <em>, <u>, <a href>, and any existing <span style> kept verbatim per PRESERVE COLORS), e.g. a bold Total row. The table replaces only the text it was built from; keep the rest of the body exactly as it is.`;
```

`BODY_HTML_RULES` is unchanged.

### 2. `api/ai/_handlers/agendaChatTools.js`

- In the system prompt's body rules, directly after `- ${BODY_HTML_RULES}`, add
  `- ${CHAT_TABLE_RULES}` and import it.
- Style line (`:44`): change "no tables" to "no tables in your reply text" so the model does not
  read it as a ban on table bodies.

Nothing else in the prompt or tool schemas changes.

### 3. `src/lib/agendaDiff.js` — keep a replaced list together in the redline

Today a list is several `li` blocks; `diffGap` pairs only the first bullet with the new table and
emits the remaining deleted bullets after it, so the redline splits the old list around the new
table (`agendaDiff.js:152-157`). Fix: in `diffGap`, if any **paired** position `x < k`
(k = min of the two side lengths) has exactly one side a table, or two tables of different
shapes, the whole gap becomes every `before` block as `<del>`, then every `after` block as `<ins>`.
Leftover blocks (index ≥ k) never trigger it. Every other gap keeps today's pairing — e.g.
before = [p], after = [p′, table] still word-diffs p→p′ and inserts the table.

Blast radius: `diffAgendaHtml` also drives the Sync Meeting redline (`buildAgendaRedline`,
`agendaDiff.js:234-240`), so this changes Sync Meeting review the same way, for table gaps only.

### 4. `src/pages/AIIntegration.jsx` (`HOW_IT_WORKS`)

Update the "Tables kept" row to: "A table already in a topic body or Open Floor stays a table with
the same columns — the AI updates cell text in place, adds a row only for a new item and removes
one only for a dropped item. Sync Meeting, Refine and Generate never create a new table; Agenda
Chat creates one only when you ask for it (or paste tab- or pipe-separated data)."

## Tests

- `api/__tests__/chat.test.js` (beside the Agenda Chat route test, `:92-101`): the Agenda Chat
  system prompt contains `CHAT_TABLE_RULES`; the Board Chat prompt does not.
- `api/ai/_lib/__tests__/htmlRules.test.js` (existing; already asserts `BODY_HTML_RULES` in all
  three `buildSystem` prompts, `:19-23`): add that none of the three contains `CHAT_TABLE_RULES`.
- `src/lib/__tests__/agendaDiff.test.js` (model on the table tests at `:58-75`):
  - before = `<p>` + `<ul>` of 3 bullets, after = `<p>` + `<table>`: all 3 deleted bullets come
    before the inserted table, and the table's cells are in `<ins>`.
  - before = `[p]`, after = `[p′, table]`: p→p′ is a word diff and the table is a plain insert
    (the new rule does not fire on leftovers).
  - Existing `agendaDiff.test.js` and `syncMeeting.test.js` cases still pass unchanged.
- Full `npm test` and `npm run build` pass.

## Verification (deployed site)

After push to `dev` and deploy: one Agenda Chat turn on a test topic — "make the X list a table".
Check the review diff renders, Apply produces a real Tiptap table, it survives a reload, and the
rest of the body is unchanged. This is a paid model call; the cost is quoted to Andy before it runs.

## Out of scope

- Sync Meeting / Refine / Generate creating tables.
- Table styling, column widths, merged cells.
