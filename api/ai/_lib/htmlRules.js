// api/ai/_lib/htmlRules.js
//
// Topic-body HTML rules shared by Sync Meeting (prepare.js), Refine and
// Generate, so the three never drift on what markup the model may emit.
// <span style> carries the editor's text color / highlight; the model keeps
// spans it finds and never makes new ones.
export const BODY_HTML_RULES = `HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>, plus <span style> where one already exists. No headings, no other tags. Never add a new style or <span>. PRESERVE COLORS: keep every existing <span style="…"> (text color or highlight) verbatim around the same words on any text you keep; it goes only when the words it wraps are removed. Exception: if a body already contains a <table>, keep it as a table (<table>, <tbody>, <tr>, <th>, <td>, each cell's text in a <p>) with the same columns and header row; update cell text in place, add a row only for a new item and remove a row only for a dropped item; never create a new table.`;

// Agenda Chat only: it may build a table when the user asks. Overrides the
// tag list and the "never create a new table" clause of BODY_HTML_RULES.
export const CHAT_TABLE_RULES = `Tables (overrides the tag list and "never create a new table" above, for this case only): create a new table ONLY when the user explicitly asks for a table, or pastes tab- or pipe-separated data. Never turn content into a table otherwise. Tags: <table>, <tbody>, <tr>, <th>, <td>. Shape: <table><tbody>, the first <tr> is a header row of <th> cells, then one <tr> of <td> cells per data row; every cell's text inside a <p>. If the source has no header line, write short column names for the header row. Inside a cell's <p> the usual inline tags apply (<strong>, <em>, <u>, <a href>, and any existing <span style> kept verbatim per PRESERVE COLORS), e.g. a bold Total row. The table replaces only the text it was built from; keep the rest of the body exactly as it is.`;
