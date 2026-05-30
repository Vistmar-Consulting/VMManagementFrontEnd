# AI Prompt Management & AI-Forward Agendas — Feature Design Space

**Status:** DESIGN / IDEATION. Nothing built. Andy: this is **"the heart and soul of this entire app"** — and it needs a dedicated, deeper design session (likely several). This folder is the living space to capture the vision and iterate the actual prompts before any implementation.

**Created:** 2026-05-29 (session SES-20260529-Andrew-v0.2.4-agenda-richtext, during the Agenda Overview redesign).

**Permissions gate (firm):** only admins (`@vistamarconsulting.com`) can trigger or affect any AI procedure. Clients/external users never can.

---

## 1. The vision

An AI engine that **moves meeting agendas forward** week over week and **manages the Project Board tasks** that flow from them — with humans always reviewing/editing afterward. The team triggers AI procedures via explicit buttons; oversight modals pop up so a human can confer + confirm before changes land.

## 2. What the AI is responsible for (all deferred)

1. **Pre-Brief generation** — for each topic, write the short "what's immediately on the table this week" line + flag a hard due date (only real deadlines, e.g. CyberKnife Open House 6/10). This is the human-facing surface of the AI's understanding. (See the Pre-Brief redesign in §6 — the nearer-term UI piece.)
2. **Move the agenda forward** — from this week's agenda → propose next week's: carry/retire topics, update each topic body, refresh the Pre-Brief. (Original editor spec called this Phase 4; it produces a NEW agenda doc, never edits a live one.)
3. **Create tasks** — initiate new items/subitems on the Project Board with the **AI Gen status (statusId 8)** for human triage.
4. **Promote tasks** — move existing tasks along their statuses; humans review what the AI promoted before it sticks.

## 3. Inputs the AI must be aware of

- The current + past agendas: topic titles + rich bodies, Open Floor, Pre-Brief, and prior **concluded-occurrence snapshots** (per the editor spec's archival snapshots).
- **Fireflies transcripts** + their AI-gen'd key decisions and tasks — and NOT only the Fireflies meeting mapped to this agenda.
- **Internal Vistamar team meetings** — where the team discusses, internally, the work to be done for each client. These transcripts also feed the per-client understanding.
- Structured context: attendees, the org, existing board items + statuses.

## 4. Prompt-management layer (this folder's namesake)

Prompts are **editable in-app**, not hardcoded:
- **Settings → (sub-tab): default prompts.** The Vistamar team can view + edit the canonical "default prompts" for each AI function — e.g. **"Refresh Agenda for org and Task Items."**
- **Org Settings → per-org prompts.** For each org (each is subjective), the team can **completely override** a default prompt OR **add additional** prompts on top of it.
- Implies a stored prompt model (Firestore): default prompts + per-org overrides/additions, resolved at run time (org override > default).

## 5. Human oversight + controls (deferred, design)

- Explicit **buttons** to run each AI procedure (refresh agenda, generate pre-brief, propose tasks, …).
- **Oversight modals**: when the AI proposes changes (new agenda, created/promoted tasks), a human reviews, confers, and confirms before anything commits.
- Humans always edit after the AI acts. The AI never silently mutates live state.

## 6. Pre-Brief redesign (nearer-term UI piece; ties in here)

The Pre-Brief moves from freeform `agenda.preBriefHtml` to a **structured, per-topic checklist**:
- One row per topic: **topic title + (hard due date in parens, only if a real deadline) + a one-line this-week reminder**. No topic explanations — titles + human memory carry the "what is this about."
- Each row has an **interactive checkbox**. At meeting start the group checks the topics they'll cover; once ≥1 box is checked, the **unchecked topics fade (reduced opacity)** in the agenda below — a "skip these" signal — but stay fully visible + editable by anyone.
- **Data-model implication:** topics gain structured fields — a short `weekBrief`, optional `dueDate` + `isHardDeadline`, and a per-meeting `covered`/`selected` checkbox state. Topic *bodies* stay rich HTML; the Pre-Brief is derived + structured. This conflicts with the current freeform HTML pre-brief (acknowledged) — needs migration.
- The `weekBrief` + due dates are **AI-drafted, human-edited** (the everyday loop once AI lands; can ship human-entry-first and wire AI in later).

## 7. Open questions (for the deep design session)

- Prompt storage + resolution model (default vs per-org override/additions) — schema + merge rules.
- How "move agenda forward" creates the NEW agenda doc vs the recurring base/`_R` instance docs (entangled with the duplicate-doc cleanup already deferred).
- Task create/promote: how AI proposals map to `items/` writes, the review/confirm UX, and the AI Gen (statusId 8) triage flow.
- Internal-meeting transcripts: how they're ingested + associated to clients (no current mapping like the per-agenda Fireflies titles).
- Model/provider, cost, where the AI calls run (Vercel function? Blaze-gated Cloud Function?), and prompt-caching.
- Pre-Brief structured migration off `preBriefHtml`.

## 8. `prompts/` subfolder

Draft + iterate the actual prompt `.md` files here. These drafts become the seed for the in-app **default prompts** (§4). Start with `refresh-agenda.v0.md`.

---

*Living doc — append freely as the design develops. Nothing here is committed to build until Andy says go on a specific piece.*
