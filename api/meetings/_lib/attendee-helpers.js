// api/meetings/_lib/attendee-helpers.js
//
// Shared helpers for attendee shape across handlers. Lives outside any
// calendar-provider module so it survives architecture pivots.
//
// Silent calendar proxies (meetings@ + seo@) are auto-prepended to every
// event we create. They appear on the calendar (so meetings@ is on every
// event for centralized scheduling, and seo@ is the Fireflies guest mailbox)
// but are filtered out of FE display + pm.Agenda_Attendees writes.

export const HOST_PROXY_EMAIL = "meetings@vistamarconsulting.com";
export const FIREFLIES_GUEST_EMAIL = "seo@vistamarconsulting.com";
export const SILENT_PROXY_EMAILS = [HOST_PROXY_EMAIL, FIREFLIES_GUEST_EMAIL];
export const VM_DOMAIN = "@vistamarconsulting.com";

export function isVmEmail(email) {
  if (typeof email !== "string" || !email) return false;
  return email.toLowerCase().endsWith(VM_DOMAIN);
}

export function isSilentProxy(email) {
  if (typeof email !== "string" || !email) return false;
  return SILENT_PROXY_EMAILS.includes(email.toLowerCase());
}

// Prepend meetings@ then seo@ if absent (case-insensitive). Order matters:
// meetings@ ends up first, then seo@, then real attendees. This is what
// every calendar event create/recreate path uses.
//
// Dev-only opt-out: set MEETINGS_SKIP_FIREFLIES_FOR_TESTS=1 in .env.local to
// suppress the seo@ prepend. seo@ has email forwarding to every VM team
// member, so smoke tests that mint real calendar events would spam the team.
// This flag is NEVER set in production. meetings@ continues to be prepended.
export function withSilentProxies(attendees) {
  const list = Array.isArray(attendees) ? [...attendees] : [];
  const skipFireflies = process.env.MEETINGS_SKIP_FIREFLIES_FOR_TESTS === "1";
  const proxies = skipFireflies
    ? [{ email: HOST_PROXY_EMAIL, name: "Meetings Vistamar" }]
    : [
        { email: HOST_PROXY_EMAIL, name: "Meetings Vistamar" },
        { email: FIREFLIES_GUEST_EMAIL, name: "Vistamar SEO" },
      ];
  // Iterate in reverse so the unshifts produce [meetings@, seo@, ...originals]
  // (or just [meetings@, ...originals] when skipFireflies).
  for (let i = proxies.length - 1; i >= 0; i--) {
    const proxy = proxies[i];
    const has = list.some((a) => a.email?.toLowerCase() === proxy.email);
    if (!has) list.unshift(proxy);
  }
  return list;
}

// Backwards-compatible alias retained for any not-yet-migrated callers.
// Prefer withSilentProxies in new code.
export const withFirefliesGuest = withSilentProxies;
