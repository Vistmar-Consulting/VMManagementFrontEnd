// Pure redline helpers for the Sync Meeting review: pre-sync agenda → proposed
// agenda. No React/Firebase. Output is display-only HTML with <del>/<ins>;
// render it through sanitizeRedlineHtml and never save it.
// Spec: docs/superpowers/specs/2026-10-27-sync-meeting-tracked-edits-design.md
import { diffWords } from "diff";
import { sanitizeHtml, escapeText } from "./agendaHtml.js";

// A paired text block is word-diffed only if this share of the longer text is
// unchanged; below it, a whole delete + insert reads better than confetti.
const MIN_SIMILARITY = 0.3;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const isList = (el) => el.tagName === "UL" || el.tagName === "OL";

// An <li>'s own content: everything except its nested lists.
function liOwn(li) {
  const clone = li.cloneNode(true);
  [...clone.children].filter(isList).forEach((c) => c.remove());
  return { html: clone.innerHTML, text: norm(clone.textContent) };
}

function tableCells(table) {
  return [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.children]
      .filter((c) => c.tagName === "TD" || c.tagName === "TH")
      .map((c) => ({ tag: c.tagName.toLowerCase(), text: norm(c.textContent) })),
  );
}

// Flatten a body into ordered blocks: { kind: "p"|"li"|"table", lists, html, text, cells? }.
// lists = the li's list-tag path (["ul"], ["ul","ol"], …); [] for p and table.
function parseBlocks(html) {
  const root = new DOMParser().parseFromString(html, "text/html").body;
  const blocks = [];
  const walkList = (listEl, lists) => {
    const path = [...lists, listEl.tagName.toLowerCase()];
    [...listEl.children].forEach((li) => {
      if (li.tagName !== "LI") return;
      const own = liOwn(li);
      if (own.text) blocks.push({ kind: "li", lists: path, ...own });
      [...li.children].filter(isList).forEach((c) => walkList(c, path));
    });
  };
  root.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const text = norm(node.textContent);
      if (text) blocks.push({ kind: "p", lists: [], html: escapeText(node.textContent), text });
      return;
    }
    if (node.nodeType !== 1) return;
    if (isList(node)) return walkList(node, []);
    if (node.tagName === "TABLE") {
      const cells = tableCells(node);
      blocks.push({ kind: "table", lists: [], html: node.outerHTML, cells, text: cells.map((r) => r.map((c) => c.text).join("\t")).join("\n") });
      return;
    }
    const text = norm(node.textContent);
    if (text) blocks.push({ kind: "p", lists: [], html: node.tagName === "P" ? node.innerHTML : node.outerHTML, text });
  });
  return blocks;
}

// Index pairs [i, j] of an LCS over block identity (kind + text).
function lcsPairs(a, b) {
  const key = (x) => `${x.kind}|${x.text}`;
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function wordDiff(before, after) {
  const parts = diffWords(before, after);
  const kept = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.trim().length, 0);
  const html = parts
    .map((p) => {
      const v = escapeText(p.value);
      if (p.removed) return `<del>${v}</del>`;
      if (p.added) return `<ins>${v}</ins>`;
      return v;
    })
    .join("");
  return { html, similarity: kept / Math.max(before.length, after.length, 1) };
}

const tableHtml = (rows) =>
  `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<${c.tag}>${c.html}</${c.tag}>`).join("")}</tr>`).join("")}</tbody></table>`;

const sameShape = (a, b) => a.cells.length === b.cells.length && a.cells.every((r, i) => r.length === b.cells[i].length);

function wholeBlock(block, mark) {
  if (block.kind === "table") {
    return { kind: "table", lists: [], html: tableHtml(block.cells.map((r) => r.map((c) => ({ tag: c.tag, html: `<${mark}>${escapeText(c.text)}</${mark}>` })))) };
  }
  return { kind: block.kind, lists: block.lists, html: `<${mark}>${block.html}</${mark}>` };
}

function pairChanged(b, a, out) {
  if (b.kind === "table" && a.kind === "table" && sameShape(b, a)) {
    const rows = a.cells.map((r, ri) => r.map((c, ci) => ({ tag: c.tag, html: wordDiff(b.cells[ri][ci].text, c.text).html })));
    out.push({ kind: "table", lists: [], html: tableHtml(rows) });
    return;
  }
  if (b.kind !== "table" && a.kind !== "table") {
    const d = wordDiff(b.text, a.text);
    if (d.similarity >= MIN_SIMILARITY) {
      out.push({ kind: a.kind, lists: a.lists, html: d.html });
      return;
    }
  }
  out.push(wholeBlock(b, "del"));
  out.push(wholeBlock(a, "ins"));
}

// Unmatched blocks between two LCS matches: pair in order, then the leftovers.
function diffGap(before, after, out) {
  const k = Math.min(before.length, after.length);
  for (let x = 0; x < k; x++) pairChanged(before[x], after[x], out);
  before.slice(k).forEach((b) => out.push(wholeBlock(b, "del")));
  after.slice(k).forEach((a) => out.push(wholeBlock(a, "ins")));
}

// Rebuild HTML from rendered items, re-nesting list items by their list path.
function render(items) {
  let out = "";
  const stack = []; // open lists: { tag, liOpen }
  const closeTo = (depth) => {
    while (stack.length > depth) {
      const s = stack.pop();
      out += `${s.liOpen ? "</li>" : ""}</${s.tag}>`;
    }
  };
  items.forEach((it) => {
    if (it.kind !== "li") {
      closeTo(0);
      out += it.kind === "table" ? it.html : `<p>${it.html}</p>`;
      return;
    }
    const depth = it.lists.length;
    // Keep only the open lists that match this item's path; a different tag
    // at any level (e.g. <ul> then <ol>) starts a new list from there.
    let keep = 0;
    while (keep < Math.min(depth, stack.length) && stack[keep].tag === it.lists[keep]) keep++;
    closeTo(keep);
    while (stack.length < depth) {
      const tag = it.lists[stack.length];
      out += `<${tag}>`;
      stack.push({ tag, liOpen: false });
    }
    const top = stack[stack.length - 1];
    if (top.liOpen) out += "</li>";
    out += `<li>${it.html}`;
    top.liOpen = true;
  });
  closeTo(0);
  return out;
}

// Redline one rich body: before → after, as display-only HTML with <del>/<ins>.
export function diffAgendaHtml(beforeHtml, afterHtml) {
  const before = sanitizeHtml(beforeHtml);
  const after = sanitizeHtml(afterHtml);
  if (before === after) return after;
  const bef = parseBlocks(before);
  const aft = parseBlocks(after);
  const out = [];
  let pi = 0;
  let pj = 0;
  [...lcsPairs(bef, aft), [bef.length, aft.length]].forEach(([i, j]) => {
    diffGap(bef.slice(pi, i), aft.slice(pj, j), out);
    if (i < bef.length) out.push({ kind: aft[j].kind, lists: aft[j].lists, html: aft[j].html });
    pi = i + 1;
    pj = j + 1;
  });
  return render(out);
}
