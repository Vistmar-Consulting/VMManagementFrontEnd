# Organizations Settings — Banner, Deliverables, Member Directory

**Date:** 2026-06-02
**Status:** Design (approved in brainstorm, pending spec review)
**Author:** Andy + Claude

## 1. Problem & goal

The Settings → Organizations page (`src/pages/Organizations.jsx`) is currently a read-only list (a 12px color dot + name; CRUD explicitly deferred). Three additions:

1. **Accent-color banner** on each org row (not just the dot).
2. **Content Deliverables card** per client — what we produce for them (# blogs, social posts, GBP posts, eblasts, …) + a brief note, sourced from Tate's SOPs.
3. **Member directory** (the priority, dynamic one) — the client-side people we interact with, captured automatically from the Meeting Scheduler so client attendees autofill from a dropdown instead of being hand-typed every time. This realizes the previously-noted "save non-@vistamar attendees to their org so add-attendee becomes autocomplete."

## 2. Layout — expandable org rows (accordion)

`Organizations.jsx` becomes a list of org rows. Each row:
- Shows the **accent color as a top banner** (full-width color strip), reusing `getContrastText`/`hexToRgba` from `src/theme/pillColors.js` (the same helpers the meeting cards use) — replacing the 12px dot.
- Header content: org name + `type` (client/internal) + archived flag.
- **Click to expand inline** → reveals two stacked cards: **Content Deliverables** and **Members**.
- Admin-gated **at the route** — the Organizations page renders under `<ProtectedRoute requireAdmin>` (`src/routes.jsx`), so there is no page-level `isAdmin` check to add; the new cards inherit the gate for free.

No per-org detail route; everything is inline on the one page.

## 3. Content Deliverables card (feature 2)

**Data** — on the org doc (`organizations/{slug}`):
- `deliverables`: array of `{ label: string, quantity: number, cadence: string, note?: string }` — e.g. `{ label: "Blog posts", quantity: 4, cadence: "month" }`. `cadence` ∈ `"week" | "month" | "quarter"` (string; default "month").
- `deliverablesNote`: string — the org-level brief (e.g. "Social post + eblast accompany each blog release").

**Display** — the config-card style (matches Console's "Outline generation" card Andy referenced):
- Title **Content Deliverables**, a compact one-line **summary** derived deterministically from the model — the comma-joined labels of the set deliverables (e.g. "Blog posts · Social posts · GBP posts · Eblast"), or "— " when empty. (No pluralized short-forms or `/mo` suffix in the summary, since labels are freeform and cadences can differ per row; the quantities + cadences live in the rows below.) An **Edit** button sits top-right.
- Divider, then `LABEL → value` rows (uppercase gray label left, value right): `BLOG POSTS → 4 / month`, etc. The per-row cadence is rendered from each row's own `cadence`, so mixed cadences display correctly.
- **Only deliverables with a positive quantity render** — no null/zero rows. `deliverablesNote` renders as a `NOTE → …` row when present.
- Empty state: "No deliverables set — Edit to add."

**Edit** — an inline editor or small dialog: add/remove deliverable rows (label, quantity, cadence, optional per-row note) + edit the org note; saves back to the org doc (`updateDoc`). Populated manually from Tate's SOPs.

## 4. Members directory (feature 3)

**Data model** — subcollection `organizations/{slug}/members/{memberId}`:
- `memberId` = `email.trim().toLowerCase()`, used directly as the doc ID — this gives natural, query-free dedup. A valid email address always satisfies Firestore's doc-ID rules (it can't be `.`/`..`, can't match `^__.*__$` because it ends in a TLD not `__`, is well under the 1500-byte limit, and contains no `/`), so no lossy sanitization is needed. **Guard:** before writing, validate the string is a plausible email (contains `@`, a `.` after the `@`, no whitespace); skip the upsert otherwise. Lowercasing normalizes case (`John@x.com` ≡ `john@x.com`); plus-addressing (`j+a@x.com`) is intentionally treated as a distinct address. (If a malformed email ever needs storing, fall back to an auto-ID doc with an indexed `emailLower` field — not needed for v1.)
- Fields: `{ name: string, email: string, source: "scheduler" | "manual" | "backfill", createdAt }`.
- Job title / role / "primary contact" flag are **deferred** (per the existing job-title-deferred decision). A person who spans multiple orgs is simply duplicated under each org — acceptable for now.

**Settings card** (in the expanded row): lists the org's members (`name · email`), with manual **+ Add** (name + email) and a **remove** (✕) per member. This is the curated, human-editable view of "people we interact with." Reads via a `useCollection("organizations/{slug}/members")`-style hook.

## 5. Scheduler integration (the cross-cutting glue)

Today `NewMeetingDialog.jsx` and `ManageGuestsDialog.jsx` both:
- build `internalOptions` from `useCollection("users")` (the **Vistamar** Autocomplete),
- and accept **client attendees only by manual typing** (`externalName` + email → `addAttendee({email, name})`).

Change: add a **client-side Autocomplete sourced from the meeting's org's `members` subcollection**, mirroring the Vistamar dropdown exactly.

**Resolving the org in each dialog:**
- **NewMeetingDialog** — its `orgId` selector state is the source of truth (it already writes `organizationId: orgId` onto the new agenda). Use `orgId`.
- **ManageGuestsDialog** — it does **NOT** currently compute the org. It receives `agenda` and `calendarSeries` props, so it must resolve the org itself via the canonical fallback used elsewhere in `AgendaDetail`: `calendarSeries?.organizationId || agenda?.organizationId`. (Org often lives only on `calendar_series` for reconciled/legacy agendas, so `agenda.organizationId` alone is insufficient.) No new prop needed — both props are already passed.

**Behavior:**
- **Pick** a known member from the client dropdown → `addAttendee({email, name})` — no typing.
- **Type a new** client person (name + email, the existing external-entry path) → adds the attendee to the meeting as today. The directory write is **deferred to save** (see below), not done per-keystroke/per-add.
- "Client" = email **not** `@vistamarconsulting.com`. Vistamar attendees come from the `users` dropdown and are **never** written to any client directory.

**Auto-capture happens at SAVE, not on add:** in `NewMeetingDialog.handleCreate` and `ManageGuestsDialog.handleSave`, after the meeting/agenda write succeeds, iterate the **final** attendee list, filter to non-`@vistamarconsulting.com`, and `setDoc`-merge each into `organizations/{org}/members/{emailId}` with `{name, email, source:"scheduler"}`. This ties directory growth to *committed* meetings — abandoning/cancelling a dialog never pollutes the directory — and is less code than wiring into the per-attendee add path. Idempotent (email-keyed merge).
- **Edge — no org:** if the resolved org is empty, the client dropdown is empty and no capture happens (auto-capture requires a target org).
- **Edge — master meeting:** the cross-org master Touch Base (`masterAgenda === true`) has attendees spanning multiple client orgs but a single agenda-level org, so auto-capture would mis-file them. **Skip auto-capture when the agenda is a master agenda** (and the client dropdown for a master meeting is likewise not meaningfully org-scoped — leave it as the existing manual entry there).

The capture is a client-side Firestore write from the dialog (no new endpoint).

## 6. Backfill (one-time)

Seed the member directories from existing meeting history so the dropdowns are useful immediately:
- Read all `agendas` docs, take each agenda's `attendees` (`{email, name}[]`), filter to non-`@vistamarconsulting.com`, resolve the agenda's org (via `calendar_series.organizationId` / `agenda.organizationId`), and `setDoc`-merge each into `organizations/{org}/members/{emailId}` with `source:"backfill"`.
- **Skip master agendas** (`masterAgenda === true`): the cross-org Touch Base's attendees span multiple client orgs with no per-attendee org mapping, so backfilling them would dump every client's contacts under the master's single org. Master-meeting contacts get captured per-org through normal single-org meetings or manual add instead.
- Skip agendas whose org can't be resolved (null/unassigned) — nothing to file them under.
- Run **once**, via the established in-page Firestore-eval approach (agent-browser) or a temporary admin action — not shipped as recurring code. Idempotent (email-keyed upsert), so re-running is safe.

## 7. Security rules

`firestore.rules` has **no** recursive `match /{document=**}` catch-all (the only recursive wildcards are scoped to `comments`/`files`), so the members subcollection needs its **own explicit nested match block** placed *inside* the existing `match /organizations/{orgId}` block:
```
match /organizations/{orgId} {
  // ... existing org rules (read: isActiveUser; write: isAdmin) ...
  match /members/{memberId} {
    allow read, write: if isActiveUser();   // any active @vistamar user
  }
}
```
**Deliberate divergence:** the parent `organizations` doc is admin-only write (`write: isAdmin`), but `members` must be **read+write for any active user** — the scheduler auto-capture runs for non-admins who schedule meetings. This is intentional; don't "fix" it to match the parent's admin-only write. `isActiveUser()` = signed-in + `@vistamarconsulting.com` + `users/{uid}.active == true`.

## 8. Components / files touched

- `src/pages/Organizations.jsx` — rewrite to expandable banner rows + the two cards.
- New: `src/components/OrgDeliverablesCard.jsx` (display + edit), `src/components/OrgMembersCard.jsx` (list + add/remove).
- `src/components/NewMeetingDialog.jsx`, `src/components/ManageGuestsDialog.jsx` — add the client members dropdown; capture non-Vistamar attendees into the org directory at **save** (`handleCreate`/`handleSave`), skipping master agendas; ManageGuestsDialog resolves its org via `calendarSeries?.organizationId || agenda?.organizationId`.
- Possibly a thin `useOrgMembers(slug)` hook (wraps `useCollection`).
- `firestore.rules` — members subcollection.
- One-time backfill script (not committed as app code).

## 9. Testing & verification

- **Live on Vercel** (primary surface): expand an org row → banner shows in accent color; add/edit deliverables → card renders only non-empty rows in the label→value style; add a member manually → appears; schedule/manage a meeting for that org → client dropdown lists the org's members; type a brand-new client person → they're added to the meeting AND appear in the org's directory afterward.
- Backfill: run once, spot-check a couple of orgs have their known client contacts.
- No unit-testable pure logic of note here (mostly Firestore + UI); the email-sanitize→memberId helper is a small pure function worth a vitest test.

## 10. Out of scope / deferred

- Org identity CRUD (rename, change accent color, change type, archive) — stays seeded in the Firebase console.
- Member job titles/roles, "primary contact," multi-org dedup.
- Driving reporting/quota-tracking off the structured deliverables (the structure allows it later).
