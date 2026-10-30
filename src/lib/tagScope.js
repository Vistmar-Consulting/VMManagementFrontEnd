// src/lib/tagScope.js
//
// Shared Tags and Client Tags. A tag with no organizationId is shared: it
// applies to every client (channels like email / website, purposes like
// education / urgent). A tag with an organizationId belongs to that one
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

// An item's tag picker, in groups: shared tags, the organization's tags, and
// any tag the item already carries from elsewhere (so it can be removed).
export function tagGroupsForItem(tags, orgId, selectedIds = []) {
  const shared = tags.filter(isSharedTag);
  const own = tags.filter((t) => t.organizationId && t.organizationId === orgId);
  const shown = new Set([...shared, ...own].map((t) => t.id));
  const other = tags.filter((t) => selectedIds.includes(t.id) && !shown.has(t.id));
  return [
    { label: "Shared tags", tags: shared },
    { label: "Client tags", tags: own },
    { label: "Other tags on this item", tags: other },
  ].filter((g) => g.tags.length);
}
