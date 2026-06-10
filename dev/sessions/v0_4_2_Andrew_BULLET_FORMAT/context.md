# Session: v0.4.2 — Agenda Bullet Format Guide

**Developer:** Andrew
**Date:** 2026-06-10
**Branch:** main → origin/dev
**Status:** CLOSED

---

## What Shipped

### 1. Agenda bullet format guide in Sync Meeting system prompt

Full brainstorm → spec → plan → subagent-driven implementation cycle.

**Format:** `item text — Person, Status (M/D)`
- Person: included when ownership is non-obvious. **Exception:** `content-social` topics — owner name always omitted.
- Status: canonical words ("In Review", "Blocked", "Done") or content workflow phases ("outline", "draft", "published", open-ended).
- Date: only when explicitly discussed. Short M/D in parens, always last. Person + Status may appear together or alone.
- No `—` when there is no metadata.

**Files changed:**
- `api/ai/prepare.js` — `bulletFormatBlock` variable in `buildSystem()`, interpolated after TOPIC IDENTITY block, before `## Board changes output`. Suppressed on master path (`!master`).
- `api/ai/refine.js` — same variable, interpolated after HTML rules line, before `${master ? ...}` block. Same master suppression.

**Commits:** `b53e58e`, `d25d670`

### 2. AI Integration page `HOW_IT_WORKS` updated

`src/pages/AIIntegration.jsx` — added to the "How Meeting Agenda Gen works" accordion:
- **Guardrails** gained: "No invoicing topics" and "Topic titles are frozen" (both were live in code but undocumented in the UI)
- **Bullet format (always on)** — new section covering pattern, person rule, status rule, date rule
- Fixed stale `api/ai/generate.js` reference → `api/ai/prepare.js` in the file's comment

**Commit:** `0d0f24c`

### 3. CLAUDE.md rule added

Workflow Discipline rule 4: any Sync Meeting prompt/workflow change must update `HOW_IT_WORKS` in `AIIntegration.jsx`. Named the three relevant files explicitly.

**Commit:** `b494312`

---

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-06-10-agenda-bullet-format-design.md`
- Plan: `docs/superpowers/plans/2026-06-10-agenda-bullet-format.md`

---

## Deferred

- **Master Touch Base bullet format** — explicitly excluded from this session. The master agenda structure is expected to change significantly; it will get its own format design in a future session.
- **Verification** — Andy is verifying Sync Meeting bullet output directly against the deployed Vercel app.

---

## Session Close Summary

Designed and shipped a bullet format guide for Sync Meeting AI output. The guide standardizes how metadata (owner, status, date) is attached to agenda topic bullets, replacing the previous `**Name**: info` pattern. Documented the change (and two previously invisible guardrails) in the Settings AI Integration page, and added a CLAUDE.md rule to keep that page in sync going forward.
