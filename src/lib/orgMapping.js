// Fallback domain-based resolver. When the Graph event has no numeric
// orgId (Tate's/Cedric's calendars, client-organized meetings), look at
// attendee email domains and resolve from there. Returns the matching slug
// or null.
//
// Rules:
//   1. If ≥1 attendee email matches a known CLIENT domain → that client's slug.
//   2. Else if EVERY non-silent-proxy attendee is @vistamarconsulting.com → vistamar.
//   3. Else null (truly unassigned).
//
// Client domains hardcoded for V2.2.2g. Migrate to organizations/{slug}.emailDomains
// field once an admin tool exists to manage them.
const CLIENT_DOMAINS = {
  "uniohp.com": "unio",
  "brynmawrdermatology.com": "bryn-mawr",
  "totalvisionllc.com": "golden-vision",
  "goldenvisioneye.com": "golden-vision",
  "idcare.com": "id-care",
};
const SILENT_PROXIES = new Set([
  "meetings@vistamarconsulting.com",
  "seo@vistamarconsulting.com",
]);

export function resolveOrgFromAttendees(attendees) {
  if (!Array.isArray(attendees) || attendees.length === 0) return null;
  const realAttendees = attendees.filter(
    (a) => a?.email && !SILENT_PROXIES.has(a.email.toLowerCase())
  );
  if (realAttendees.length === 0) return null;

  // Rule 1 — client domain wins.
  for (const a of realAttendees) {
    const email = a.email.toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 0) continue;
    const domain = email.slice(at + 1);
    if (CLIENT_DOMAINS[domain]) return CLIENT_DOMAINS[domain];
  }

  // Rule 2 — internal-only fallback. Every real attendee must be VM.
  const allVm = realAttendees.every((a) => a.email.toLowerCase().endsWith("@vistamarconsulting.com"));
  if (allVm) return "vistamar";

  return null;
}

// Resolves a Graph/Google event's numeric Console-era `extendedProperties.private.orgId`
// to a Management slug org id.
//
// Bootstrap: each organizations/{slug} doc carries an optional `consoleOrgId`
// (number) field with the numeric ID Console assigned to that org. The
// reconciliation worker fills calendar_series.organizationId from this lookup
// at auto-bind time; unmatched events get `organizationId: null` and surface
// as "Unassigned" until an admin assigns them.
//
// To bootstrap the mapping, an admin sets the consoleOrgId on each org doc
// once (Firebase console UI or a future admin page). Known values from
// Console SQL:
//   -1  → vistamar    (internal)
//    3  → bryn-mawr   (BMD)
//    5  → golden-vision (GV)
//   15  → id-care
//    ?  → unio        (TBD — Andy to fill in)

// Build a lookup `{ numericOrgId: slug }` from the orgs collection. Returns
// an empty object if orgs not yet loaded; consumers should re-derive when the
// orgs array changes.
export function buildConsoleOrgIdLookup(orgs) {
  const lookup = {};
  if (!Array.isArray(orgs)) return lookup;
  for (const org of orgs) {
    const consoleId = org?.consoleOrgId;
    // Accept both number and string forms — Firestore can return either
    // depending on how the doc was authored.
    if (consoleId == null) continue;
    const asString = String(consoleId);
    lookup[asString] = org.id;
  }
  return lookup;
}

// Resolve a graph/google event's numeric orgId to a Management org slug.
// `lookup` is the result of buildConsoleOrgIdLookup. Returns null on miss.
export function resolveOrgSlug(numericOrgId, lookup) {
  if (numericOrgId == null) return null;
  const key = String(numericOrgId);
  return lookup[key] || null;
}
