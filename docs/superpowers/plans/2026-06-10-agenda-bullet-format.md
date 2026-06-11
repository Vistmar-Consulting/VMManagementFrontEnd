# Agenda Bullet Format Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bullet format guide to the Sync Meeting AI system prompt so generated agenda topic bodies follow the `item text — Person, Status (M/D)` pattern instead of the current `**Owner**: info` style.

**Architecture:** Pure prompt injection — no schema, UI, data model, or test changes. A `bulletFormatBlock` variable is added to `buildSystem()` in both `api/ai/prepare.js` and `api/ai/refine.js`; it evaluates to the format guide when `master` is false and to `""` when `master` is true (master Touch Base is excluded per spec).

**Tech Stack:** Node.js serverless functions (Vercel), Anthropic Claude API. No new dependencies.

> **Note on TDD:** This change has no unit-testable logic — it is a plain string constant injected into a prompt. The verification step is behavioral: run Sync Meeting in the browser and read the generated bullets.

---

## Files

| File | Change |
|---|---|
| `api/ai/prepare.js` | Add `bulletFormatBlock` to `buildSystem()`, interpolate after TOPIC IDENTITY block |
| `api/ai/refine.js` | Add `bulletFormatBlock` to `buildSystem()`, interpolate after HTML rules line |

---

### Task 1: Add bullet format block to `api/ai/prepare.js`

**Files:**
- Modify: `api/ai/prepare.js` — `buildSystem()` function

The `buildSystem()` function lives at the top of the file and returns a large template literal. The TOPIC IDENTITY paragraph ends with the sentence `"...You may reorder topics and you may omit a topic whose work is fully complete."` followed immediately by `\n\n## Board changes output (boardChanges)\n`. Insert `${bulletFormatBlock}` between those two.

- [ ] **Step 1: Add the `bulletFormatBlock` variable**

At the top of `buildSystem()` (before the `const filled = ...` line), add:

```js
const bulletFormatBlock = !master ? `\n\n## Bullet format within topic bodies
Write each bullet as:  item text — Person, Status (M/D)
Rules:
- Person: include the owner's name when it is non-obvious. Exception: content-social category topics — omit the person name entirely.
- Status: include only when it meaningfully qualifies the item (e.g., "In Review", "Blocked", "Done", or content workflow phases like "outline", "draft", "published"). The content workflow phases list is non-exhaustive — other reasonable phases (e.g. "scheduled", "awaiting approval") are also acceptable.
- Date: include only when a specific date was explicitly discussed. Short M/D format in parens, always last.
- Person and Status may appear together or alone.
- Omit the — entirely when there is no metadata.
- Note: "In Review" and "Blocked" are display labels for the agenda — they are not the same as board status values ("Review", "Pending") and the difference is intentional.

Examples:
• Google Business Profile audit complete
• Provider directory redesign — Hugo (6/15)
• Homepage hero — Cedric, In Review
• Q3 blog post — outline` : "";
```

- [ ] **Step 2: Interpolate `${bulletFormatBlock}` in the return template literal**

Find this exact text in the return value of `buildSystem()`:

```
You may reorder topics and you may omit a topic whose work is fully complete.

## Board changes output (boardChanges)
```

Change it to:

```
You may reorder topics and you may omit a topic whose work is fully complete.${bulletFormatBlock}

## Board changes output (boardChanges)
```

- [ ] **Step 3: Verify the change looks correct**

Read back `api/ai/prepare.js` and confirm:
- `bulletFormatBlock` is declared at the top of `buildSystem()` before `const filled`
- `${bulletFormatBlock}` is interpolated directly after the TOPIC IDENTITY sentence
- The `## Board changes output` heading still follows on the next line with a blank line separator (from the `\n\n` prefix on the block)
- Nothing else changed

- [ ] **Step 4: Commit**

```bash
git add api/ai/prepare.js
git commit -m "feat(sync-meeting): add bullet format guide to prepare.js system prompt"
```

---

### Task 2: Add bullet format block to `api/ai/refine.js`

**Files:**
- Modify: `api/ai/refine.js` — `buildSystem()` function

`refine.js`'s `buildSystem()` returns a single template literal. The HTML rules line (`HTML rules: use ONLY these tags...`) is followed immediately by the `${master ? ...}` master conditional interpolation. Insert `${bulletFormatBlock}` between those two.

- [ ] **Step 1: Add the `bulletFormatBlock` variable**

`buildSystem()` in `refine.js` has no local variables — the function body is just a `return` statement. Insert `const bulletFormatBlock = ...` as the first line inside the function body, immediately before the `return` keyword:

```js
const bulletFormatBlock = !master ? `\n\n## Bullet format within topic bodies
Write each bullet as:  item text — Person, Status (M/D)
Rules:
- Person: include the owner's name when it is non-obvious. Exception: content-social category topics — omit the person name entirely.
- Status: include only when it meaningfully qualifies the item (e.g., "In Review", "Blocked", "Done", or content workflow phases like "outline", "draft", "published"). The content workflow phases list is non-exhaustive — other reasonable phases (e.g. "scheduled", "awaiting approval") are also acceptable.
- Date: include only when a specific date was explicitly discussed. Short M/D format in parens, always last.
- Person and Status may appear together or alone.
- Omit the — entirely when there is no metadata.
- Note: "In Review" and "Blocked" are display labels for the agenda — they are not the same as board status values ("Review", "Pending") and the difference is intentional.

Examples:
• Google Business Profile audit complete
• Provider directory redesign — Hugo (6/15)
• Homepage hero — Cedric, In Review
• Q3 blog post — outline` : "";
```

- [ ] **Step 2: Interpolate `${bulletFormatBlock}` in the return template literal**

Find this exact text in the `return` template literal of `buildSystem()` (note: `${master ?` is immediately followed by a backtick and content on the same line):

```
HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>. No headings, no inline styles, no other tags. Be concise.
${master ? `
```

Change it to:

```
HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>. No headings, no inline styles, no other tags. Be concise.${bulletFormatBlock}
${master ? `
```

- [ ] **Step 3: Verify the change looks correct**

Read back `api/ai/refine.js` and confirm:
- `bulletFormatBlock` is declared inside `buildSystem()` before the `return`
- `${bulletFormatBlock}` is appended to the HTML rules line
- The `${master ? ...}` block still follows on the next line
- Nothing else changed

- [ ] **Step 4: Commit**

```bash
git add api/ai/refine.js
git commit -m "feat(sync-meeting): add bullet format guide to refine.js system prompt"
```

---

### Task 3: Deploy and verify

- [ ] **Step 1: Push to origin/dev**

```bash
git push origin main:dev
```

Wait for Vercel to finish deploying (watch https://vercel.com/dashboard or check the Vercel CLI output).

- [ ] **Step 2: Run Sync Meeting on a per-org agenda**

Open the deployed Vercel app. Navigate to any per-org agenda (e.g., Unio Biweekly Marketing or Vistamar Platform Development). Run Sync Meeting.

- [ ] **Step 3: Check generated bullets against the spec**

In the proposed agenda, verify:
- Bullets follow `item — metadata (date)` style
- No `**Name**:` bold-colon pattern appears anywhere
- `content-social` topic bullets omit owner name (only status/phase if any)
- A date appears only when a specific date was discussed — not inferred
- Bullets with no metadata have no trailing ` —`

- [ ] **Step 4: Verify master Touch Base is unaffected**

Open the Monday VM Weekly Touch Base and run Sync Meeting. Confirm it completes normally and produces a plausible cross-org agenda — the goal is that the master path is not broken, not that bullet style is measurably different (the model may still use em-dash style from training regardless).
