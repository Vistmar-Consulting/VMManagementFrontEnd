# Agenda Chat Creates Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agenda Chat may create a table in a topic body / Open Floor when the user asks; the review redline keeps a replaced list together.

**Architecture:** A second prompt rule (`CHAT_TABLE_RULES`) added only to Agenda Chat's system prompt; Sync Meeting / Refine / Generate untouched. `diffGap` in `agendaDiff.js` emits a whole gap as del-then-ins when a paired position mixes a table with a non-table (or two different-shape tables).

**Tech Stack:** Node serverless (Vercel `api/`), React, Vitest + jsdom.

Spec: `docs/superpowers/specs/2026-11-02-agenda-chat-tables-design.md`

---

### Task 1: `CHAT_TABLE_RULES` in Agenda Chat only

**Files:**
- Modify: `api/ai/_lib/htmlRules.js`
- Modify: `api/ai/_handlers/agendaChatTools.js:11,40,44`
- Test: `api/ai/_lib/__tests__/htmlRules.test.js`, `api/__tests__/chat.test.js`

- [ ] **Step 1: Failing tests.** In `htmlRules.test.js` import `CHAT_TABLE_RULES` and add:

```js
describe("CHAT_TABLE_RULES", () => {
  it("lets a table be created only on request", () => {
    expect(CHAT_TABLE_RULES).toMatch(/create a new table ONLY when the user explicitly asks/);
    expect(CHAT_TABLE_RULES).toMatch(/Never turn content into a table otherwise/);
  });

  it("is not in the Sync Meeting, Refine or Generate prompts", () => {
    expect(prepare.buildSystem("P", "working", cats, [], false, false, [])).not.toContain(CHAT_TABLE_RULES);
    expect(refine.buildSystem(cats, [], false, [])).not.toContain(CHAT_TABLE_RULES);
    expect(generate.buildSystem("P", "working", cats, [], false, false, [])).not.toContain(CHAT_TABLE_RULES);
  });
});
```

In `chat.test.js` `describe("Agenda Chat route")` add:

```js
it("only Agenda Chat's prompt carries the table-creation rule", async () => {
  const { CHAT_TABLE_RULES, BODY_HTML_RULES } = await import("../ai/_lib/htmlRules.js");
  const { AGENDA_CHAT_SYSTEM_PROMPT } = await import("../ai/_handlers/agendaChatTools.js");
  const { SYSTEM_PROMPT } = await import("../ai/_handlers/chatTools.js");
  expect(AGENDA_CHAT_SYSTEM_PROMPT).toContain(BODY_HTML_RULES);
  expect(AGENDA_CHAT_SYSTEM_PROMPT).toContain(CHAT_TABLE_RULES);
  expect(AGENDA_CHAT_SYSTEM_PROMPT).toMatch(/no tables in your reply text/);
  expect(SYSTEM_PROMPT).not.toContain(CHAT_TABLE_RULES);
});
```

- [ ] **Step 2:** `npx vitest run api/ai/_lib/__tests__/htmlRules.test.js api/__tests__/chat.test.js` → FAIL (`CHAT_TABLE_RULES` undefined).
- [ ] **Step 3: Implement.** Append to `htmlRules.js` the `CHAT_TABLE_RULES` export exactly as in spec §1 (with its comment). In `agendaChatTools.js`: import `{ BODY_HTML_RULES, CHAT_TABLE_RULES }`; after the line `- ${BODY_HTML_RULES}` add `- ${CHAT_TABLE_RULES}`; in the Style line change `no tables.` to `no tables in your reply text.`
- [ ] **Step 4:** re-run Step 2 command → PASS.
- [ ] **Step 5: Commit** `feat(agenda-chat): create a table when the user asks` (explicit pathspecs).

### Task 2: Redline keeps a replaced list together

**Files:**
- Modify: `src/lib/agendaDiff.js:154-160` (`diffGap`)
- Test: `src/lib/__tests__/agendaDiff.test.js`

- [ ] **Step 1: Failing tests** (after "shows a reshaped table…"):

```js
const TABLE = "<table><tbody><tr><th><p>Campaign</p></th><th><p>Spend</p></th></tr><tr><td><p>SF</p></td><td><p>$595</p></td></tr></tbody></table>";

it("shows a list replaced by a table as the whole list deleted, then the table", () => {
  const before = "<p>Campaign results</p><ul><li>SF: $595</li><li>Fremont: $412</li><li>Total: $2,486</li></ul>";
  const out = diffAgendaHtml(before, `<p>Campaign results</p>${TABLE}`);
  expect(marks(out, "del")).toEqual(["SF: $595", "Fremont: $412", "Total: $2,486"]);
  expect(out.indexOf("<table")).toBeGreaterThan(out.lastIndexOf("</del>"));
  expect([...body(out).querySelectorAll("table td, table th")].every((c) => c.querySelector("ins"))).toBe(true);
});

it("still word-diffs a paired paragraph when the table is a leftover insert", () => {
  const out = diffAgendaHtml("<p>Campaign results (Spend)</p>", `<p>Campaign results</p>${TABLE}`);
  expect(marks(out, "del").join(" ")).not.toMatch(/Campaign/);
  expect(marks(out, "del").join(" ")).toMatch(/Spend/);
  expect([...body(out).querySelectorAll("table td, table th")].every((c) => c.querySelector("ins"))).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run src/lib/__tests__/agendaDiff.test.js` → first new test FAILS (deleted bullets after table); second passes already (guards against regression).
- [ ] **Step 3: Implement** — replace `diffGap` with:

```js
// A paired position that mixes a table with a non-table (or two tables of
// different shapes) can't be shown in place, so the whole gap reads as the
// old blocks deleted, then the new ones inserted — a replaced list stays
// together instead of being split around the new table.
const tableMismatch = (b, a) =>
  (b.kind === "table") !== (a.kind === "table") || (b.kind === "table" && !sameShape(b, a));

function diffGap(before, after, out) {
  const k = Math.min(before.length, after.length);
  if (before.slice(0, k).some((b, x) => tableMismatch(b, after[x]))) {
    before.forEach((b) => out.push(wholeBlock(b, "del")));
    after.forEach((a) => out.push(wholeBlock(a, "ins")));
    return;
  }
  for (let x = 0; x < k; x++) pairChanged(before[x], after[x], out);
  before.slice(k).forEach((b) => out.push(wholeBlock(b, "del")));
  after.slice(k).forEach((a) => out.push(wholeBlock(a, "ins")));
}
```

Keep the existing comment above `diffGap` if one is there, merged with this one.
- [ ] **Step 4:** `npx vitest run src/lib/__tests__/agendaDiff.test.js src/lib/__tests__/syncMeeting.test.js` → all PASS.
- [ ] **Step 5: Commit** `fix(agenda): redline keeps a list replaced by a table together`.

### Task 3: AI Integration page

**Files:** Modify `src/pages/AIIntegration.jsx` ("Tables kept" row in `HOW_IT_WORKS`).

- [ ] **Step 1:** Replace the row's text with the spec §4 sentence.
- [ ] **Step 2: Commit** `docs(ai-integration): Agenda Chat creates tables on request`.

### Task 4: Full check, review, push, deployed verification

- [ ] `npm test` (full suite, alone — no parallel build) → all pass; then `npm run build` → succeeds.
- [ ] `superpowers:requesting-code-review` on the branch diff; address findings.
- [ ] `git pull --rebase origin dev && git push origin HEAD:dev`.
- [ ] Deployed verification (paid Agenda Chat call — quote cost to Andy first): ask Agenda Chat to make a list a table on a test topic; review diff shows list deleted then table inserted; Apply → real table; survives reload; rest of body unchanged.
