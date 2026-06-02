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
