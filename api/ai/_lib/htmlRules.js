// api/ai/_lib/htmlRules.js
//
// Topic-body HTML rules shared by Sync Meeting (prepare.js), Refine and
// Generate, so the three never drift on what markup the model may emit.
// <span style> carries the editor's text color / highlight; the model keeps
// spans it finds and never makes new ones.
export const BODY_HTML_RULES = `HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>, plus <span style> where one already exists. No headings, no other tags. Never add a new style or <span>. PRESERVE COLORS: keep every existing <span style="…"> (text color or highlight) verbatim around the same words on any text you keep; it goes only when the words it wraps are removed. Exception: if a body already contains a <table>, keep it as a table (<table>, <tbody>, <tr>, <th>, <td>, each cell's text in a <p>) with the same columns and header row; update cell text in place, add a row only for a new item and remove a row only for a dropped item; never create a new table.`;
