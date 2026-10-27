// Pure helpers for Sync Meeting. No Firebase/React imports — unit-tested in
// __tests__/syncMeeting.test.js and shared by the dialog (on receipt) and
// applyUnified (at apply). See spec section 5.1 / 5.2.
import { MOVE_STATUSES } from "./itemStatusMap.js";

// Assign stable, session-local topic ids (t0..tN) preserving array order.
export function mintTopicIds(topics) {
  return (topics || []).map((t, i) => ({ ...t, topicId: `t${i}` }));
}

// Inherit the owning topic's first category + all tags (default policy).
export function inheritKeysForCreate(create, topicsById) {
  const t = topicsById[create?.topicId];
  return {
    categoryId: t?.categoryIds?.[0] ?? null,
    tagIds: Array.isArray(t?.tagIds) ? [...t.tagIds] : [],
  };
}

// Validate a proposal against current topics + the live board. Runs on receipt
// and again at apply (topics may have been refined between). `topics` MUST
// already carry topicId (call mintTopicIds first).
export function validateProposal({ topics, boardChanges, existingTasks }) {
  const byId = Object.fromEntries((topics || []).map((t) => [t.topicId, t]));
  const knownItemIds = new Set((existingTasks || []).map((it) => it.id));
  const moveStatuses = new Set(MOVE_STATUSES);

  const acceptedCreates = [];
  const rejectedCreates = [];
  const rejectedIdxs = new Set();
  const creates = boardChanges?.creates || [];
  for (let idx = 0; idx < creates.length; idx++) {
    const c = creates[idx];
    const t = byId[c.topicId];
    if (!t) {
      rejectedCreates.push({ ...c, reason: "owning topic no longer in proposal" });
      rejectedIdxs.add(idx);
      continue;
    }

    const parentRef = c.parentRef || "";
    if (parentRef) {
      if (parentRef.startsWith("new:")) {
        const n = parseInt(parentRef.slice(4), 10);
        if (isNaN(n) || n < 0 || n >= creates.length) {
          rejectedCreates.push({ ...c, reason: "parentRef new:N index out of range" });
          rejectedIdxs.add(idx); continue;
        }
        if (n === idx) {
          rejectedCreates.push({ ...c, reason: "parentRef self-reference" });
          rejectedIdxs.add(idx); continue;
        }
        const targetParent = creates[n];
        if (targetParent?.parentRef) {
          rejectedCreates.push({ ...c, reason: "parentRef would exceed single nesting depth" });
          rejectedIdxs.add(idx); continue;
        }
      } else {
        if (!knownItemIds.has(parentRef)) {
          rejectedCreates.push({ ...c, reason: "parentRef itemId not found on board" });
          rejectedIdxs.add(idx); continue;
        }
      }
    }
    acceptedCreates.push(c);
  }

  // Second pass: reject subitems whose intra-run parent was itself rejected
  const stillAccepted = [];
  for (const c of acceptedCreates) {
    const ref = c.parentRef || "";
    if (ref.startsWith("new:")) {
      const n = parseInt(ref.slice(4), 10);
      if (rejectedIdxs.has(n)) {
        rejectedCreates.push({ ...c, reason: "parentRef target was rejected" });
        continue;
      }
    }
    stillAccepted.push(c);
  }
  acceptedCreates.length = 0;
  stillAccepted.forEach((c) => acceptedCreates.push(c));

  const acceptedMoves = [];
  const droppedMoves = [];
  for (const m of boardChanges?.moves || []) {
    if (!knownItemIds.has(m.itemId)) { droppedMoves.push({ ...m, reason: "unknown itemId" }); continue; }
    if (!moveStatuses.has(m.toStatus)) { droppedMoves.push({ ...m, reason: "unknown toStatus" }); continue; }
    acceptedMoves.push(m);
  }

  const acceptedNotes = [];
  const droppedNotes = [];
  for (const n of boardChanges?.notes || []) {
    if (!knownItemIds.has(n.itemId)) { droppedNotes.push({ ...n, reason: "unknown itemId" }); continue; }
    acceptedNotes.push(n);
  }

  return {
    acceptedCreates, rejectedCreates,
    acceptedMoves, droppedMoves,
    acceptedNotes, droppedNotes,
    hasRejections: rejectedCreates.length > 0 || droppedMoves.length > 0 || droppedNotes.length > 0,
  };
}

// Downgrade any topic whose `ref` is non-empty but NOT among the current
// agenda's topic ids to a brand-new topic (ref ""). Guards the title-lock and
// the review diff against a hallucinated/stale ref. Pure.
export function normalizeTopicRefs(topics, currentTopicIds) {
  const valid = new Set(currentTopicIds || []);
  return (topics || []).map((t) => {
    const ref = typeof t?.ref === "string" ? t.ref : "";
    return { ...t, ref: ref && valid.has(ref) ? ref : "" };
  });
}

// Classify proposal topics against the current agenda topics for the review
// diff. Returns { statuses, dropped }:
//   statuses[i] = "retained" (proposal topic i is the first to ref a current id)
//                 | "new"
//   dropped     = current topics whose id no proposal topic references
// Pure. Pass current topics as [{ id, name }, ...].
export function classifyTopicChanges(currentTopics, proposalTopics) {
  const currentById = new Map((currentTopics || []).map((t) => [t.id, t]));
  const referenced = new Set();
  const statuses = (proposalTopics || []).map((t) => {
    const ref = typeof t?.ref === "string" ? t.ref : "";
    if (ref && currentById.has(ref) && !referenced.has(ref)) {
      referenced.add(ref);
      return "retained";
    }
    return "new";
  });
  const dropped = (currentTopics || [])
    .filter((t) => !referenced.has(t.id))
    .map((t) => ({ id: t.id, name: t.name || "" }));
  return { statuses, dropped };
}

// Plan the topic writes for an apply. A sync never deletes a topic on its own:
// retained topics are updated in place (same doc id), ref-less topics are
// created, and topics the proposal omits are kept, ordered after the proposal's
// topics. Only ids in deleteTopicIds (omitted topics a person checked) are
// deleted; any other id there throws. Pure. currentTopics in current order.
// Returns { updates: [{ id, topic, sortOrder }], creates: [{ topic, sortOrder }],
//           keeps: [{ id, sortOrder }], deletes: [id] }.
export function planTopicWrites(currentTopics, proposalTopics, deleteTopicIds = []) {
  const { statuses, dropped } = classifyTopicChanges(currentTopics, proposalTopics);
  const droppedIds = new Set(dropped.map((d) => d.id));
  const deletes = [...new Set(deleteTopicIds || [])];
  const bad = deletes.filter((id) => !droppedIds.has(id));
  if (bad.length) throw new Error(`Cannot delete topics the sync keeps or that are not on this agenda: ${bad.join(", ")}`);
  const deleteSet = new Set(deletes);

  const updates = [];
  const creates = [];
  (proposalTopics || []).forEach((topic, i) => {
    if (statuses[i] === "retained") updates.push({ id: topic.ref, topic, sortOrder: i + 1 });
    else creates.push({ topic, sortOrder: i + 1 });
  });
  let next = (proposalTopics || []).length;
  const keeps = dropped
    .filter((d) => !deleteSet.has(d.id))
    .map((d) => ({ id: d.id, sortOrder: ++next }));
  return { updates, creates, keeps, deletes };
}
