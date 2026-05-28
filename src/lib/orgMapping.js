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
