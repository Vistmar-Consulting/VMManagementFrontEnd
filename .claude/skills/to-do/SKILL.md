---
name: to-do
description: Use when the developer invokes /to-do or asks for the current to-do list, deferred items, what to work on next, what's blocking things, or improvement/feature ideas for the VMManagementFrontEnd app. Reconstructs the full to-do picture from scattered session state and keeps a durable log across runs.
---

# /to-do — VMManagement To-Do Synthesizer

## Overview

State for this project is scattered: deferred items live in ~18 `dev/sessions/*/context.md` files, an old brain-dump backlog sits in one triage session, memory flags HIGH-priority work, and nothing reconciles what has since shipped. This skill reconstructs one coherent to-do picture **fresh every run**, then records what it did in a durable log so it never repeats a dismissed idea and can show movement over time.

**Hybrid by design:** always re-read all sources (the picture must be accurate), AND read/update `dev/todo/log.md` (the skill's own memory — not a competing source of truth for deferred items; `context.md` still owns those).

**Read-only on project state.** This skill NEVER edits session `context.md` files, never closes items, never touches code. It only writes to `dev/todo/log.md`, and only with the developer's dispositions.

## Two-stage architecture

1. **Gather (dispatched subagent).** Reading ~18 context files + backlog + memory + git is heavy. One subagent does it and returns a structured digest. Keeps the main session's context clean.
2. **Present + interact + log (main thread).** Render the report, capture the developer's dispositions/priorities, write the log. Interaction must be in the main thread, so this is never delegated.

## Run sequence

1. **Read the log first** — `dev/todo/log.md`. Extract: prior suggestions + their status (so you never re-pitch a `dismissed` one), the last run's date + open count, and any standing priority calls. If the file doesn't exist, treat as first run (you'll create it in step 5).
2. **Dispatch the gather subagent** — actually spawn a subagent (Agent/Task tool); do NOT gather in the main thread. Use the exact prompt below, passing it the list of already-dispositioned suggestion titles so it won't resurface dismissed ones.
3. **Render the report** in the four-section format below.
4. **Ask for dispositions** — offer to set suggestion statuses and record priority calls. If the developer says nothing, skip to logging the run line.
5. **Write the log** — append a run-history line; upsert any new suggestions into the ledger; record any priority calls. Never delete prior ledger entries — change their status.

## Gather subagent prompt (use verbatim, fill the brackets)

> You are gathering to-do state for the VMManagementFrontEnd project at `/Users/andrewdeemer/Vistamar_Consulting/VMManagementFrontEnd`. Return a structured digest — your final message is data, not a human-facing report.
>
> **Read ALL of these — do not shortcut by trusting summaries:**
> - `dev/SESSION_INDEX.json` — the session spine. Use the summaries to reconcile what shipped.
> - **Every** `dev/sessions/*/context.md` — read each one's `## Deferred` section and close summary. Do not stop at the newest few; a deferral introduced mid-stream and never echoed forward is exactly what gets lost. The canonical brain-dump backlog (#1–#11 + carried v0.2.4 deferrals) is in `dev/sessions/v0_3_0_Andrew_BACKLOG_TRIAGE/context.md`.
> - The auto-memory `project_*` files at `/Users/andrewdeemer/.claude/projects/-Users-andrewdeemer-Vistamar-Consulting-VMManagementFrontEnd/memory/` — several flag deferred or HIGH-priority work (Master Touch Base, board presence, collab hardening, assignee pre-fill, etc.). Read `MEMORY.md`, then read **all** `project_*` files (they are short) — do not cherry-pick by hook text, or you'll skip a flag that lives only in the file body.
> - `git log --oneline -25` and `git status` / `git rev-list origin/dev..main` — for very recent or unpushed work.
>
> **Reconcile shipped vs. open:** take the brain-dump #1–#11 + every Deferred item as the baseline, then walk SESSION_INDEX forward marking each shipped or still-open. For any load-bearing "must-do / must-push" deferral, VERIFY against actual code or git (e.g. grep the file, check `origin/dev..main`) rather than trusting the note — stale "still open" claims are common.
>
> **Already-dispositioned suggestions (do NOT re-pitch as new):** [paste dismissed/shipped/parked suggestion titles from the log, or "none — first run"].
>
> Return a digest with these sections:
> - **OPEN** — each outstanding item: one-line description, a source tag (`deferred:vX.Y.Z` / `backlog #N` / `memory` / `git`), and rough size (S/M/L). Note parent/child where an item is a fast-follow of another.
> - **BLOCKERS** — what blocks what, and on what (external dep, decision, Blaze upgrade, etc.).
> - **RECONCILED-SHIPPED** — items that looked open in old notes but are actually done, with the evidence (commit/grep) that closed them.
> - **CANDIDATE SUGGESTIONS** — improvement ideas. For each, mark `GROUNDED GAP` (traceable to real state — a half-finished feature, a logical next step, a verified risk) or `BLUE-SKY` (speculative new capability), and name the existing OPEN item it relates to, if any.

## Report format (the output)

Four clearly-denoted sections. Place enhancement suggestions next to the item they relate to; keep net-new ideas in their own section.

1. **🔴 Open to-do** — the reconciled outstanding list. Each line carries its source tag and size. Where a `GROUNDED GAP` suggestion enhances an item, nest it under that item, labeled `↳ ENHANCEMENT`, with a one-line why.
2. **⛔ Blockers** — what's blocking what, including standing priority calls of the form "X blocked on Y".
3. **✅ Recommendations** — prioritized "do next." Lead with the developer's recorded priority calls, then your own reasoning. Favor cheap-but-high-value (verification tasks, latent data-safety risks) before large net-new features.
4. **💡 New ideas** — every suggestion NOT nested as an `↳ ENHANCEMENT` under an open item, including `GROUNDED GAP` ideas that don't attach to any existing item. Each labeled `GROUNDED GAP` or `BLUE-SKY`. Include all of them, but organized — never let ideas drown out the actual to-do list.

Open with a one-line **delta since last run** if the log has prior runs ("Since 2026-06-08: 2 shipped, 1 new deferral, 9 open"). The open count is the number of items in the gather digest's OPEN section; "shipped since last run" comes from its RECONCILED-SHIPPED section.

## The log — `dev/todo/log.md`

Single file, three sections. Read at the start of every run, written at the end. Format:

- **## Suggestion ledger** — a table: `ID | suggestion | status | first proposed | notes`. Status ∈ `proposed` / `accepted` / `dismissed` / `shipped` / `parked`. Assign stable IDs (`S1`, `S2`, …). A `dismissed` suggestion is never re-pitched as new; a `parked` one may resurface. Update status in place — never delete a row.
- **## Run history** — a table: `date | open count | shipped since last run | note`. One row per run.
- **## Priority calls** — dated list. When the developer says "do X next" or "Y is blocked on Z", record it. The next run's Recommendations/Blockers lead with these. Strike through (or mark `done`) a priority call once its item ships.

## Interaction model

After the report, ask once whether the developer wants to disposition anything, and show the exact reply shorthand: `dismiss S3` · `park S5` · `accept S2` · `priority: backlog #6 next` · `block: backlog #10 on gmail MCP re-auth`. Apply their answers to the log. If the developer raises a brand-new idea during this exchange, give it its own `S`-ID and add it to the ledger (status `proposed`, or `accepted` if they're greenlighting it). If they say nothing, just append the run-history line and exit. Never infer a dismissal or a priority the developer didn't state.

When filtering the gather digest against the ledger, match `dismissed`/`shipped` suggestions by **meaning, not exact string** — wording drifts between runs, so a near-duplicate of a dismissed idea must still be suppressed.

## Red flags — you're doing it wrong if

- You read only the newest few `context.md` files and trusted SESSION_INDEX for the rest → you WILL miss mid-stream deferrals. Read every Deferred section.
- You skipped the memory files → you missed HIGH-priority flags that live only there.
- You reported an item as open without checking whether a later session shipped it → reconcile first, every time.
- Suggestions are unlabeled or scattered away from the items they relate to → label `GROUNDED GAP`/`BLUE-SKY` and co-locate enhancements.
- You edited a session `context.md`, closed an item, or changed code → this skill is read-only on project state; only `dev/todo/log.md` is yours to write.
- You re-pitched an idea the ledger marks `dismissed` → read the log first, and match by meaning.
- You read all the state in the main thread instead of dispatching the gather subagent → you broke the two-stage architecture and polluted your context. Dispatch the subagent.
