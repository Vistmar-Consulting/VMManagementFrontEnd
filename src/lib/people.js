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

// Every id an item may hold for this person: their id, and for someone who
// signed in, the email they may have been assigned by before.
export const personIds = (p) => (p.email && p.email !== p.id ? [p.id, p.email] : [p.id]);

// users: users/* docs. membersByOrg: { [orgId]: organizations/{orgId}/members docs }.
export function buildPeople({ users = [], membersByOrg = {} } = {}) {
  const list = [];
  const byEmail = {};
  const add = (p) => {
    list.push(p);
    if (p.email) byEmail[p.email] = p;
    return p;
  };

  // Signed-in users first: their uid is the id, whatever the directories say.
  for (const u of users) {
    const email = memberIdFromEmail(u.email);
    add({ ...u, email, kind: "team", orgIds: [], assignable: u.active !== false && isVistamarTeamEmail(email) });
  }
  for (const m of membersByOrg[VISTAMAR_ORG_ID] || []) {
    const email = memberIdFromEmail(m.email);
    if (!email || byEmail[email] || !isVistamarTeamEmail(email)) continue;
    add({ id: email, email, displayName: m.name || email, kind: "team", orgIds: [], assignable: true });
  }
  const clientsByOrg = {};
  for (const [orgId, members] of Object.entries(membersByOrg)) {
    if (orgId === VISTAMAR_ORG_ID) continue;
    for (const m of members) {
      const email = memberIdFromEmail(m.email);
      if (!email || !isClientEmail(email)) continue;
      const p = byEmail[email] || add({ id: email, email, displayName: m.name || email, kind: "client", orgIds: [], assignable: true });
      if (!p.orgIds.includes(orgId)) p.orgIds.push(orgId);
      (clientsByOrg[orgId] ||= []).push(p);
    }
  }

  // A signed-in person is also found by their email: an item assigned by
  // email before they signed in still shows them while claimEmailAssignments
  // moves it to their uid (or if that hasn't run yet).
  const byId = {};
  for (const p of list) for (const id of personIds(p)) byId[id] = p;

  const team = list.filter((p) => p.kind === "team" && p.assignable).sort(byName);
  return {
    list,
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
