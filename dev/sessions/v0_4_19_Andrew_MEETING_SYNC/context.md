# Session v0.4.19 — Meeting Sync: timeout + topic safety

**Date:** 2026-10-21 · **Developer:** Andrew · **Status:** active
**Branch:** worktree `.claude/worktrees/meeting-sync-timeout` on `worktree-meeting-sync-timeout`, cut from `main` at `c923daf`

## Ask

1. Sync Meeting times out on the Unio "Biweekly Marketing Updates" agenda (not synced since 2026-09-09). Fix the timeout, then sync it.
2. A topic card must never be deleted by a sync — only by a person deliberately deleting it.

## 1. Timeout — root cause and fix

**Root cause:** `/api/ai/prepare` latency is output-bound — the model rewrites the whole agenda as HTML. Measured locally with the exact Unio inputs (48K-char request, 9 topics / 13.5K chars of body HTML): Sonnet 4.6 took **270.6s** for 14K output tokens (~52 tok/s) against Vercel's 300s `maxDuration`. Any slower run or larger agenda → 504. Input gathering (`assembleGenInputs`) took 3.1s; Fireflies inputs are summaries only (~6K chars).

**Fix:** prepare + refine move to **Claude Opus 5.5 fast mode** via `api/ai/_handlers/claude.js` (`streamMessage`: beta endpoint, `speed: "fast"`, falls back to standard speed on 429). Same inputs: **35.6s**, all 9 topics carried forward. Est. cost per sync ~$0.54 (was ~$0.26). Opus 5.5 cannot disable thinking, so master's `thinking: disabled` was removed (effort stays `medium`).

| File | Change |
|---|---|
| `api/ai/_handlers/claude.js` | New. MODEL + `streamMessage` (fast mode, 429 → standard). |
| `api/ai/_handlers/prepare.js` | Uses `streamMessage`; drops Sonnet MODEL + thinking param. |
| `api/ai/_handlers/refine.js` | Same (refine also rewrites the whole agenda). |
| `src/pages/AIIntegration.jsx` | HOW_IT_WORKS "Model" row; SOPs row timing text no longer quotes Sonnet-era minutes. |

**Fallback chain (follow-up commit):** `streamMessage` tries Opus 5.5 fast → Opus 5.5 standard → Sonnet 5.5 on pre-output failures (429, 5xx/529, connection errors), `maxRetries: 0` per attempt, later attempts skipped once too late to finish inside 300s. 4xx errors do not fall back. `api/__tests__/claudeFallback.test.js` 5/5; a live 1-cent call confirmed Sonnet 5.5 accepts the request shape.

**Not verified:** master (Touch Base) sync on Opus 5.5 — no paid run made; the deployed sync end to end.

## 2. Topic deletion — finding

`applyUnified` (`src/lib/aiAgenda.js:584`) deletes **every** topic doc and recreates the proposal's topics with new doc IDs. Any topic the model omits is lost (the prompt explicitly allows omitting "fully complete" topics). New IDs are also what make AI bodies appear: the collab fragment is keyed by topic id and only seeds from Firestore `bodyHtml` when empty (`CollabBodyEditor.jsx` seed effect). An in-place fix therefore has to write AI bodies into the live Yjs fragment too. Needs design (brainstorming) before code.

## Deferred

- Topic no-delete design + implementation (item 2).
- Optional: server-side refusal fallback (`fallbacks: "default"`) on the Opus 5.5 calls — untested combination with fast mode.
- `generate.js` still on Sonnet 4.6 — no FE caller found.
