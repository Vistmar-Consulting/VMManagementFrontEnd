// Pure helpers for Sync Meeting. No Firebase/React imports — unit-tested in
// __tests__/syncMeeting.test.js and shared by the dialog (on receipt) and
// applyUnified (at apply). See spec section 5.1 / 5.2.
import { MOVE_STATUSES } from "./itemStatusMap.js";

// Assign stable, session-local topic ids (t0..tN) preserving array order.
export function mintTopicIds(topics) {
  return (topics || []).map((t, i) => ({ ...t, topicId: `t${i}` }));
}

function topicHasCategory(t) {
  return Array.isArray(t?.categoryIds) && t.categoryIds.length > 0;
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
  for (const c of boardChanges?.creates || []) {
    const t = byId[c.topicId];
    if (!t) { rejectedCreates.push({ ...c, reason: "owning topic no longer in proposal" }); continue; }
    if (!topicHasCategory(t)) { rejectedCreates.push({ ...c, reason: "owning topic has no category to inherit" }); continue; }
    acceptedCreates.push(c);
  }

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
