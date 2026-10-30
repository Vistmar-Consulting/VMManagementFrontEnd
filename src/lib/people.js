// src/lib/people.js
//
// Everyone a Task Board item can be assigned to:
//   - the Vistamar team: signed-in users, plus teammates in Vistamar's member
//     directory who have never signed in (organizations/vistamar/members);
//   - each client's contacts (organizations/{org}/members, Client Settings).
// Bots and scheduling proxies (seo@, meetings@, Fireflies) are never offered.
//
// An item's assigneeIds hold a person's id: the users/{uid} id for anyone who
// has signed in, otherwise their lowercased email (Firebase uids never contain
// "@"). When someone with email assignments signs in for the first time, those
// assignments move to their uid (claimEmailAssignments).
import { VISTAMAR_ORG_ID, isClientEmail, isVistamarTeamEmail, memberIdFromEmail } from "./orgMembers.js";

export const EMPTY_PEOPLE = { list: [], byId: {}, idForEmail: () => null, choicesFor: () => [] };

const byName = (a, b) => personName(a).localeCompare(personName(b));

export function personName(p) {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return (p.displayName || full || p.email || p.id || "").trim();
}

// users: users/* docs. membersByOrg: { [orgId]: organizations/{orgId}/members docs }.
export function buildPeople({ users = [], membersByOrg = {} } = {}) {
  const byId = {};
  const byEmail = {};
  const add = (p) => {
    byId[p.id] = p;
    if (p.email) byEmail[p.email] = p;
  };

  // Signed-in users first: their uid is the id, whatever the directories say.
  for (const u of users) {
    const email = memberIdFromEmail(u.email);
    add({ ...u, email, kind: "team", assignable: u.active !== false && isVistamarTeamEmail(email) });
  }
  for (const m of membersByOrg[VISTAMAR_ORG_ID] || []) {
    const email = memberIdFromEmail(m.email);
    if (!email || byEmail[email] || !isVistamarTeamEmail(email)) continue;
    add({ id: email, email, displayName: m.name || email, kind: "team", assignable: true });
  }
  const clientsByOrg = {};
  for (const [orgId, members] of Object.entries(membersByOrg)) {
    if (orgId === VISTAMAR_ORG_ID) continue;
    for (const m of members) {
      const email = memberIdFromEmail(m.email);
      if (!email || !isClientEmail(email)) continue;
      if (!byEmail[email]) add({ id: email, email, displayName: m.name || email, kind: "client", orgId, assignable: true });
      (clientsByOrg[orgId] ||= []).push(byEmail[email]);
    }
  }

  const team = Object.values(byId).filter((p) => p.kind === "team" && p.assignable).sort(byName);
  return {
    list: Object.values(byId),
    byId,
    // The assignee id for an email: the uid of whoever signed in with it,
    // otherwise the email itself (how a not-signed-in person is assigned).
    idForEmail: (email) => {
      const key = memberIdFromEmail(email);
      return key ? (byEmail[key]?.id ?? key) : null;
    },
    // The people offered for an item in this org: the team, then that
    // client's contacts (none for Vistamar's own items).
    choicesFor: (orgId) => [...team, ...(clientsByOrg[orgId] || []).filter((p) => p.assignable).sort(byName)],
  };
}
