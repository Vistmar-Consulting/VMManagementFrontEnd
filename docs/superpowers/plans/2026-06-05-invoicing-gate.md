# Invoicing Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the AI from generating or retaining invoicing/billing topics on client-facing meeting agendas by adding one sentence to the system prompt.

**Architecture:** Single-line addition to `buildSystem()` in `api/ai/prepare.js`, inside the client `howToUse` block (the final `else` branch). No UI, no tests, no other files touched.

**Tech Stack:** Node.js serverless function (Vercel), template literal string

---

### Task 1: Add invoicing gate to client howToUse block

**Files:**
- Modify: `api/ai/prepare.js:171-172`

The client `howToUse` block ends at line 172 with:
```
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.`;
```

The new sentence goes on a new bullet between line 171 (the "Keep Vistamar looking strong" line) and line 172 (the "Use Project Board activity" line).

- [ ] **Step 1: Make the edit**

In `api/ai/prepare.js`, change lines 171–172 from:
```
- Internal Vistamar meetings (tagged [Vistamar internal]) are for YOUR situational awareness — never surface internal-only mechanics, staffing, or candor into a client-facing agenda, especially an executive one. Keep Vistamar looking strong and prepared to the client.
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.`;
```
to:
```
- Internal Vistamar meetings (tagged [Vistamar internal]) are for YOUR situational awareness — never surface internal-only mechanics, staffing, or candor into a client-facing agenda, especially an executive one. Keep Vistamar looking strong and prepared to the client.
- Never create or retain a topic whose primary purpose is invoicing, billing, or payment status — that belongs exclusively on the private Vistamar Project Board, not a client-facing agenda.
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.`;
```

- [ ] **Step 2: Verify no other branches were touched**

Confirm `internal` and `master` branches are unchanged:
```bash
git diff api/ai/prepare.js
```
Expected: only the one new line in the `else` block (around line 172). No changes to the `master` block (lines 151–160) or the `internal` block (lines 162–167).

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npx vitest run
```
Expected: all tests pass (this change does not affect any tested logic).

- [ ] **Step 4: Commit**

```bash
git add api/ai/prepare.js
git commit -m "feat(ai): gate invoicing topics from client-facing agendas"
```
