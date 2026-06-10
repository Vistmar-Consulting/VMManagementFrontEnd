# Session: v0.3.9 — Invoicing Gate + Collapsible Sidebar

**Developer:** Andrew  
**Date:** 2026-06-05 (started), closed 2026-06-10  
**Branch:** main → origin/dev  
**Status:** CLOSED

---

## What Shipped

### 1. Invoicing Gate (brain-dump #7)
- **Commits:** `c98ffee` (spec), `0366add` (plan), `02d26a0` (implementation)
- Single bullet added to `buildSystem()` client `else` branch in `api/ai/prepare.js`:
  > "Never create or retain a topic whose primary purpose is invoicing, billing, or payment status — that belongs exclusively on the private Vistamar Project Board, not a client-facing agenda."
- Client agendas only (not internal or master). Narrow definition (invoicing/billing/payment — not general reporting).
- Existing "Reporting & Invoicing" topic on GV – Biweekly will appear as "Dropped" on next Sync Meeting run.
- Spec: `docs/superpowers/specs/2026-06-05-invoicing-gate-design.md`
- Plan: `docs/superpowers/plans/2026-06-05-invoicing-gate.md`

### 2. Collapsible Sidebar
- **Commits:** `a255cfb`/`d74e806` (spec), `6e6d99b` (plan), `429a1ab` (theme token), `23647ae` (Sidebar.jsx), `5576a36` (a11y + padding fix)
- Chevron toggle (`ChevronLeft`/`ChevronRight`) in sidebar header.
- Expanded: 240px with labels. Collapsed: 52px icon-only rail.
- Default: collapsed on mobile (viewport < 600px), expanded on desktop.
- Persisted in `localStorage` key `vm-sidebar-collapsed` via `@uidotdev/usehooks` `useLocalStorage`.
- Seed pattern: `useRef` IIFE reads `localStorage` synchronously to avoid `useLocalStorage` timing race on mobile first visit.
- Settings icon click when collapsed: `setCollapsed(false)` + `setSettingsOpen(true)` (single tap to reach Settings).
- A11y: `aria-label` on all collapsed nav icons; padding transition synced with width transition.
- Files: `src/theme/index.js` (`collapsedWidth: 52`), `src/components/Sidebar.jsx`.
- Spec: `docs/superpowers/specs/2026-06-05-collapsible-sidebar-design.md`
- Plan: `docs/superpowers/plans/2026-06-05-collapsible-sidebar.md`

---

## Deferred

Nothing new deferred this session.

---

## Session Close Summary

Two features shipped and pushed to `origin/dev`. Brain-dump #7 (invoicing gate) closed. Collapsible sidebar was a bonus item (not on the original brain dump) — driven by Andy using the app on iPhone and finding the sidebar too wide. Both features went through full brainstorm → spec → plan → subagent-driven-development → holistic review pipeline.
