# Sync Meeting — Sticky Topic Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sync Meeting structurally incapable of renaming an existing agenda topic — a continued topic's title always comes from Firestore at apply time; the model's title is discarded.

**Architecture:** Topic identity travels through the AI round-trip as a `ref` (the topic's Firestore doc id) the model echoes back; brand-new topics carry `ref: ""`. `applyUnified` keeps today's destroy-recreate but, for any topic carrying a known `ref`, writes the existing canonical `name` (and, for master, `organizationId`) read from Firestore. The review modal shows a Retained / New / Dropped diff. Two new pure helpers (`normalizeTopicRefs`, `classifyTopicChanges`) are unit-tested; the API/transaction/UI edits are verified on Vercel prod (project convention — no E2E harness for these paths).

**Tech Stack:** React 18 + MUI, Vite, Vitest, Firebase Firestore (Web SDK 11), Vercel serverless (`api/ai/*`), Anthropic structured outputs.

**Spec:** `docs/superpowers/specs/2026-06-02-sync-meeting-sticky-topic-titles-design.md`

---

## File Structure

- `src/lib/syncMeeting.js` — add two pure helpers: `normalizeTopicRefs`, `classifyTopicChanges`. (Existing: `mintTopicIds`, `inheritKeysForCreate`, `validateProposal`.)
- `src/lib/__tests__/syncMeeting.test.js` — add unit tests for the two helpers.
- `api/ai/prepare.js` — schema gains `ref`; current-topic rendering tagged `[ref:<id>]`; TOPIC IDENTITY prompt rule; handler reshape carries `ref` through.
- `api/ai/refine.js` — its OWN schema gains `ref`; preserve-ref in `buildSystem`; `[ref:…]` in `buildUserMessage`; handler reshape carries `ref` through.
- `src/lib/aiAgenda.js` — `applyUnified` builds `curNameById`/`curOrgById` and locks the title in the recreate loop.
- `src/components/SyncMeetingDialog.jsx` — stop stripping `id` from the topics payload; normalize received refs; render the Retained/New/Dropped diff.

---

## Task 1: `normalizeTopicRefs` pure helper

**Files:**
- Modify: `src/lib/syncMeeting.js`
- Test: `src/lib/__tests__/syncMeeting.test.js`

- [ ] **Step 1: Write the failing test**

First, **extend the existing import line** at `src/lib/__tests__/syncMeeting.test.js:2` (do NOT add a second `import` from the same module) so it reads:

```js
import { mintTopicIds, validateProposal, inheritKeysForCreate, normalizeTopicRefs, classifyTopicChanges } from "../syncMeeting.js";
```

(Both this task and Task 2 use that one extended line — `classifyTopicChanges` is unused until Task 2, which is fine.) Then add the test block:

```js
describe("normalizeTopicRefs", () => {
  const current = ["docA", "docB"];

  it("keeps a ref that matches a current topic id", () => {
    const out = normalizeTopicRefs([{ ref: "docA", name: "x" }], current);
    expect(out[0].ref).toBe("docA");
  });

  it("downgrades an unknown ref to empty string", () => {
    const out = normalizeTopicRefs([{ ref: "ghost", name: "x" }], current);
    expect(out[0].ref).toBe("");
  });

  it("treats empty/missing ref as new (empty string)", () => {
    const out = normalizeTopicRefs([{ name: "x" }, { ref: "", name: "y" }], current);
    expect(out[0].ref).toBe("");
    expect(out[1].ref).toBe("");
  });

  it("preserves other topic fields (e.g. topicId)", () => {
    const out = normalizeTopicRefs([{ ref: "docB", topicId: "t3", name: "z" }], current);
    expect(out[0]).toMatchObject({ ref: "docB", topicId: "t3", name: "z" });
  });

  it("returns [] for empty input", () => {
    expect(normalizeTopicRefs(undefined, current)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js -t normalizeTopicRefs`
Expected: FAIL — `normalizeTopicRefs is not exported` / not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/syncMeeting.js`:

```js
// Downgrade any topic whose `ref` is non-empty but NOT among the current
// agenda's topic ids to a brand-new topic (ref ""). Guards the title-lock and
// the review diff against a hallucinated/stale ref. Pure.
export function normalizeTopicRefs(topics, currentTopicIds) {
  const valid = new Set(currentTopicIds || []);
  return (topics || []).map((t) => {
    const ref = typeof t?.ref === "string" ? t.ref : "";
    return { ...t, ref: ref && valid.has(ref) ? ref : "" };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js -t normalizeTopicRefs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncMeeting.js src/lib/__tests__/syncMeeting.test.js
git commit -m "feat(sync-meeting): normalizeTopicRefs helper (downgrade unknown topic refs)"
```

---

## Task 2: `classifyTopicChanges` pure helper

**Files:**
- Modify: `src/lib/syncMeeting.js`
- Test: `src/lib/__tests__/syncMeeting.test.js`

- [ ] **Step 1: Write the failing test**

The import line was already extended to include `classifyTopicChanges` in Task 1 Step 1 — no import change needed here. Add the test block to `src/lib/__tests__/syncMeeting.test.js`:

```js
describe("classifyTopicChanges", () => {
  const current = [
    { id: "docA", name: "Alpha" },
    { id: "docB", name: "Beta" },
  ];

  it("marks a ref'd proposal topic as retained and a ref-less one as new", () => {
    const { statuses } = classifyTopicChanges(current, [
      { ref: "docA", name: "Alpha" },
      { ref: "", name: "Gamma" },
    ]);
    expect(statuses).toEqual(["retained", "new"]);
  });

  it("lists current topics not referenced by any proposal topic as dropped", () => {
    const { dropped } = classifyTopicChanges(current, [{ ref: "docA", name: "Alpha" }]);
    expect(dropped).toEqual([{ id: "docB", name: "Beta" }]);
  });

  it("treats an unknown ref as new (not retained) and the real topic as dropped", () => {
    const { statuses, dropped } = classifyTopicChanges(current, [{ ref: "ghost", name: "X" }]);
    expect(statuses).toEqual(["new"]);
    expect(dropped.map((d) => d.id).sort()).toEqual(["docA", "docB"]);
  });

  it("handles empty inputs", () => {
    expect(classifyTopicChanges([], [])).toEqual({ statuses: [], dropped: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js -t classifyTopicChanges`
Expected: FAIL — not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/syncMeeting.js`:

```js
// Classify proposal topics against the current agenda topics for the review
// diff. Returns { statuses, dropped }:
//   statuses[i] = "retained" (proposal topic i's ref matches a current id)
//                 | "new"
//   dropped     = current topics whose id no proposal topic references
// Pure. Pass current topics as [{ id, name }, ...].
export function classifyTopicChanges(currentTopics, proposalTopics) {
  const currentById = new Map((currentTopics || []).map((t) => [t.id, t]));
  const referenced = new Set();
  const statuses = (proposalTopics || []).map((t) => {
    const ref = typeof t?.ref === "string" ? t.ref : "";
    if (ref && currentById.has(ref)) {
      referenced.add(ref);
      return "retained";
    }
    return "new";
  });
  const dropped = (currentTopics || [])
    .filter((t) => !referenced.has(t.id))
    .map((t) => ({ id: t.id, name: t.name || "" }));
  return { statuses, dropped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/syncMeeting.test.js`
Expected: PASS (all syncMeeting tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncMeeting.js src/lib/__tests__/syncMeeting.test.js
git commit -m "feat(sync-meeting): classifyTopicChanges helper (retained/new/dropped diff)"
```

---

## Task 3: `api/ai/prepare.js` — schema, prompt, rendering, reshape

No unit test (serverless + model call; verified on prod in Task 7). Each step is an edit; verify with a build at the end.

**Files:**
- Modify: `api/ai/prepare.js`

- [ ] **Step 1: Add `ref` to the topic schema**

In `buildSchema(master)` (line ~39), change `topicProps` and `topicRequired`:

```js
const topicProps = {
  ref: { type: "string" },
  name: { type: "string" },
  bodyHtml: { type: "string" },
  categories: { type: "array", items: { type: "string" } },
  tags: { type: "array", items: { type: "string" } },
};
const topicRequired = ["ref", "name", "bodyHtml", "categories", "tags"];
```

(`ref` is required with `""` as the "new topic" sentinel — structured outputs can't express optional; every property here is already in `required`.)

- [ ] **Step 2: Add the TOPIC IDENTITY rule to the system prompt**

In the system-prompt template, update the topics line (line ~189) to mention `ref`, and add an identity rule after the PRESERVE HYPERLINKS paragraph (after line ~194). Change line 189 to:

```js
- topics: an array of ${master ? "{ ref, name, bodyHtml, categories, tags, organizationId }" : "{ ref, name, bodyHtml, categories, tags }"} — each a topic title plus a few tight HTML bullets of what is on the table now. Keep the count and length small.${master ? " Set organizationId on EVERY topic; group topics by org in the listed order." : ""}
```

Insert after the PRESERVE HYPERLINKS paragraph (line ~194):

```
TOPIC IDENTITY — DO NOT RENAME EXISTING TOPICS: the current agenda's topics are listed below, each tagged [ref:<id>]. For every topic you carry forward from the current agenda, set its "ref" to that exact id and keep its title unchanged — the title is fixed by the system and you may not reword it. Only a genuinely NEW topic may have a new title; set its "ref" to an empty string "". You may reorder topics and you may omit a topic whose work is fully complete.
```

- [ ] **Step 3: Tag current topics with `[ref:<id>]` in both user-message builders**

In `buildUserMessage` (non-master), the topic loop (lines 298-301) becomes:

```js
(a.topics || []).forEach((t, i) => {
  const refPart = t.id ? ` [ref: ${t.id}]` : "";
  lines.push(`Topic ${i + 1}: ${t.name || ""}${refPart}`);
  if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
});
```

In `buildMasterUserMessage`, the topic loop (lines 232-235) — add the same `[ref: ${t.id}]` segment alongside the existing `[org: …]` segment:

```js
(a.topics || []).forEach((t, i) => {
  const refPart = t.id ? ` [ref: ${t.id}]` : "";
  lines.push(`Topic ${i + 1}: ${t.name || ""}${refPart}${t.organizationId ? ` [org: ${t.organizationId}]` : ""}`);
  ...
});
```

(Both rely on the current topics arriving with `id` — delivered by the Task 6 dialog change. Master and non-master both receive the agenda from the same dialog payload.)

- [ ] **Step 4: Carry `ref` through the handler reshape**

In the handler's topics `.map` (lines ~409-417), add `ref` to the returned object:

```js
? parsed.topics.map((t, i) => ({
    topicId: `t${i}`,
    ref: t?.ref ? String(t.ref) : "",
    name: String(t?.name || ""),
    bodyHtml: String(t?.bodyHtml || ""),
    categories: Array.isArray(t?.categories) ? t.categories.map((c) => String(c)) : [],
    tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
    organizationId: t?.organizationId ? String(t.organizationId) : null,
  }))
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: build succeeds (no syntax errors).

- [ ] **Step 6: Commit**

```bash
git add api/ai/prepare.js
git commit -m "feat(sync-meeting): thread topic ref through prepare (schema, prompt, render, reshape)"
```

---

## Task 4: `api/ai/refine.js` — its own schema, prompt, rendering, reshape

`refine.js` has its OWN `buildSchema` (line 16) — it does NOT inherit prepare's change.

**Files:**
- Modify: `api/ai/refine.js`

- [ ] **Step 1: Add `ref` to refine's schema**

In `buildSchema(master)` (line ~16):

```js
const topicProps = {
  ref: { type: "string" },
  topicId: { type: "string" },
  name: { type: "string" },
  bodyHtml: { type: "string" },
  categories: { type: "array", items: { type: "string" } },
  tags: { type: "array", items: { type: "string" } },
};
const topicRequired = ["ref", "name", "bodyHtml", "categories", "tags"];
```

(Adds `ref` to both. `topicId` stays not-required as today — refine mints a fresh one for new topics; only `ref` needs the required+`""`-sentinel contract.)

- [ ] **Step 2: Preserve `ref` in `buildSystem`**

After the "PRESERVE TOPIC IDS" paragraph (line ~69), add:

```
PRESERVE TOPIC REFS: each input topic may carry a ref (e.g. "docABC123"). Copy each topic's ref into the output EXACTLY. Never invent or change a ref. A brand-new topic you add has ref "".
```

Also update the Output line (line ~74) topic shape to include `ref`:

```js
Return the FULL refined agenda (not a diff) as JSON matching the schema: preBriefHtml, topics[{ ref, name, bodyHtml, categories, tags${master ? ", organizationId" : ""} }], openFloorHtml.
```

- [ ] **Step 3: Render `[ref:…]` in `buildUserMessage`**

In the topic loop (lines ~82-89), add a ref segment alongside the existing `[topicId: …]`:

```js
(p.topics || []).forEach((t, i) => {
  const refP = t.ref ? ` [ref: ${t.ref}]` : "";
  const idPart = t.topicId ? ` [topicId: ${t.topicId}]` : "";
  const orgPart = master && t.organizationId ? ` [organizationId: ${t.organizationId}]` : "";
  lines.push(`Topic ${i + 1}: ${t.name || ""}${refP}${idPart}${orgPart}`);
  if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
  if (t.categories?.length) lines.push(`  categories: ${t.categories.join(", ")}`);
  if (t.tags?.length) lines.push(`  tags: ${t.tags.join(", ")}`);
});
```

- [ ] **Step 4: Carry `ref` through the refine handler reshape**

In the refined-topics `.map` (lines ~137-144), add `ref` (mirrors the `topicId` passthrough at line 138):

```js
? parsed.topics.map((t) => ({
    topicId: t?.topicId ? String(t.topicId) : null,
    ref: t?.ref ? String(t.ref) : "",
    name: String(t?.name || ""),
    bodyHtml: String(t?.bodyHtml || ""),
    categories: Array.isArray(t?.categories) ? t.categories.map((c) => String(c)) : [],
    tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
    organizationId: t?.organizationId ? String(t.organizationId) : null,
  }))
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add api/ai/refine.js
git commit -m "feat(sync-meeting): preserve topic ref through refine round-trip"
```

---

## Task 5: `src/lib/aiAgenda.js` — `applyUnified` title-lock

**Files:**
- Modify: `src/lib/aiAgenda.js`

- [ ] **Step 1: Build the canonical name/org maps from curTopics**

`curTopics` is already read at lines 452-456 (via `Promise.all`, OUTSIDE the transaction — intentional; these become plain Maps, not `tx.get`, so no reads-before-writes issue, and a few-ms-stale name is fine for single-admin Sync Meeting). Immediately after that `Promise.all`/the `const catBySlug …` block, add:

```js
// Canonical topic identity: a continued topic (carrying a ref to an existing
// topic doc id) keeps its Firestore name (and, for master, org) — the model's
// name is discarded. This is the structural title-lock.
const curNameById = new Map(curTopics.docs.map((d) => [d.id, d.data().name || ""]));
const curOrgById = new Map(curTopics.docs.map((d) => [d.id, d.data().organizationId ?? null]));
```

- [ ] **Step 2: Lock the title in the recreate loop**

In the recreate loop (lines 526-542), change the `name` (line 531) and `organizationId` (line 536) fields. Before:

```js
tx.set(ref, {
  name: String(t.name || ""),
  bodyHtml: sanitizeHtml(t.bodyHtml || ""),
  sortOrder: i + 1,
  categoryIds,
  tagIds,
  organizationId: t.organizationId || null,
  ...
```

After:

```js
const retained = t.ref && curNameById.has(t.ref);
tx.set(ref, {
  name: retained ? curNameById.get(t.ref) : String(t.name || ""),
  bodyHtml: sanitizeHtml(t.bodyHtml || ""),
  sortOrder: i + 1,
  categoryIds,
  tagIds,
  organizationId: retained && curOrgById.has(t.ref) ? curOrgById.get(t.ref) : (t.organizationId || null),
  ...
```

Notes:
- The loop variable is named `ref` for the new topic doc ref — `const ref = doc(collection(...))` at line 529. The topic's identity field is `t.ref`. They don't collide, but read carefully; **do NOT rename the doc-ref variable.**
- This `retained = t.ref && curNameById.has(t.ref)` guard **IS** the "at-apply normalization" the spec (§3.2/§3.3) calls for: an unknown/hallucinated `ref` fails `.has()`, so the topic falls through to the model's name and is treated as new. No separate normalizer call is needed in `applyUnified`.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/aiAgenda.js
git commit -m "feat(sync-meeting): lock retained topic titles at apply (ref -> Firestore name)"
```

---

## Task 6: `src/components/SyncMeetingDialog.jsx` — id passthrough, normalize, diff UI

**Files:**
- Modify: `src/components/SyncMeetingDialog.jsx`

- [ ] **Step 1: Stop stripping the id from the topics payload**

Line ~201, change:

```js
topics: (topics || []).map((t) => ({ name: t.name || "", bodyHtml: t.bodyHtml || "" })),
```

to:

```js
topics: (topics || []).map((t) => ({ id: t.id, name: t.name || "", bodyHtml: t.bodyHtml || "" })),
```

- [ ] **Step 2: Normalize received refs against the current topics**

`SyncMeetingDialog.jsx` already imports `validateProposal` from `../lib/syncMeeting.js` (line ~44) — **extend that existing line** (do NOT add a second import from the same module):

```js
import { validateProposal, normalizeTopicRefs, classifyTopicChanges } from "../lib/syncMeeting.js";
```

There are **two** sites that put topics into proposal state; normalize at both so a hallucinated ref can't masquerade as Retained:

**(a) `generate()`** — currently calls `setProposal(result)` (line ~216) then `applyValidation(result, …)` (line ~217). Insert before them and pass `normalized` to BOTH:

```js
const currentTopicIds = (topics || []).map((t) => t.id);
const normalized = { ...result, topics: normalizeTopicRefs(result.topics, currentTopicIds) };
setProposal(normalized);
applyValidation(normalized, /* …existing remaining args… */);
```

**(b) `refine()`** — currently builds `const merged = { ...result, boardChanges: proposal.boardChanges }` (line ~243) then `setProposal(merged)` (~244) / `applyValidation(merged, …)` (~249). Normalize `result.topics` into `merged` (recompute `currentTopicIds` here — it's not in this function's scope):

```js
const currentTopicIds = (topics || []).map((t) => t.id);
const merged = {
  ...result,
  topics: normalizeTopicRefs(result.topics, currentTopicIds),
  boardChanges: proposal.boardChanges,
};
// setProposal(merged) / applyValidation(merged, …) stay as-is.
```

(Normalizing is harmless to the board-create join — that keys on `topicId`, which `normalizeTopicRefs` preserves via `...t`.)

- [ ] **Step 3: Render the Retained / New / Dropped diff**

In the review section (the "Proposed agenda — review before applying" area, ~line 413), compute the diff and render a compact summary block. Add near the top of that section:

```jsx
{(() => {
  const { statuses, dropped } = classifyTopicChanges(topics, proposal.topics || []);
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: dropped.length ? 0.75 : 0 }}>
        {(proposal.topics || []).map((tp, i) => (
          <Chip
            key={i}
            size="small"
            label={`${tp.name || "(untitled)"} · ${statuses[i] === "retained" ? "Retained" : "New"}`}
            color={statuses[i] === "retained" ? "default" : "primary"}
            variant={statuses[i] === "retained" ? "outlined" : "filled"}
          />
        ))}
      </Stack>
      {dropped.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Dropped: {dropped.map((d) => d.name).join(", ")}
        </Typography>
      )}
    </Box>
  );
})()}
```

Notes:
- `Box`, `Stack`, `Chip`, `Typography` are **already imported** in this file (lines ~11-32) — no import edit needed for them.
- **Do NOT import `../theme/tokens.js`.** This file styles via MUI theme strings (`color="text.secondary"`, `borderColor: "divider"`), not the `t` token object — and `t` is already used as a pervasive `.map`/`.find` loop variable throughout the file, so a module-level `t` import would be confusing. The snippet above uses `color="text.secondary"` to match the file's convention. The loop var in the diff is `tp` (avoids clashing with the file's `t` callbacks).
- `proposal` and `topics` are both in scope in the review section (`step === "review" && proposal`).

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/SyncMeetingDialog.jsx
git commit -m "feat(sync-meeting): pass topic ids, normalize refs, show retained/new/dropped diff"
```

---

## Task 7: Full verification + prod deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (including the new syncMeeting helpers).

- [ ] **Step 2: Lint**

Run: `npm run lint` (if defined) — fix any new warnings introduced by these changes.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Deploy to Vercel + repoint prod alias**

Push and deploy per project convention:

```bash
git push origin main:dev
```

Then deploy and re-point the prod alias (the `dev` push does NOT auto-promote):
`vercel --prod` (or the project's deploy command), then `vercel alias set <new-deploy>.vercel.app vm-management-front-end.vercel.app`.

- [ ] **Step 5: Prod verification (UI hard gate — drive the browser via agent-browser, Profile 10 authed)**

On `vm-management-front-end.vercel.app`, against a real agenda:

1. **Retention:** note the exact current topic titles. Run Sync Meeting → confirm the proposal reuses those titles verbatim and the diff marks them **Retained**. Apply → confirm Firestore topic `name`s are unchanged.
2. **Adversarial (the key test):** open Sync Meeting → in the Refine box, instruct *"rename the [pick a topic] topic to something else."* → confirm the applied agenda STILL shows the original title (apply-side discard beats the model). The diff should still show it Retained.
3. **User rename persists:** rename a topic by hand in the agenda → run Sync Meeting → confirm the new title is retained.
4. **New + Dropped:** confirm a genuinely new subject shows as **New**, and a topic the model omits shows as **Dropped**.
5. **No regressions:** board creates still land under the correct topic (topicId join intact); categories/tags still flow; Pre-Brief + Open Floor still apply.

Clean up any test data afterward (revert the agenda via version history — Sync Meeting snapshots a pre-ai-gen version before apply).

- [ ] **Step 6: Final commit (if any verification fixes were needed) + update session context**

Update `dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md`: mark the sticky-titles item DONE with commit refs + prod-verified note; the live-collaboration slice remains queued next.

```bash
git add dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md
git commit -m "chore(session): sticky topic titles shipped + prod-verified"
git push origin main:dev
```

---

## Notes for the implementer

- **`ref` vs `topicId`:** `topicId` (`t0…tN`) is the session-local board-create join key (`boardChanges.creates.topicIndex` → `topicId`); leave all of that logic alone. `ref` is a separate field — the existing topic's Firestore doc id — used only for the title-lock and the diff. They never collide.
- **Lockstep deploy:** the schema/prompt (prepare+refine) and the apply-side title-lock must ship together. They're in one branch/deploy, so this is automatic — just don't deploy a partial set.
- **Why prod-verify instead of E2E:** this codebase tests on Vercel (primary surface); there is no harness that exercises the model call + Firestore transaction together. The two pure helpers carry the unit coverage; the integration is verified live per Step 5.
