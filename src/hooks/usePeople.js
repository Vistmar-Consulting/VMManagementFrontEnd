// src/hooks/usePeople.js
//
// Live people directory for assignee pickers (see lib/people.js): users plus
// every organization's member directory.
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { buildPeople } from "../lib/people.js";

export function usePeople(users, orgs) {
  const orgKey = (orgs || []).map((o) => o.id).sort().join(",");
  const [membersByOrg, setMembersByOrg] = useState({});

  useEffect(() => {
    const orgIds = orgKey ? orgKey.split(",") : [];
    // Drop a removed org's contacts.
    setMembersByOrg((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => orgIds.includes(id))));
    if (!orgIds.length) return undefined;
    const unsubs = orgIds.map((orgId) => onSnapshot(
      collection(db, "organizations", orgId, "members"),
      (snap) => setMembersByOrg((prev) => ({ ...prev, [orgId]: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })),
      // A directory that can't be read leaves that org's contacts out of the
      // pickers; the rest of the board is unaffected.
      (err) => console.error(`[usePeople] organizations/${orgId}/members:`, err),
    ));
    return () => unsubs.forEach((u) => u());
  }, [orgKey]);

  return useMemo(() => buildPeople({ users: users || [], membersByOrg }), [users, membersByOrg]);
}
