# Organizations Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add to Settings → Organizations: an accent-color banner per org, a structured content-deliverables card, and an org-scoped client-member directory that the Meeting Scheduler auto-captures into (so client attendees autofill from a dropdown).

**Architecture:** Pure helpers (`src/lib/orgMembers.js`) for member-id/email/summary logic + Firestore upsert helpers. A thin `useOrgMembers(slug)` hook over the existing `useCollection`. Two new cards (`OrgDeliverablesCard`, `OrgMembersCard`) hosted in a rewritten `Organizations.jsx` (expandable banner rows). The scheduler dialogs (`NewMeetingDialog`, `ManageGuestsDialog`) gain a client dropdown sourced from the org's members and capture non-Vistamar attendees into the directory **at save**. A nested `firestore.rules` members block. A one-time backfill.

**Tech Stack:** React 18 + Vite + MUI 5 + Emotion; Firebase Web SDK 11 (`useCollection`/`useDoc`, `setDoc`/`updateDoc`/`deleteDoc`); vitest for pure-lib tests.

**Spec:** `docs/superpowers/specs/2026-06-02-organizations-settings-design.md` (read first).

**Project conventions (CLAUDE.md):**
- Work on local `main`; deploy `git push origin main:dev` → wait for Vercel Ready → `vercel alias set <deploy-url> vm-management-front-end.vercel.app`. No local feature branches.
- Primary test surface = deployed Vercel site + live Firestore. Pure logic gets vitest; UI/Firestore get build + live verification via `/agent-browser` (UI HARD GATE).
- **`npm run lint` is broken project-wide** (no ESLint config) — do NOT run it; gate on `npm run build` + `npm run test`.
- No `console.log` in committed code; no commented-out code; PascalCase components, camelCase utils; lower-camelCase field names.
- **`firestore.rules` changes require a separate deploy** (`firebase deploy --only firestore:rules`) — they do NOT ship via the Vercel push. Member writes will be `permission-denied` until the rules are deployed. Flag to Andy if the firebase CLI isn't authed.

---

## File Structure

**Create:**
- `src/lib/orgMembers.js` — pure: `memberIdFromEmail(email)`, `isClientEmail(email)`, `deliverablesSummary(deliverables)`; + Firestore helpers `upsertOrgMember(slug, {name,email,source})`, `removeOrgMember(slug, memberId)`.
- `src/lib/__tests__/orgMembers.test.js` — vitest for the three pure functions.
- `src/hooks/useOrgMembers.js` — thin `useCollection("organizations/{slug}/members")` wrapper.
- `src/components/OrgMembersCard.jsx` — members list + add/remove.
- `src/components/OrgDeliverablesCard.jsx` — config-card display + edit dialog.

**Modify:**
- `src/pages/Organizations.jsx` — expandable banner rows hosting the two cards.
- `src/components/NewMeetingDialog.jsx` — client members dropdown + save-time capture in `handleCreate`.
- `src/components/ManageGuestsDialog.jsx` — resolve org, client dropdown + save-time capture in `handleSave` (skip master).
- `firestore.rules` — nested `members` block.

**One-time (not committed as app code):** backfill script run via agent-browser eval.

---

## Task 1: Pure helpers + Firestore member helpers — TDD on the pure parts

**Files:**
- Create: `src/lib/orgMembers.js`
- Test: `src/lib/__tests__/orgMembers.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { memberIdFromEmail, isClientEmail, deliverablesSummary } from "../orgMembers.js";

describe("memberIdFromEmail", () => {
  it("lowercases and trims a valid email", () => {
    expect(memberIdFromEmail("  David@UnioHP.com ")).toBe("david@uniohp.com");
  });
  it("returns null for malformed input (no @, no dot after @, whitespace)", () => {
    expect(memberIdFromEmail("notanemail")).toBeNull();
    expect(memberIdFromEmail("a@b")).toBeNull();
    expect(memberIdFromEmail("a b@x.com")).toBeNull();
    expect(memberIdFromEmail("")).toBeNull();
    expect(memberIdFromEmail(null)).toBeNull();
  });
});

describe("isClientEmail", () => {
  it("true for non-vistamar domains", () => {
    expect(isClientEmail("david@uniohp.com")).toBe(true);
  });
  it("false for vistamar (any case)", () => {
    expect(isClientEmail("adeemer@VistamarConsulting.com")).toBe(false);
  });
  it("false for malformed", () => {
    expect(isClientEmail("nope")).toBe(false);
  });
});

describe("deliverablesSummary", () => {
  it("joins the labels of set deliverables with a middot", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Social posts", quantity: 8, cadence: "month" },
    ])).toBe("Blog posts · Social posts");
  });
  it("omits rows with no positive quantity", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Empty", quantity: 0, cadence: "month" },
      { label: "Nullq", cadence: "month" },
    ])).toBe("Blog posts");
  });
  it("returns an em dash for empty/no deliverables", () => {
    expect(deliverablesSummary([])).toBe("—");
    expect(deliverablesSummary(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- orgMembers`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/orgMembers.js`**

```js
// Org client-member directory helpers. The pure functions (memberIdFromEmail,
// isClientEmail, deliverablesSummary) are unit-tested in __tests__/orgMembers.test.js.
// The Firestore helpers (upsertOrgMember, removeOrgMember) are verified live.
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";

const VM_DOMAIN = "vistamarconsulting.com";

// Doc-id = lowercased, trimmed email. A valid email always satisfies Firestore
// doc-id rules (not "."/"..", can't match ^__.*__$ since it ends in a TLD, well
// under 1500 bytes, no "/"). Returns null for anything not a plausible email so
// callers skip the write.
export function memberIdFromEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || /\s/.test(e)) return null;
  const at = e.indexOf("@");
  if (at <= 0) return null;
  const domain = e.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  return e;
}

// Client = a valid email NOT on the Vistamar domain.
export function isClientEmail(email) {
  const id = memberIdFromEmail(email);
  return !!id && !id.endsWith(`@${VM_DOMAIN}`);
}

// One-line summary for the deliverables card header: the labels of deliverables
// with a positive quantity, joined by " · "; "—" when none.
export function deliverablesSummary(deliverables) {
  const labels = (Array.isArray(deliverables) ? deliverables : [])
    .filter((d) => d && Number(d.quantity) > 0 && d.label)
    .map((d) => d.label);
  return labels.length ? labels.join(" · ") : "—";
}

// Upsert a client member into organizations/{slug}/members, keyed by email.
// Merge so re-adding an existing person updates the name without clobbering
// createdAt. No-op (returns false) for non-client / malformed emails.
export async function upsertOrgMember(orgSlug, { name, email, source = "manual" }) {
  if (!orgSlug || !isClientEmail(email)) return false;
  const id = memberIdFromEmail(email);
  await setDoc(
    doc(db, "organizations", orgSlug, "members", id),
    { name: name || email, email: id, source, createdAt: serverTimestamp() },
    { merge: true },
  );
  return true;
}

export async function removeOrgMember(orgSlug, memberId) {
  if (!orgSlug || !memberId) return;
  await deleteDoc(doc(db, "organizations", orgSlug, "members", memberId));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- orgMembers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orgMembers.js src/lib/__tests__/orgMembers.test.js
git commit -m "feat(orgs): org-member helpers (id/email/summary pure fns + upsert/remove)"
```

---

## Task 2: firestore.rules — nested members block

**Files:**
- Modify: `firestore.rules` (inside `match /organizations/{orgId}`, ~lines 61-63)

- [ ] **Step 1:** Read `firestore.rules` lines 60-66. Confirm `isActiveUser()` (line 32) and the `match /organizations/{orgId}` block (read: isActiveUser; write: isAdmin).
- [ ] **Step 2:** Add a nested block inside `match /organizations/{orgId} { ... }`:
```
      // Client member directory — read+write for any active user (NOT admin-only
      // like the org doc), so non-admins' meeting scheduling can auto-capture
      // contacts. Deliberate divergence from the parent's admin-only write.
      match /members/{memberId} {
        allow read, write: if isActiveUser();
      }
```
- [ ] **Step 3: Deploy the rules** (does NOT ship via Vercel):
```bash
firebase deploy --only firestore:rules
```
Expected: "✔ Deploy complete!". If the firebase CLI isn't authenticated, STOP and tell Andy — member writes will be permission-denied until this lands.
- [ ] **Step 4: Commit**
```bash
git add firestore.rules
git commit -m "feat(orgs): firestore rules for organizations/{slug}/members (active-user RW)"
```

---

## Task 3: `useOrgMembers` hook

**Files:**
- Create: `src/hooks/useOrgMembers.js`
- Reference: `src/hooks/useCollection.js` (subcollection paths work — `AgendaDetail` uses `useCollection("agendas/{id}/topics")`)

- [ ] **Step 1:** Implement a thin wrapper:
```js
import { useCollection } from "./useCollection.js";
// Live list of an org's client members. Empty/disabled when no slug.
export function useOrgMembers(orgSlug) {
  return useCollection(orgSlug ? `organizations/${orgSlug}/members` : null);
}
```
(Confirm `useCollection` accepts a null/falsy path and returns empty without subscribing; if it doesn't, guard inside the hook by returning `{ data: [], loading: false }` when `!orgSlug`. Read `useCollection.js` to verify its null-path behavior and match it.)
- [ ] **Step 2: Build + commit**
```bash
npm run build
git add src/hooks/useOrgMembers.js
git commit -m "feat(orgs): useOrgMembers hook"
```

---

## Task 4: `OrgMembersCard`

**Files:**
- Create: `src/components/OrgMembersCard.jsx`
- Reference: `ManageGuestsDialog.jsx` (Autocomplete/add-row patterns, MUI usage), `src/theme` for styling conventions

- [ ] **Step 1:** Build a card (props: `{ orgSlug }`) that:
  - Uses `useOrgMembers(orgSlug)` to list members (`name` + `email`), sorted by name.
  - Has an **+ Add** inline row: name field + email field + Add button → `upsertOrgMember(orgSlug, { name, email, source: "manual" })` (from `src/lib/orgMembers.js`); clears the fields on success; shows an inline error if `isClientEmail` is false (e.g. "Enter a valid non-Vistamar email").
  - Each member row has a remove (✕) → `removeOrgMember(orgSlug, member.id)` (member.id is the email doc-id).
  - Empty state: "No members yet — added automatically when you schedule meetings, or add one above."
  - No `console.log`. Functional component + hooks.
- [ ] **Step 2: Build + commit**
```bash
npm run build
git add src/components/OrgMembersCard.jsx
git commit -m "feat(orgs): OrgMembersCard (list + manual add/remove)"
```

---

## Task 5: `OrgDeliverablesCard`

**Files:**
- Create: `src/components/OrgDeliverablesCard.jsx`

- [ ] **Step 1:** Build a card (props: `{ org }`, where `org` is the org doc incl. `id`, `deliverables`, `deliverablesNote`) in the config-card style:
  - Header: title **Content Deliverables**, summary line = `deliverablesSummary(org.deliverables)` (from `orgMembers.js`), and an **Edit** button (top-right).
  - Divider, then `LABEL → value` rows — **only** `deliverables` with `quantity > 0`: label uppercased gray on the left, `{quantity} / {cadence}` on the right. If `deliverablesNote` is set, a final `NOTE → {note}` row.
  - Empty state (no positive-quantity rows and no note): "No deliverables set — Edit to add."
  - **Edit** opens a dialog: a small editable table of rows `{ label, quantity, cadence, note }` (per-row `note` is an optional text field, per spec §3) with add/remove, a `cadence` select (`week`/`month`/`quarter`), plus a multiline org-level `deliverablesNote` field. Save → `updateDoc(doc(db,"organizations",org.id), { deliverables: rows.filter(r=>r.label).map(r=>({ ...r, quantity: Number(r.quantity)||0 })), deliverablesNote })`. (Filter out blank-label rows.) In the display rows, if a deliverable has a `note`, show it as a small caption under that row's value.
- [ ] **Step 2: Build + commit**
```bash
npm run build
git add src/components/OrgDeliverablesCard.jsx
git commit -m "feat(orgs): OrgDeliverablesCard (config-card display + edit, hides empty rows)"
```

---

## Task 6: Rewrite `Organizations.jsx` — expandable banner rows

**Files:**
- Modify: `src/pages/Organizations.jsx`
- Reference: `src/theme/pillColors.js` (`getContrastText`, `hexToRgba`)

- [ ] **Step 1:** Rewrite the org list so each org is a row/card with:
  - **Sort the orgs by `sortOrder`** before rendering — `[...orgs].sort((a,b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))` — matching every other org-list site (`NewMeetingDialog.jsx:298`, `OrgAssignDialog.jsx:46`). (Vistamar=1 first, then the clients.)
  - A **full-width top banner** in `org.accentColor` (fallback `#888`), with the org name in `getContrastText(accentColor)` text — replacing the 12px dot.
  - A clickable header (banner + name + `type` + archived flag) that toggles an expanded state (local `useState` of the open org id, or a MUI `Collapse`/`Accordion`).
  - **Archived orgs:** render them inline but **dimmed** (reduced opacity) with an "archived" label; no show/hide filter toggle in v1.
  - When expanded: render `<OrgDeliverablesCard org={org} />` and `<OrgMembersCard orgSlug={org.id} />` stacked.
  - Keep the existing loading/error states. Drop the "create/edit/archive lands later" alert or keep it — your call, but don't add CRUD.
- [ ] **Step 2: Build + commit**
```bash
npm run build
git add src/pages/Organizations.jsx
git commit -m "feat(orgs): expandable org rows with accent banner + deliverables/members cards"
```

---

## Task 7: `NewMeetingDialog` — client dropdown + save-time capture

**Files:**
- Modify: `src/components/NewMeetingDialog.jsx`

- [ ] **Step 1:** Read the dialog fully — `orgId` state (line 94), `attendees` (95), `internalOptions` from `useCollection("users")`, `handleAddExternal` (141), `handleCreate` (161, writes `organizationId: orgId, attendees: apiAttendees` ~191).
- [ ] **Step 2:** Add a **client members Autocomplete** mirroring the Vistamar one, sourced from `useOrgMembers(orgId)` (filtered to members not already in `attendees`). Picking one → `addAttendee({ email: m.email, name: m.name })`. Keep the existing manual external entry as the "new person" path. (The dropdown is empty/disabled until an org is selected.)
- [ ] **Step 3:** In `handleCreate`, **after** the agenda write succeeds, capture contacts:
```js
// Auto-capture non-Vistamar attendees into the org's member directory.
await Promise.all(
  attendees
    .filter((a) => isClientEmail(a.email))
    .map((a) => upsertOrgMember(orgId, { name: a.name, email: a.email, source: "scheduler" })),
);
```
(Import `isClientEmail`, `upsertOrgMember` from `../lib/orgMembers.js`. NewMeetingDialog is always a single-org create, so no master check needed here.) Wrap the capture in a `try { … } catch { /* best-effort: directory capture must never fail the meeting create; idempotent, re-captured on the next save */ }` — **swallow silently** (do NOT route to `setError`; the meeting already succeeded/navigated, so an error there would be misleading). No `console.log`.
- [ ] **Step 4: Build + commit**
```bash
npm run build
git add src/components/NewMeetingDialog.jsx
git commit -m "feat(orgs): NewMeetingDialog client dropdown + save-time member capture"
```

---

## Task 8: `ManageGuestsDialog` — resolve org + client dropdown + save-time capture (skip master)

**Files:**
- Modify: `src/components/ManageGuestsDialog.jsx`

- [ ] **Step 1:** Read it — props `{ agenda, agendaId, calendarSeries, users, onClose }` (39), `working` attendee state, `handleAddExternal` (85), `handleSave` (97, builds `merged` ~107, `updateDoc`).
- [ ] **Step 2:** Resolve the org + master flag at the top of the component:
```js
const orgSlug = calendarSeries?.organizationId || agenda?.organizationId || null;
const isMaster = !!(calendarSeries?.masterAgenda || agenda?.masterAgenda);
```
- [ ] **Step 3:** Add the **client members Autocomplete** from `useOrgMembers(orgSlug)` (filtered against `working`), mirroring the Vistamar dropdown — picking → `addAttendee`. (Empty/disabled if `!orgSlug` or `isMaster`.)
- [ ] **Step 4:** In `handleSave`, **after** the `updateDoc` succeeds, capture — but **skip when `isMaster`** (its attendees span multiple orgs and would be misfiled):
```js
if (orgSlug && !isMaster) {
  await Promise.all(
    working
      .filter((a) => isClientEmail(a.email))
      .map((a) => upsertOrgMember(orgSlug, { name: a.name, email: a.email, source: "scheduler" })),
  );
}
```
(Wrap in `try { … } catch { /* best-effort, idempotent; never fail the save */ }` and **swallow silently** — same rationale as NewMeetingDialog. No `console.log`, no `setError`.)
- [ ] **Step 5: Build + commit**
```bash
npm run build
git add src/components/ManageGuestsDialog.jsx
git commit -m "feat(orgs): ManageGuestsDialog client dropdown + save-time capture (skips master)"
```

---

## Task 9: Deploy + one-time backfill (controller-run)

**No committed app code.** Deploy the feature, deploy rules (Task 2), then seed the directories.

- [ ] **Step 1:** Push + deploy: `git push origin main:dev`, wait for Vercel Ready, `vercel alias set <url> vm-management-front-end.vercel.app`. Confirm `firestore.rules` was deployed (Task 2).
- [ ] **Step 2:** Backfill via agent-browser eval on the authenticated site (guard `location.hostname === "vm-management-front-end.vercel.app"`). **Use the in-page SDK `db` via dynamic import for BOTH reads and writes** (`const { collection, getDocs, doc, setDoc } = await import(...)` against the app's already-initialized Firestore), not hand-rolled REST — matches the established agent-browser Firestore-eval pattern. The script:
  - reads all `agendas`, and all `calendar_series` (for org resolution);
  - for each agenda: skip if `masterAgenda === true`; resolve `org = calendar_series[agenda.calendarSeriesId]?.organizationId || agenda.organizationId`; skip if no org;
  - for each attendee with a non-`@vistamarconsulting.com` email, `setDoc`-merge `organizations/{org}/members/{lowercasedEmail}` = `{ name, email, source:"backfill" }`.
  - **Use full untruncated doc ids**; idempotent (email-keyed). Log a per-org count of seeded members.
- [ ] **Step 3:** Spot-check 2 orgs (e.g. Unio, ID Care) now have their known client contacts in the directory.

---

## Task 10: Live E2E verification (Vercel + agent-browser) — UI HARD GATE

**No code unless a defect is found.**

- [ ] **Settings:** expand an org row → accent **banner** shows with readable text; **Deliverables** card renders (after you add a couple rows via Edit) in the label→value style with **no empty rows**; **Members** card lists backfilled contacts; manual **+ Add** adds a member; remove works.
- [ ] **Scheduler — existing-member autofill:** open NewMeetingDialog for an org with members → the **client dropdown** lists them; pick one → added without typing.
- [ ] **Scheduler — new-person capture:** type a brand-new client person (name+email), create the meeting, then re-open Settings → that person is now in the org's Members directory (`source: scheduler`).
- [ ] **ManageGuests:** on an existing client agenda, the client dropdown is populated (org resolved via calendar_series); add a new client guest, Save → appears in the directory.
- [ ] **Master guard:** open ManageGuests on the master Touch Base → confirm it does NOT try to org-scope/capture (dropdown empty/manual; no misfiled members).
- [ ] Report results (screenshots) to Andy.

---

## Notes for the executor
- Member doc-id = lowercased email (`memberIdFromEmail`) — never truncate ids.
- Capture is **save-time**, in `handleCreate`/`handleSave`, over the final attendee list — NOT per-add (a cancelled dialog must not write members).
- `firestore.rules` must be deployed separately (Task 2) or member writes are permission-denied.
- Pure logic (`orgMembers.js`) is the only vitest-tested part; everything else is build + live verification (no Anthropic/Firestore mocks).
- lower-camelCase fields: `deliverables`, `deliverablesNote`, `members`, `accentColor`.
