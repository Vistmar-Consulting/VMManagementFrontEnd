// src/lib/tagScope.js
//
// Shared Tags and Client Tags. A tag with no organizationId is shared: it
// applies to every client (channels like email / website, purposes like
// education / branding). A tag with an organizationId belongs to that one
// organization (ID Care's website sections, Unio's own vocabulary,
// Vistamar's internal hipaa / serp-data / sales-blocker).
//
// Pickers for an item show the shared tags plus its organization's own;
// with no organization chosen (the board on "All") every tag is shown.

export const isSharedTag = (tag) => !tag.organizationId;

// The owner of a tag a sync coins: the one org that coined it, or shared
// (null) when several did or the org is unknown.
export function coinedTagOrg(orgs) {
  const list = [...orgs];
  return list.length === 1 && list[0] ? list[0] : null;
}

export function tagsForOrg(tags, orgId) {
  if (!orgId || orgId === "all") return tags;
  return tags.filter((t) => isSharedTag(t) || t.organizationId === orgId);
}

// A tag list in groups, shared tags first. For one organization: shared
// tags, that organization's own, then any extra tag shown (one an item
// already carries from elsewhere, so it can be removed or filtered). With no
// organization (the board on "All"): shared tags, then each organization's
// tags under its name. orgNames maps organization id to display name. Each
// group's id is unique (labels may not be): use it for keys and boundaries.
export function tagGroups(tags, orgId, { extraIds = [], orgNames = {} } = {}) {
  const shared = { id: "shared", label: "Shared tags", tags: tags.filter(isSharedTag) };
  const label = (id) => (orgNames[id] ? `${orgNames[id]} tags` : "Client tags");
  if (!orgId || orgId === "all") {
    const ownerLabel = (id) => `${orgNames[id] || id} tags`;
    const byOrg = new Map();
    for (const t of tags.filter((tag) => !isSharedTag(tag))) {
      byOrg.set(t.organizationId, [...(byOrg.get(t.organizationId) || []), t]);
    }
    const owned = [...byOrg]
      .map(([id, list]) => ({ id: `org:${id}`, label: ownerLabel(id), tags: list }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [shared, ...owned].filter((g) => g.tags.length);
  }
  const own = tags.filter((t) => t.organizationId === orgId);
  const shown = new Set([...shared.tags, ...own].map((t) => t.id));
  const other = tags.filter((t) => extraIds.includes(t.id) && !shown.has(t.id));
  return [shared, { id: `org:${orgId}`, label: label(orgId), tags: own }, { id: "other", label: "Other tags", tags: other }].filter((g) => g.tags.length);
}
