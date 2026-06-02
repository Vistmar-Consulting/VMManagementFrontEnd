import { useCollection } from "./useCollection.js";

// Live list of an org's client-member directory (organizations/{slug}/members).
// Passing a falsy slug returns an empty, non-subscribing result (useCollection
// short-circuits a falsy path), so dropdowns can call this before an org is set.
export function useOrgMembers(orgSlug) {
  return useCollection(orgSlug ? `organizations/${orgSlug}/members` : null);
}
