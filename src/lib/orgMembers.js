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

// Silent bots/proxies that join meetings but are NOT real client contacts —
// the Fireflies notetaker (fred@fireflies.ai / any @fireflies.ai) and the
// scheduling proxies. Mirrors orgMapping.js's isSilentProxy so they never land
// in the member directory.
const BOT_PROXIES = new Set([
  "meetings@vistamarconsulting.com",
  "seo@vistamarconsulting.com",
]);
function isBotOrProxy(id) {
  return id.endsWith("@fireflies.ai") || BOT_PROXIES.has(id);
}

// Client = a valid email that is NOT on the Vistamar domain and NOT a bot/proxy.
export function isClientEmail(email) {
  const id = memberIdFromEmail(email);
  return !!id && !id.endsWith(`@${VM_DOMAIN}`) && !isBotOrProxy(id);
}

// Vistamar's own organization doc. Its members are teammates, not clients, so
// it is special-cased in the schedulers (internal picker, no client dropdown,
// no external-guest capture).
export const VISTAMAR_ORG_ID = "vistamar";

// Teammate = a valid Vistamar-domain email that is NOT a bot/scheduling proxy.
// The inverse of isClientEmail on the domain test, but proxies fail both.
export function isVistamarTeamEmail(email) {
  const id = memberIdFromEmail(email);
  return !!id && id.endsWith(`@${VM_DOMAIN}`) && !isBotOrProxy(id);
}

// Options for the "Add Vistamar teammate…" picker, shared by NewMeetingDialog
// and ManageGuestsDialog so the two can't drift.
//
// Unions organizations/vistamar/members (admin-maintained, needs no app login)
// with the `users` collection (minted on first sign-in). Neither is complete on
// its own: a teammate who has never signed in has no users/ doc, and a teammate
// who signed in may never have been added to the directory. Taking both means
// nobody silently disappears from the scheduler.
//
// The isVistamarTeamEmail gate is load-bearing, not belt-and-braces: external
// guests on a Vistamar-org meeting could otherwise be auto-captured into
// organizations/vistamar/members and then be offered as "teammates" forever.
//
// Org-directory entries are added first so their (admin-curated) display name
// wins over the Google SSO one. Deduped by lowercased email, sorted by name.
export function vistamarTeamChoices({ orgMembers = [], users = [], exclude } = {}) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude || []);
  const byEmail = new Map();

  const add = (email, name) => {
    if (!isVistamarTeamEmail(email)) return;
    const id = memberIdFromEmail(email);
    if (skip.has(id) || byEmail.has(id)) return;
    byEmail.set(id, { email: id, name: name || id });
  };

  for (const m of orgMembers || []) add(m?.email, m?.name);
  for (const u of users || []) {
    add(u?.email, u?.displayName || `${u?.firstName || ""} ${u?.lastName || ""}`.trim());
  }

  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
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
export async function upsertOrgMember(orgSlug, { name, email, source = "manual", allowVMDomain = false }) {
  const id = memberIdFromEmail(email);
  if (!orgSlug || !id) return false;
  if (!allowVMDomain && !isClientEmail(email)) return false;
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
