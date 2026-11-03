# v0.4.25 — Agenda Chat creates tables

Date: 2026-11-02 → 2026-11-03 · Developer: Andrew · Status: complete

## Shipped (origin/dev, 7231e30..8e54b67)

- `CHAT_TABLE_RULES` (`api/ai/_lib/htmlRules.js`), added only to Agenda Chat's prompt: a new table only when the user asks or pastes tab/pipe-separated data. Sync Meeting, Refine and Generate still never create tables.
- Redline: `diffGap` (`src/lib/agendaDiff.js`) shows a gap where a table is paired with a non-table as all old blocks deleted, then all new ones inserted, so a replaced list is not split around the table. Also affects the Sync Meeting redline, for that case only.
- AI Integration "Tables kept" row updated.
- Spec `docs/superpowers/specs/2026-11-02-agenda-chat-tables-design.md`; plan `docs/plans/2026-11-02-agenda-chat-tables.md`.

## Verification

- Full suite (711 tests) passes with `--maxWorkers=2`. At default parallelism under high machine load, unrelated editor/modal tests time out (different files each run; they pass in isolation).
- Build passes. Pre-push code review done; its one Important finding (drop the different-shape table trigger) applied.
- Deployed site: one Agenda Chat turn ($0.09) on the Unio Biweekly Google Ads topic proposed the Results line as a Metric/Value table; review diff correct. Cancelled, not applied — Apply + reload not exercised live.

## Context

Prompted by the Unio Biweekly Google Ads "Campaign results" table, built by hand in the live editor on 2026-11-02 because Agenda Chat could not create tables.

## Deferred

- None.
