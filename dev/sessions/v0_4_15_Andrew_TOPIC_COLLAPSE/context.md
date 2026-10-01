# Session v0.4.15 — Agenda Overview topic collapse

**Date:** 2026-10-01 · **Developer:** Andrew · **Status:** in progress
**Branch:** worktree `.claude/worktrees/topic-collapse` on `feat/topic-collapse`, cut from local `main` at `091a22b`

## Goal

In the agenda Overview, each topic gets a chevron to collapse or expand its body, so unneeded topics can be folded away while screen-sharing.

**Decisions (Andy, 2026-10-01):**
- Collapse state lives only in the open window. Not persisted, not shared; everything opens expanded.
- The chevron sits at the right end of the topic title, left of the trash icon. It is shown on hover while expanded and always shown while collapsed.
- "Collapse all / Expand all" sits on the right of the Contents header.
- Clicking a collapsed topic in Contents expands it, then scrolls to it.

## Live state

- Built: collapse state in `AgendaDetail` (`collapsedTopicIds`), chevron in `OverviewTopic`, toggle and expand-on-jump in `AgendaTOC`, `topicId` on TOC topic entries.
- The body is hidden with `display: none`, not unmounted, so the collab editor never remounts.
- Tests: `src/lib/__tests__/agendaToc.test.js` and `src/components/__tests__/AgendaTOC.collapse.test.jsx` pass (11/11). `vite build` passes.
- Not browser-verified by Claude. Andy chose to check it on production instead (2026-10-01).

## Deferred

- None yet.
