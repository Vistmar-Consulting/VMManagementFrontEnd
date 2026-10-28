# Sync Meeting — Tracked Changes + Editable Proposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Sync Meeting review, show a redline from the pre-sync agenda to the proposed agenda (Changes tab), and let the person edit topic bodies, Open Floor and new-topic titles before Apply (Edit tab).

**Architecture:** A pure, browser-side diff (`src/lib/agendaDiff.js`) lines up body blocks (paragraphs, list items, tables) by LCS and word-diffs paired blocks with `jsdiff`, producing display-only `<del>`/`<ins>` HTML. A new `ProposalReview` component renders the Changes/Edit tabs. Edits write into the dialog's existing `proposal` state, so Refine and Apply carry them unchanged. One Apply change: Open Floor is also written into its live Yjs fragment.

**Tech Stack:** React 18, MUI 5, TipTap 3 (`RichBodyEditor`), `diff` (jsdiff) 9.0.0, DOMPurify, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-27-sync-meeting-tracked-edits-design.md`. Read it first.

**Working directory:** `/Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd/.claude/worktrees/sync-meeting-tracked-edits` (branch `worktree-sync-meeting-tracked-edits`). Run every command from here. Never edit the main checkout.

**House rules that apply to every task:**
- Stage files with explicit paths, never `git add -A` or `git add .`.
- No `console.log`, no commented-out code.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run single test files, not the full suite, until Task 9. Other worktrees run in parallel on this machine.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json` | Modify | Add `diff@9.0.0` as an exact direct dependency |
| `src/lib/agendaHtml.js` | Modify | Export `escapeText`; add `sanitizeRedlineHtml` (allow-list + `del`/`ins`) |
| `src/lib/agendaDiff.js` | Create | `diffAgendaHtml` (block + word diff) and `buildAgendaRedline` (per-topic rows) |
| `src/lib/syncMeeting.js` | Modify | Add `changedOpenFloor` (pure helper for the Apply change) |
| `src/lib/aiAgenda.js` | Modify | `applyUnified` returns the changed Open Floor in `updatedBodies.openFloor` |
| `src/components/editor/topicBodyYjs.js` | Modify | Comment only: the keys include `"openFloor"` |
| `src/components/ProposalReview.jsx` | Create | Changes / Edit tabs for the proposed agenda |
| `src/components/SyncMeetingDialog.jsx` | Modify | Baseline snapshot, `proposalRev`, edit handlers, mount `ProposalReview`, blank-title gate |
| `src/pages/AIIntegration.jsx` | Modify | `HOW_IT_WORKS` rows |
| `src/lib/__tests__/agendaHtml.test.js` | Modify | Redline sanitizer tests |
| `src/lib/__tests__/agendaDiff.test.js` | Create | Diff + redline tests |
| `src/lib/__tests__/syncMeeting.test.js` | Modify | `changedOpenFloor` tests |
| `src/components/editor/__tests__/topicBodyYjs.test.js` | Modify | `"openFloor"` fragment write test |
| `src/components/__tests__/ProposalReview.test.jsx` | Create | Component tests (editor stubbed) |

---

### Task 1: Add `diff` as a direct dependency

The worktree's `node_modules` is a **symlink** to the main checkout's. Installing through it would change the main checkout's packages under other running sessions. Replace the symlink with a real install first.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Replace the symlink with a real install**

```bash
test -L node_modules && rm node_modules   # removes the symlink only, not its target
npm ci
```
Expected: `npm ci` finishes with "added N packages". `ls -ld node_modules` shows a directory, not `->`.

- [ ] **Step 2: Install `diff` pinned**

```bash
npm install --save-exact diff@9.0.0
grep '"diff"' package.json
```
Expected: `"diff": "9.0.0",` under `dependencies`.

- [ ] **Step 3: Confirm the import shape**

```bash
node --input-type=module -e "import { diffWords } from 'diff'; console.log(JSON.stringify(diffWords('Budget 2k', 'Budget 3k')))"
```
Expected: an array of `{ value, added, removed, count }` objects, with the removed `2k` and added `3k` as separate entries. If the shape differs, stop and report it. Task 3 depends on it.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add diff 9.0.0 for the Sync Meeting redline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Redline sanitizer

`sanitizeHtml` guards saved bodies and must keep stripping `del`/`ins`. Add a separate sanitizer for the read-only redline. Also export `escapeText` for `agendaDiff.js`.

**Files:**
- Modify: `src/lib/agendaHtml.js:7-26`
- Test: `src/lib/__tests__/agendaHtml.test.js`

- [ ] **Step 1: Write the failing tests**

Change the import line at the top of `src/lib/__tests__/agendaHtml.test.js` to:

```js
import { bulletsToHtml, sanitizeHtml, sanitizeRedlineHtml, escapeText, composeAgendaHtml, htmlToLines } from "../agendaHtml.js";
```

Append:

```js
describe("sanitizeRedlineHtml", () => {
  it("keeps del and ins", () => {
    expect(sanitizeRedlineHtml("<p>a <del>b</del> <ins>c</ins></p>")).toBe("<p>a <del>b</del> <ins>c</ins></p>");
  });

  it("still strips what sanitizeHtml strips", () => {
    expect(sanitizeRedlineHtml('<p>x</p><script>alert(1)</script><h2>t</h2>')).toBe("<p>x</p>t");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeRedlineHtml("")).toBe("");
  });
});

describe("sanitizeHtml and redline marks", () => {
  it("strips del and ins from saved bodies, keeping their text", () => {
    expect(sanitizeHtml("<p>a <del>b</del> <ins>c</ins></p>")).toBe("<p>a b c</p>");
  });
});

describe("escapeText", () => {
  it("escapes &, < and >", () => {
    expect(escapeText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: FAIL. `sanitizeRedlineHtml` and `escapeText` are not exported.

- [ ] **Step 3: Implement**

In `src/lib/agendaHtml.js`, change `function escapeText(s) {` to `export function escapeText(s) {`. Add after `sanitizeHtml`:

```js
// Display-only sanitizer for the Sync Meeting redline (agendaDiff.js output):
// the body allow-list plus del/ins. Never use it on anything that is saved —
// stored bodies go through sanitizeHtml, which strips the marks.
const REDLINE_TAGS = [...ALLOWED_TAGS, "del", "ins"];

export function sanitizeRedlineHtml(html) {
  if (!html) return "";
  return DOMPurify.sanitize(String(html), { ALLOWED_TAGS: REDLINE_TAGS, ALLOWED_ATTR, ADD_ATTR: ["target"] });
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/__tests__/agendaHtml.test.js`
Expected: PASS, all tests in the file. If the "still strips" expectation differs only in how DOMPurify handles the `<h2>` text, adjust the expected string to DOMPurify's actual output after confirming the `<h2>` tag and the `<script>` are both gone.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agendaHtml.js src/lib/__tests__/agendaHtml.test.js
git commit -m "feat(agenda-html): redline sanitizer that keeps del/ins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `diffAgendaHtml`

**Behaviour:**
- Blocks are top-level `p` (and stray text or inline nodes), each `li` (its own content without nested lists, keeping its list path for nesting), and `table`. Empty blocks are skipped.
- Blocks are matched by LCS on `kind + normalized text`.
- Unmatched blocks in the same gap are paired in order:
  - Paired text blocks are word-diffed if at least 30% of the longer text is unchanged. Otherwise the old block is shown deleted and the new one inserted.
  - Paired same-shape tables are diffed cell by cell. Different shapes show as the old table deleted and the new one inserted.
- Matched blocks keep the **after** side's inline markup. Changed blocks render as plain text plus marks (the spec's accepted risk).
- Equal input (after sanitizing) returns the sanitized after HTML unchanged.

**Files:**
- Create: `src/lib/agendaDiff.js`
- Test: `src/lib/__tests__/agendaDiff.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/agendaDiff.test.js`:

```js
import { describe, it, expect } from "vitest";
import { diffAgendaHtml } from "../agendaDiff.js";

const body = (html) => new DOMParser().parseFromString(html, "text/html").body;
const marks = (html, tag) => [...body(html).querySelectorAll(tag)].map((n) => n.textContent.trim());

describe("diffAgendaHtml", () => {
  it("returns equal input unchanged, markup included", () => {
    const html = "<p>Hi <strong>there</strong></p>";
    expect(diffAgendaHtml(html, html)).toBe(html);
  });

  it("word-diffs a changed bullet, leaving shared words unmarked", () => {
    const out = diffAgendaHtml("<ul><li>Budget raised to 2k</li></ul>", "<ul><li>Budget raised to 3k</li></ul>");
    expect(marks(out, "del").join(" ")).toMatch(/2k/);
    expect(marks(out, "ins").join(" ")).toMatch(/3k/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Budget/);
    expect(body(out).querySelectorAll("li")).toHaveLength(1);
  });

  it("marks an added bullet as inserted", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li></ul>", "<ul><li>Alpha item</li><li>Beta item</li></ul>");
    expect(marks(out, "ins")).toEqual(["Beta item"]);
    expect(marks(out, "del")).toEqual([]);
    expect(body(out).querySelectorAll("li")).toHaveLength(2);
  });

  it("marks a removed bullet as deleted", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li><li>Beta item</li></ul>", "<ul><li>Alpha item</li></ul>");
    expect(marks(out, "del")).toEqual(["Beta item"]);
    expect(marks(out, "ins")).toEqual([]);
  });

  it("shows an unrelated rewrite as whole delete + whole insert", () => {
    const out = diffAgendaHtml("<ul><li>Pause brand campaign</li></ul>", "<ul><li>Launch PMax test</li></ul>");
    expect(marks(out, "del")).toEqual(["Pause brand campaign"]);
    expect(marks(out, "ins")).toEqual(["Launch PMax test"]);
  });

  it("shows a reordered bullet as one delete and one insert of the same text", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li><li>Beta item</li></ul>", "<ul><li>Beta item</li><li>Alpha item</li></ul>");
    expect(marks(out, "del")).toHaveLength(1);
    expect(marks(out, "ins")).toHaveLength(1);
    expect(marks(out, "del")[0]).toBe(marks(out, "ins")[0]);
  });

  it("keeps nested lists nested", () => {
    const before = "<ul><li><p>Parent</p><ul><li><p>Child old words</p></li></ul></li></ul>";
    const after = "<ul><li><p>Parent</p><ul><li><p>Child new words</p></li></ul></li></ul>";
    const out = diffAgendaHtml(before, after);
    const child = body(out).querySelector("ul ul li");
    expect(child).not.toBeNull();
    expect(child.querySelector("del").textContent).toMatch(/old/);
    expect(child.querySelector("ins").textContent).toMatch(/new/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Parent/);
  });

  it("diffs a same-shape table cell by cell", () => {
    const t = (b) => `<table><tbody><tr><td><p>Owner</p></td><td><p>${b}</p></td></tr></tbody></table>`;
    const out = diffAgendaHtml(t("Andy old"), t("Andy new"));
    expect(body(out).querySelectorAll("table")).toHaveLength(1);
    expect(body(out).querySelectorAll("td")).toHaveLength(2);
    expect(marks(out, "del").join(" ")).toMatch(/old/);
    expect(marks(out, "ins").join(" ")).toMatch(/new/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Owner/);
  });

  it("shows a reshaped table as old table deleted + new table inserted", () => {
    const before = "<table><tbody><tr><td><p>A</p></td></tr></tbody></table>";
    const after = "<table><tbody><tr><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></tbody></table>";
    const out = diffAgendaHtml(before, after);
    const tables = body(out).querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect([...tables[0].querySelectorAll("td")].every((td) => td.querySelector("del"))).toBe(true);
    expect([...tables[1].querySelectorAll("td")].every((td) => td.querySelector("ins"))).toBe(true);
  });

  it("marks everything inserted when before is empty", () => {
    const out = diffAgendaHtml("", "<p>Homepage hero copy</p>");
    expect(marks(out, "ins")).toEqual(["Homepage hero copy"]);
  });

  it("marks everything deleted when after is empty", () => {
    const out = diffAgendaHtml("<p>Posts weekly</p>", "");
    expect(marks(out, "del")).toEqual(["Posts weekly"]);
  });

  it("returns empty string when both sides are empty", () => {
    expect(diffAgendaHtml("", "")).toBe("");
  });

  it("keeps inline markup on unchanged blocks", () => {
    const out = diffAgendaHtml("<p><strong>Keep</strong></p><p>Old words here</p>", "<p><strong>Keep</strong></p><p>New words here</p>");
    expect(out).toContain("<strong>Keep</strong>");
  });

  it("escapes text in changed blocks", () => {
    const out = diffAgendaHtml("<p>a &lt;b&gt; one</p>", "<p>a &lt;b&gt; two</p>");
    expect(body(out).querySelector("b")).toBeNull();
    expect(body(out).textContent).toContain("<b>");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/agendaDiff.test.js`
Expected: FAIL. Cannot find module `../agendaDiff.js`.

- [ ] **Step 3: Implement**

Create `src/lib/agendaDiff.js`:

```js
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
    closeTo(depth);
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
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/__tests__/agendaDiff.test.js`
Expected: PASS, 14 tests. If a test fails, fix the implementation, not the expectation, unless the expectation contradicts the behaviour section above. Report any expectation you changed and why.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agendaDiff.js src/lib/__tests__/agendaDiff.test.js
git commit -m "feat(sync-meeting): diffAgendaHtml block + word redline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `buildAgendaRedline`

Per-topic rows for the Changes tab:
- `retained`: diffed against the pre-sync body.
- `new`: fully inserted.
- `dropped`: only topics present in the pre-sync snapshot, fully deleted.
- `openFloor`: always last.

Statuses come from `classifyTopicChanges` against the **live** topics, the same source Apply uses.

**Files:**
- Modify: `src/lib/agendaDiff.js`
- Test: `src/lib/__tests__/agendaDiff.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/agendaDiff.test.js`, change the import to `import { diffAgendaHtml, buildAgendaRedline } from "../agendaDiff.js";` and append:

```js
describe("buildAgendaRedline", () => {
  const prevTopics = [
    { id: "A", name: "Google Ads", bodyHtml: "<ul><li>Budget raised to 2k</li></ul>" },
    { id: "B", name: "GBP", bodyHtml: "<p>Posts weekly</p>" },
  ];
  const proposal = {
    topics: [
      { topicId: "t0", ref: "A", name: "Ignored AI title", bodyHtml: "<ul><li>Budget raised to 3k</li></ul>" },
      { topicId: "t1", ref: "", name: "Website", bodyHtml: "<p>Homepage hero copy</p>" },
    ],
    openFloorHtml: "<p>Any other business</p>",
  };

  it("builds retained, new, dropped and Open Floor rows in order", () => {
    const rows = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "", topics: prevTopics, proposal });
    expect(rows.map((r) => r.kind)).toEqual(["retained", "new", "dropped", "openFloor"]);
  });

  it("names a retained topic by its live (locked) name and diffs its body", () => {
    const [retained] = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "", topics: prevTopics, proposal });
    expect(retained).toMatchObject({ topicId: "A", name: "Google Ads" });
    expect(marks(retained.html, "ins").join(" ")).toMatch(/3k/);
  });

  it("shows a new topic fully inserted", () => {
    const rows = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "", topics: prevTopics, proposal });
    expect(rows[1]).toMatchObject({ kind: "new", name: "Website" });
    expect(marks(rows[1].html, "ins")).toEqual(["Homepage hero copy"]);
  });

  it("shows a dropped pre-sync topic fully deleted", () => {
    const rows = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "", topics: prevTopics, proposal });
    expect(rows[2]).toMatchObject({ kind: "dropped", topicId: "B", name: "GBP" });
    expect(marks(rows[2].html, "del")).toEqual(["Posts weekly"]);
  });

  it("does not list a topic added during review as dropped", () => {
    const live = [...prevTopics, { id: "C", name: "Added later", bodyHtml: "<p>x</p>" }];
    const rows = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "", topics: live, proposal });
    expect(rows.filter((r) => r.kind === "dropped").map((r) => r.topicId)).toEqual(["B"]);
  });

  it("diffs Open Floor against the pre-sync Open Floor", () => {
    const rows = buildAgendaRedline({ prevTopics, prevOpenFloorHtml: "<p>Any other business</p>", topics: prevTopics, proposal });
    expect(rows[rows.length - 1]).toMatchObject({ kind: "openFloor", html: "<p>Any other business</p>" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/agendaDiff.test.js`
Expected: FAIL. `buildAgendaRedline` is not a function.

- [ ] **Step 3: Implement**

In `src/lib/agendaDiff.js`, add to the imports:

```js
import { classifyTopicChanges } from "./syncMeeting.js";
```

Append:

```js
// Rows for the Changes tab, in display order: each proposal topic (retained →
// diffed against its pre-sync body; new → fully inserted), then pre-sync topics
// the proposal omits (fully deleted), then Open Floor. Statuses come from the
// LIVE topics, as Apply's do; bodies diff against the mount-time snapshot.
// A topic added during review is not in prevTopics, so it is never "dropped".
export function buildAgendaRedline({ prevTopics, prevOpenFloorHtml, topics, proposal }) {
  const prevById = new Map((prevTopics || []).map((t) => [t.id, t]));
  const liveById = new Map((topics || []).map((t) => [t.id, t]));
  const proposed = proposal?.topics || [];
  const { statuses, dropped } = classifyTopicChanges(topics, proposed);
  const rows = proposed.map((t, i) =>
    statuses[i] === "retained"
      ? { kind: "retained", topicId: t.ref, name: liveById.get(t.ref)?.name || "", html: diffAgendaHtml(prevById.get(t.ref)?.bodyHtml || "", t.bodyHtml) }
      : { kind: "new", name: t.name || "", html: diffAgendaHtml("", t.bodyHtml) },
  );
  dropped
    .filter((d) => prevById.has(d.id))
    .forEach((d) => rows.push({ kind: "dropped", topicId: d.id, name: d.name, html: diffAgendaHtml(prevById.get(d.id).bodyHtml, "") }));
  rows.push({ kind: "openFloor", name: "Open Floor", html: diffAgendaHtml(prevOpenFloorHtml, proposal?.openFloorHtml) });
  return rows;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/lib/__tests__/agendaDiff.test.js src/lib/__tests__/syncMeeting.test.js`
Expected: PASS for both files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agendaDiff.js src/lib/__tests__/agendaDiff.test.js
git commit -m "feat(sync-meeting): buildAgendaRedline per-topic rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Apply writes Open Floor into its live fragment

**Root cause being fixed:** `applyUnified` writes `openFloorHtml` to Firestore only. The `"openFloor"` Yjs fragment wins once it has content, so the old text stays live. `writeTopicBodies` already writes any key it is given (`ydoc.get(key, Y.XmlFragment)`), so the fix is to return the changed Open Floor under `"openFloor"`.

**Files:**
- Modify: `src/lib/syncMeeting.js` (new helper)
- Modify: `src/lib/aiAgenda.js` (reads phase in `runTransaction`, ~line 567; writes phase ~line 580–601; comment at ~line 487)
- Modify: `src/components/editor/topicBodyYjs.js:10-11` (comment)
- Test: `src/lib/__tests__/syncMeeting.test.js`, `src/components/editor/__tests__/topicBodyYjs.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/syncMeeting.test.js`, add `changedOpenFloor` to the existing import from `../syncMeeting.js` and append:

```js
describe("changedOpenFloor", () => {
  it("returns null when Open Floor is unchanged", () => {
    expect(changedOpenFloor("<p>Same</p>", "<p>Same</p>")).toBeNull();
  });

  it("returns null when the only difference is something the sanitizer strips", () => {
    expect(changedOpenFloor("<p>Same</p>", "<p>Same</p><script>x</script>")).toBeNull();
  });

  it("returns the sanitized proposal text when it changed", () => {
    expect(changedOpenFloor("<p>Old</p>", "<p>New</p><script>x</script>")).toBe("<p>New</p>");
  });

  it("treats missing values as empty", () => {
    expect(changedOpenFloor(undefined, "")).toBeNull();
    expect(changedOpenFloor(undefined, "<p>New</p>")).toBe("<p>New</p>");
  });
});
```

In `src/components/editor/__tests__/topicBodyYjs.test.js`, append inside the `describe("writeTopicBodies", …)` block:

```js
  it("writes Open Floor into the openFloor fragment, as CollabBodyEditor binds it", () => {
    const ydoc = withBodies(["openFloor"]);
    writeTopicBodies(ydoc, { openFloor: "<p>Any other business</p>" });
    expect(xml(ydoc, "openFloor")).toBe("<paragraph>Any other business</paragraph>");
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js src/components/editor/__tests__/topicBodyYjs.test.js`
Expected: `syncMeeting.test.js` FAILS (`changedOpenFloor` is not a function). The new `topicBodyYjs` test PASSES already, which confirms `writeTopicBodies` needs no code change.

- [ ] **Step 3: Implement the helper**

In `src/lib/syncMeeting.js`, add after the existing import:

```js
import { sanitizeHtml } from "./agendaHtml.js";
```

Append:

```js
// Open Floor body for the live-fragment write at apply: the sanitized proposal
// text when it differs from the agenda's current Open Floor, else null (an
// unchanged Open Floor is left alone, so edits made in the room survive).
export function changedOpenFloor(currentHtml, proposedHtml) {
  const next = sanitizeHtml(proposedHtml || "");
  return next === sanitizeHtml(currentHtml || "") ? null : next;
}
```

- [ ] **Step 4: Wire it into `applyUnified`**

In `src/lib/aiAgenda.js`:

1. Add `changedOpenFloor` to the existing import from `./syncMeeting.js` (find it with `grep -n "syncMeeting.js" src/lib/aiAgenda.js`).
2. Replace the comment above `let updatedBodies = {};` (~line 487):

```js
  // Fragment key → the body written to Firestore: retained topic ids, plus
  // "openFloor" when it changed. Returned so the caller can write the same
  // bodies into the live Yjs fragments.
```

3. In the transaction's READS PHASE, directly after the line `// ---- READS PHASE (all tx.get before any write) ----`, add:

```js
    const agendaSnap = await tx.get(doc(db, "agendas", agendaId));
```

4. In the WRITES PHASE, replace the agenda update block:

```js
    // Agenda doc: open floor + the anchor (advances only here).
    tx.update(doc(db, "agendas", agendaId), {
      openFloorHtml: sanitizeHtml(proposal.openFloorHtml || ""),
```

with:

```js
    // Agenda doc: open floor + the anchor (advances only here). A changed Open
    // Floor also goes to its live fragment, which wins over Firestore once it
    // has content.
    const nextOpenFloor = changedOpenFloor(agendaSnap.data()?.openFloorHtml, proposal.openFloorHtml);
    if (nextOpenFloor !== null) updatedBodies.openFloor = nextOpenFloor;
    tx.update(doc(db, "agendas", agendaId), {
      openFloorHtml: sanitizeHtml(proposal.openFloorHtml || ""),
```

Leave the remaining fields of that `tx.update` unchanged. This block runs after `updatedBodies = {};` (the per-attempt reset). Confirm that order by reading the code.

5. In `src/components/editor/topicBodyYjs.js`, change the first comment line from `// Write topic bodies straight into the agenda room's Yjs doc, replacing each` / `// fragment's content (fragment key = topic id, as CollabBodyEditor binds it).` to:

```js
// Write topic bodies straight into the agenda room's Yjs doc, replacing each
// fragment's content (fragment key = topic id or "openFloor", as
// CollabBodyEditor binds it).
```

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js src/components/editor/__tests__/topicBodyYjs.test.js`
Expected: PASS for both. `applyUnified` has no unit tests (it needs Firestore). Its wiring is checked live in Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/lib/syncMeeting.js src/lib/aiAgenda.js src/components/editor/topicBodyYjs.js src/lib/__tests__/syncMeeting.test.js src/components/editor/__tests__/topicBodyYjs.test.js
git commit -m "fix(sync-meeting): Apply writes changed Open Floor into its live fragment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ProposalReview` component

**Files:**
- Create: `src/components/ProposalReview.jsx`
- Test: `src/components/__tests__/ProposalReview.test.jsx`

`RichBodyEditor` is stubbed in the test with a textarea. That tests this component's wiring: which edit goes to which topic. Real typing in TipTap is checked in the browser (Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/ProposalReview.test.jsx`:

```jsx
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

vi.mock("../editor/RichBodyEditor.jsx", () => ({
  default: ({ valueHtml, onChangeHtml }) => (
    <textarea data-testid="body-editor" defaultValue={valueHtml} onChange={(e) => onChangeHtml(e.target.value)} />
  ),
}));

const { default: ProposalReview } = await import("../ProposalReview.jsx");

const prevTopics = [
  { id: "A", name: "Google Ads", bodyHtml: "<ul><li>Budget raised to 2k</li><li>Pause brand campaign</li></ul>" },
  { id: "B", name: "GBP", bodyHtml: "<p>Posts weekly</p>" },
];
const proposal = {
  topics: [
    { topicId: "t0", ref: "A", name: "Google Ads", bodyHtml: "<ul><li>Budget raised to 3k</li><li>Launch PMax test</li></ul>" },
    { topicId: "t1", ref: "", name: "Website", bodyHtml: "<p>Homepage hero copy</p>" },
  ],
  openFloorHtml: "<p>Any other business</p>",
};

function setup(overrides = {}) {
  const onTopicChange = vi.fn();
  const onOpenFloorChange = vi.fn();
  const utils = render(
    <ThemeProvider theme={createTheme()}>
      <ProposalReview
        prevTopics={prevTopics}
        prevOpenFloorHtml=""
        topics={prevTopics}
        proposal={proposal}
        statuses={["retained", "new"]}
        rev={1}
        onTopicChange={onTopicChange}
        onOpenFloorChange={onOpenFloorChange}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { ...utils, onTopicChange, onOpenFloorChange };
}

const texts = (container, tag) => [...container.querySelectorAll(tag)].map((n) => n.textContent.trim());

describe("ProposalReview", () => {
  it("opens on Changes, showing deletions and insertions against the pre-sync agenda", () => {
    const { container } = setup();
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(texts(container, "del")).toEqual(expect.arrayContaining(["Pause brand campaign", "GBP", "Posts weekly"]));
    expect(texts(container, "ins")).toEqual(expect.arrayContaining(["Launch PMax test", "Website", "Homepage hero copy", "Any other business"]));
  });

  it("Edit tab: retained title is locked text, new title is a field", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    const fields = screen.getAllByLabelText("New topic title");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveValue("Website");
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
  });

  it("Edit tab: title and body edits report the right topic index", () => {
    const { onTopicChange, onOpenFloorChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("New topic title"), { target: { value: "Site" } });
    expect(onTopicChange).toHaveBeenCalledWith(1, { name: "Site" });
    const editors = screen.getAllByTestId("body-editor");
    expect(editors).toHaveLength(3); // two topics + Open Floor
    fireEvent.change(editors[0], { target: { value: "<p>edited</p>" } });
    expect(onTopicChange).toHaveBeenCalledWith(0, { bodyHtml: "<p>edited</p>" });
    fireEvent.change(editors[2], { target: { value: "<p>of</p>" } });
    expect(onOpenFloorChange).toHaveBeenCalledWith("<p>of</p>");
  });

  it("an edit fed back into the proposal shows as an insertion on Changes", () => {
    function Stateful() {
      const [prop, setProp] = useState(proposal);
      return (
        <ProposalReview
          prevTopics={prevTopics}
          prevOpenFloorHtml=""
          topics={prevTopics}
          proposal={prop}
          statuses={["retained", "new"]}
          rev={1}
          onTopicChange={(i, patch) => setProp((p) => ({ ...p, topics: p.topics.map((tp, j) => (j === i ? { ...tp, ...patch } : tp)) }))}
          onOpenFloorChange={(html) => setProp((p) => ({ ...p, openFloorHtml: html }))}
        />
      );
    }
    const { container } = render(<ThemeProvider theme={createTheme()}><Stateful /></ThemeProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getAllByTestId("body-editor")[0], {
      target: { value: "<ul><li>Budget raised to 3k</li><li>Launch PMax test</li><li>Zebra phrase added</li></ul>" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(texts(container, "ins")).toContain("Zebra phrase added");
  });

  it("flags a blank new-topic title", () => {
    const blank = { ...proposal, topics: [proposal.topics[0], { ...proposal.topics[1], name: "  " }] };
    setup({ proposal: blank });
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByText("A new topic needs a title")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/components/__tests__/ProposalReview.test.jsx`
Expected: FAIL. Cannot find module `../ProposalReview.jsx`.

- [ ] **Step 3: Implement**

Create `src/components/ProposalReview.jsx`:

```jsx
// Proposed-agenda review for Sync Meeting. Changes = read-only redline against
// the agenda as it was when the dialog opened; Edit = the proposal itself,
// editable (topic bodies, Open Floor, new-topic titles — retained titles stay
// locked, as Apply keeps them). Edits go up through onTopicChange /
// onOpenFloorChange into the dialog's proposal, so Refine and Apply see them.
import { useMemo, useState } from "react";
import { Box, Tab, Tabs, TextField, Typography } from "@mui/material";
import RichBodyEditor from "./editor/RichBodyEditor.jsx";
import { buildAgendaRedline } from "../lib/agendaDiff.js";
import { sanitizeRedlineHtml } from "../lib/agendaHtml.js";
import { t } from "../theme/tokens.js";

const BOX_SX = { border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2, overflow: "auto" };

const REDLINE_SX = {
  fontSize: 13,
  lineHeight: 1.4,
  "& ul, & ol": { pl: 3, m: 0 },
  "& li": { mb: 0.3 },
  "& li p": { m: 0 },
  "& table": { borderCollapse: "collapse", width: "100%", my: 0.75 },
  "& th, & td": { border: "1px solid", borderColor: "divider", p: "4px 6px", verticalAlign: "top" },
  "& td p, & th p": { m: 0 },
  "& del": { color: t.red, textDecoration: "line-through" },
  "& ins": { color: t.green, textDecoration: "none", backgroundColor: `${t.green}1f` },
};

const CAPTION = {
  new: "New topic",
  dropped: "AI suggests removing — kept unless you check Delete above",
};

function RedlineHeading({ row }) {
  const name = row.name || "(untitled)";
  return (
    <Typography variant="subtitle2" sx={{ fontSize: 15, fontWeight: 700 }}>
      {row.kind === "new" ? <ins>{name}</ins> : row.kind === "dropped" ? <del>{name}</del> : name}
    </Typography>
  );
}

export default function ProposalReview({
  prevTopics,
  prevOpenFloorHtml,
  topics,
  proposal,
  statuses,
  rev,
  onTopicChange,
  onOpenFloorChange,
}) {
  const [tab, setTab] = useState("changes");
  const redline = useMemo(
    () => (tab === "changes" ? buildAgendaRedline({ prevTopics, prevOpenFloorHtml, topics, proposal }) : []),
    [tab, prevTopics, prevOpenFloorHtml, topics, proposal],
  );
  const liveName = new Map((topics || []).map((tp) => [tp.id, tp.name || ""]));

  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, mb: 1 }}>
        <Tab value="changes" label="Changes" sx={{ minHeight: 36 }} />
        <Tab value="edit" label="Edit" sx={{ minHeight: 36 }} />
      </Tabs>

      {tab === "changes" ? (
        <Box sx={{ ...BOX_SX, ...REDLINE_SX, maxHeight: 360 }}>
          {redline
            .filter((row) => row.kind !== "openFloor" || row.html)
            .map((row, i) => (
              <Box key={i} component="section" sx={{ mb: 1.5 }}>
                <RedlineHeading row={row} />
                {CAPTION[row.kind] && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                    {CAPTION[row.kind]}
                  </Typography>
                )}
                <Box dangerouslySetInnerHTML={{ __html: sanitizeRedlineHtml(row.html) || "<em>Empty</em>" }} />
              </Box>
            ))}
        </Box>
      ) : (
        <Box sx={{ ...BOX_SX, maxHeight: 520 }}>
          {(proposal.topics || []).map((tp, i) => {
            const blank = !String(tp.name || "").trim();
            return (
              <Box key={`${rev}-${i}`} sx={{ mb: 2 }}>
                {statuses[i] === "retained" ? (
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {liveName.get(tp.ref) || "(untitled)"}
                  </Typography>
                ) : (
                  <TextField
                    size="small"
                    fullWidth
                    label="New topic title"
                    value={tp.name || ""}
                    onChange={(e) => onTopicChange(i, { name: e.target.value })}
                    error={blank}
                    helperText={blank ? "A new topic needs a title" : " "}
                    sx={{ mb: 0.5 }}
                  />
                )}
                <RichBodyEditor
                  valueHtml={tp.bodyHtml || ""}
                  onChangeHtml={(html) => onTopicChange(i, { bodyHtml: html })}
                  debounceMs={0}
                />
              </Box>
            );
          })}
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Open Floor</Typography>
          <RichBodyEditor
            key={`${rev}-openFloor`}
            valueHtml={proposal.openFloorHtml || ""}
            onChangeHtml={onOpenFloorChange}
            debounceMs={0}
          />
        </Box>
      )}
    </Box>
  );
}
```

Before finishing, check how `src/components/SyncMeetingDialog.jsx` imports MUI (the `import {` block at the top). If it imports per-component paths (`@mui/material/Box`) rather than from `@mui/material`, match that style here.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run src/components/__tests__/ProposalReview.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProposalReview.jsx src/components/__tests__/ProposalReview.test.jsx
git commit -m "feat(sync-meeting): ProposalReview Changes/Edit tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire `ProposalReview` into `SyncMeetingDialog`

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

`SyncMeetingDialog` has no component test. Its prepare flow needs the live AI and Firestore. This wiring is verified by the build (Task 9 Step 2) and the browser (Task 9 Step 4).

- [ ] **Step 1: Imports**

Add after `import ProposedBoardRow from "./ProposedBoardRow.jsx";`:

```js
import ProposalReview from "./ProposalReview.jsx";
```

- [ ] **Step 2: Baseline, revision and topic-status state**

Directly after `const [prevTopicsSnapshot] = useState(() => topics || []);` add:

```js
  // Pre-sync Open Floor, captured with the topics — the redline's baseline.
  const [prevOpenFloorHtml] = useState(() => agenda?.openFloorHtml || "");
  // Bumped on every prepare/refine result so the Edit tab's editors remount
  // with the new proposal's content.
  const [proposalRev, setProposalRev] = useState(0);
```

Delete the now-unused memo:

```js
  const previewHtml = useMemo(
    () => (proposal ? composeAgendaHtml(proposal, proposal.topics || []) : ""),
    [proposal],
  );
```

(`composeAgendaHtml` stays imported. `oldAgendaHtml` still uses it.)

After the `oldAgendaHtml` memo, add:

```js
  // Proposal topics vs the LIVE agenda — what Apply writes against. Drives the
  // chips, the Delete boxes, the Edit tab's title-lock and the blank-title gate.
  const topicChanges = useMemo(() => {
    if (!proposal) return { statuses: [], droppedShown: [] };
    const { statuses, dropped } = classifyTopicChanges(topics, proposal.topics || []);
    // Only topics the AI was shown can be "suggested for removal"; one added
    // after the sync started is simply kept.
    const shownIds = new Set(prevTopicsSnapshot.map((tp) => tp.id));
    return { statuses, droppedShown: dropped.filter((d) => shownIds.has(d.id)) };
  }, [topics, proposal, prevTopicsSnapshot]);
  const blankNewTitle = (proposal?.topics || []).some(
    (tp, i) => topicChanges.statuses[i] === "new" && !String(tp.name || "").trim(),
  );

  // Review edits write straight into the proposal, so Refine and Apply carry them.
  const setTopicField = (i, patch) => setProposal((prev) => ({
    ...prev,
    topics: (prev.topics || []).map((tp, j) => (j === i ? { ...tp, ...patch } : tp)),
  }));
  const setOpenFloorHtml = (html) => setProposal((prev) => ({ ...prev, openFloorHtml: html }));
```

- [ ] **Step 3: Bump the revision on prepare and refine**

In `generate`, after `setProposal(normalized);` add `setProposalRev((r) => r + 1);`.
In `refine`, after `setProposal(merged);` add `setProposalRev((r) => r + 1);`.

- [ ] **Step 4: Use `topicChanges` in the chips block**

In the review JSX, replace these lines at the top of the IIFE:

```js
              const { statuses, dropped: omitted } = classifyTopicChanges(topics, proposal.topics || []);
              // Only topics the AI was shown can be "suggested for removal"; one
              // added after the sync started is simply kept.
              const shownIds = new Set(prevTopicsSnapshot.map((t) => t.id));
              const dropped = omitted.filter((d) => shownIds.has(d.id));
```

with:

```js
              const { statuses, droppedShown: dropped } = topicChanges;
```

- [ ] **Step 5: Replace the preview box**

Replace:

```jsx
            <Box
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2,
                maxHeight: 360, overflow: "auto", fontSize: 13, lineHeight: 1.4,
                "& h2": { fontSize: 15, fontWeight: 700, mt: 2, mb: 0.5 },
                "& ul, & ol": { pl: 3, m: 0 }, "& li": { mb: 0.3 }, "& li p": { m: 0 },
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml || "<em>Empty proposal</em>" }}
            />
```

with:

```jsx
            <ProposalReview
              prevTopics={prevTopicsSnapshot}
              prevOpenFloorHtml={prevOpenFloorHtml}
              topics={topics}
              proposal={proposal}
              statuses={topicChanges.statuses}
              rev={proposalRev}
              onTopicChange={setTopicField}
              onOpenFloorChange={setOpenFloorHtml}
            />
```

Change the heading text `Proposed agenda — review before applying` to `Proposed agenda — review and edit before applying`.

- [ ] **Step 6: Gate Apply on blank new-topic titles**

In `DialogActions`, replace the review-step Apply button:

```jsx
          <Button variant="contained" onClick={apply} disabled={busy || refining || applied}>
            {busy ? "Applying…" : "Apply"}
          </Button>
```

with the version below. It adds `blankNewTitle` to `disabled`, plus a caption so the grey button is explained on either tab:

```jsx
          <>
            {blankNewTitle && (
              <Typography variant="caption" color="error" sx={{ mr: 1 }}>
                A new topic needs a title (Edit tab)
              </Typography>
            )}
            <Button variant="contained" onClick={apply} disabled={busy || refining || applied || blankNewTitle}>
              {busy ? "Applying…" : "Apply"}
            </Button>
          </>
```

- [ ] **Step 7: Check nothing else references removed names**

Run: `grep -n "previewHtml\|shownIds\|omitted" src/components/SyncMeetingDialog.jsx`
Expected: `previewHtml` returns no matches. `omitted` may still appear in `apply`'s `omittedIds`, which is unrelated and stays. `shownIds` appears only inside the new `topicChanges` memo.

- [ ] **Step 8: Run related tests**

Run: `npx vitest run src/components/__tests__/ProposalReview.test.jsx src/lib/__tests__/syncMeeting.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync-meeting): review shows redline + editable proposal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: AI Integration page

CLAUDE.md rule 4: Sync Meeting workflow changes update `HOW_IT_WORKS`.

**Files:**
- Modify: `src/pages/AIIntegration.jsx` (the `"Safe to run"` group, ~line 99)

- [ ] **Step 1: Edit the rows**

In the `"Safe to run"` group, after the `["Review before apply", …]` row, add:

```js
      ["Edit before you apply", "The review shows the proposed agenda as a redline against the agenda before the sync: struck-through text is removed, highlighted text is added. The Edit tab lets you change any topic's text, Open Floor and new topics' titles before Apply; continuing topics keep their titles. Refine works on your edited version. The redline and editing never call the AI."],
```

In the `["Topics are never deleted by a sync", …]` row, change `Apply updates continuing topics in place and writes their new text straight into the live editor` to `Apply updates continuing topics and Open Floor in place and writes their new text straight into the live editor`.

- [ ] **Step 2: Commit**

```bash
git add src/pages/AIIntegration.jsx
git commit -m "docs(ai-integration): Sync Meeting redline + edit rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify

- [ ] **Step 1: Full test suite**

Run: `npx vitest run --testTimeout=15000`
Expected: all files pass. Three slow tests (`TaskBoard.expandAll`, `NewMeetingDialog.attendees`) are known to exceed 5s on a loaded machine; the 15s timeout covers them. Report any other failure verbatim. Do not retry until green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: completes with no errors. Do not run it at the same time as Step 1.

- [ ] **Step 3: Ask before the paid call**

A fresh proposal needs one live `/api/ai/prepare` call: about **$0.54** on Opus 5.5 fast, ~35–60s. Each Refine is another paid call. Ask Andy which agenda to use and get an explicit go-ahead with that price before Step 4. Do not proceed without it.

- [ ] **Step 4: Browser check (CLAUDE.md rule 3; `agent-browser` with its dedicated profile; dev server on port 5173)**

On the approved agenda:
1. Open Sync Meeting → Generate. In the review, Changes is selected and shows strikes/insertions. New topics are inserted, and AI-suggested removals are struck with the caption.
2. Edit tab: a retained title is plain text. A new title is a field, and clearing it disables Apply with "A new topic needs a title".
3. Type a distinctive phrase into one topic body and into Open Floor. Use Cmd+Z once to confirm undo works, then retype. Switch to Changes: both phrases show as insertions.
4. Apply. Reload the agenda. Both phrases are in the live editor, the topic body **and** Open Floor, identical after a second reload.
5. Screenshots go to the session scratchpad, never the repo.

- [ ] **Step 5: Session context**

Update `dev/sessions/v0_4_20_Andrew_SYNC_TRACKED_EDITS/context.md`: what shipped, what was verified (commands + results), what was not, and the live run's cost. Note that this worktree has its own `node_modules` (not the usual symlink), and that the main checkout needs `npm install` after merge to pick up `diff`. Under Risks, add: adjacent separate lists at the same depth render as one list in the redline (display only). Commit it:

```bash
git add dev/sessions/v0_4_20_Andrew_SYNC_TRACKED_EDITS/context.md
git commit -m "docs(session): Sync Meeting tracked edits verified

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Leftovers**

Run: `git status --short`. The tree should be clean, and the repo root should hold no new files.
