# Invoicing Gate — Design Spec

**Date:** 2026-06-05  
**Status:** Approved  
**Scope:** `api/ai/prepare.js` — AI system prompt only

---

## Problem

Client-facing meeting agendas occasionally surface invoicing/billing as a topic (e.g., "Reporting & Invoicing" on GV – Biweekly). Invoicing discussions are internal Vistamar business and belong exclusively on the private Vistamar Project Board — not in a document that gets sent to clients as a meeting agenda.

## Decision

Prompt-only gate, client agendas only. No UI changes, no Firestore validation, no structural changes.

**Definition of "invoicing":** narrow — explicit invoicing, billing, and payment-status topics. General reporting topics are not affected.

**Scope:** client meeting agendas only. Internal Vistamar agendas and the Master Touch Base are excluded (billing pipeline discussion is legitimate in internal contexts).

## Change

In `api/ai/prepare.js`, `buildSystem()`, inside the client `howToUse` block (the final `else` branch):

Add one sentence after the existing "Keep Vistamar looking strong and prepared to the client" line:

```
- Never create or retain a topic whose primary purpose is invoicing, billing, or payment status — that belongs exclusively on the private Vistamar Project Board, not a client-facing agenda.
```

### Why this location

The client `howToUse` block already carries all other client-specific behavioral constraints (internal-candor suppression, org-coherence rules). Adding here:
- Is client-only by construction (the `else` branch never runs for `internal` or `master` meetings).
- Sits adjacent to the existing "don't surface internal mechanics" rule — conceptually the same family.
- Requires no new sections or structural changes.

## Behavior after the change

- **New Sync Meetings on client agendas:** AI will not propose a new invoicing/billing topic.
- **Existing invoicing topics (e.g., GV "Reporting & Invoicing"):** The sticky-titles rule means the AI can only drop or carry forward a retained topic — it cannot rename it. On the next Sync Meeting run the AI will simply not carry it forward (it will appear in the "Dropped" list in the review diff), and the human reviews before applying. No automatic deletion; no data changed without human approval.
- **Internal and Master agendas:** Unaffected.
- **Manual topic creation:** Unaffected (users can still type anything via the Working view collab editor — this gate is AI-only by design).

## Testing

- Unit tests: not applicable (system prompt is a string; no logic branch to test).
- Manual verification: run a Sync Meeting on a client agenda with an existing "invoicing"-adjacent topic; confirm the AI drops it or omits it rather than retaining/creating it.

## Out of scope

- UI warning or hard block in `SyncMeetingDialog` — deferred, may revisit if the prompt-only gate proves insufficient.
- Blocking manual topic creation in the Working view editor.
- Affecting internal or master agendas.
