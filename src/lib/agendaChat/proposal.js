// src/lib/agendaChat/proposal.js
//
// The agenda half of an Agenda Chat proposal (agendaOps) → review rows
// (validated, with before/after) → the Firestore writes for the rows the user
// kept. Pure; no Firebase imports.
//
// Besides topic text and order, an op can change which Task Board items a
// topic card shows: update_topic's categoryIds / tagIds (replacing the
// topic's lists), and remove_task / restore_task (the card's hand-removed
// items, lib/topicItems.js). Those use the board ctx; a tag or category the
// board half of the same proposal creates is named by its tempId and given
// its real id when the plan is made (planAgendaWrites' newIds).
import { sanitizeHtml } from "../agendaHtml.js";
import { toMillis } from "../boardChat/snapshot.js";
import { topicItems, topicOrgId } from "../topicItems.js";
import { OPEN_FLOOR } from "./context.js";

// The Open Floor's baseline is its content (see context.js seenOf).
const openFloorStale = (seen, currentHtml) => typeof seen[OPEN_FLOOR] === "string" && seen[OPEN_FLOOR] !== currentHtml;

const OPS = new Set(["create_topic", "update_topic", "delete_topic", "move_topic", "set_open_floor", "remove_task", "restore_task"]);
const START = "start";

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// A topic's new categories and tags, checked against what exists once the
// proposal's board half applies (board.categoryIds / board.tagsFor). A tag
// the topic already has may stay even if no longer offered for its org.
function topicKeys(raw, topic, board) {
  const out = {};
  for (const field of ["categoryIds", "tagIds"]) {
    if (raw[field] === undefined) continue;
    const ids = raw[field];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) throw new Error(`${field} must be an array of ids`);
    const unique = [...new Set(ids)];
    const current = topic[field] || [];
    if (field === "categoryIds") {
      const bad = unique.filter((id) => !board.categoryIds.has(id));
      if (bad.length) throw new Error(`Unknown category ${bad.join(", ")}`);
    } else {
      const allowed = board.tagsFor(topicOrgId(topic, board.agendaOrgId));
      const bad = unique.filter((id) => !current.includes(id) && !allowed.has(id));
      if (bad.length) throw new Error(`Tag ${bad.join(", ")} is not a shared tag or this topic's organization's own`);
    }
    if (!sameSet(unique, current)) out[field] = { before: current, after: unique };
  }
  return out;
}

// ctx: { topics (agenda order), agenda, isMaster, orgIds: Set, seen,
//        board?: { items, agendaOrgId, categoryIds: Set, tagsFor(orgId) → Set } }
export function buildReviewRows(ops, { topics, agenda, isMaster, orgIds, seen = {}, board = null }) {
  const byId = new Map((topics || []).map((tp) => [tp.id, tp]));
  const deletedBy = new Map();
  const changedBy = new Map();
  // Items whose place on a topic card a remove_task / restore_task changes.
  const linkedBy = new Map();
  const linkedTopics = new Map();
  const itemsById = new Map((board?.items || []).map((it) => [it.id, it]));
  let openFloorBy = null;
  const stale = (id, live) => seen[id] != null && toMillis(live) != null && toMillis(live) > seen[id];

  return (ops || []).map((raw, index) => {
    const op = raw?.op;
    const row = { index, op, reason: raw?.reason || "", ok: true, error: null, stale: false };
    const fail = (error) => ({ ...row, ok: false, error });
    if (!OPS.has(op)) return fail(`Unknown op "${op}"`);

    if (op === "set_open_floor") {
      if (typeof raw.bodyHtml !== "string") return fail("set_open_floor needs bodyHtml");
      if (openFloorBy !== null) return fail(`The Open Floor is already rewritten by change ${openFloorBy + 1}`);
      openFloorBy = index;
      const beforeHtml = sanitizeHtml(agenda?.openFloorHtml || "");
      return { ...row, beforeHtml, afterHtml: sanitizeHtml(raw.bodyHtml), stale: openFloorStale(seen, beforeHtml) };
    }

    if (op === "create_topic") {
      const name = String(raw.name ?? "").trim();
      if (!name) return fail("A new topic needs a title");
      let orgId = null;
      if (isMaster) {
        if (!raw.orgId || !orgIds.has(raw.orgId)) return fail("On the master agenda a new topic needs a valid orgId");
        orgId = raw.orgId;
      }
      const after = raw.afterTopicId || null;
      if (after && after !== START) {
        const anchor = byId.get(after);
        if (!anchor) return fail(`afterTopicId ${after} is not a topic on this agenda`);
        if (deletedBy.has(after)) return fail(`afterTopicId ${after} is deleted by change ${deletedBy.get(after) + 1}`);
        if (isMaster && anchor.organizationId !== orgId) return fail("A new topic must sit inside its organization's group");
      }
      return { ...row, name, orgId, afterTopicId: after, afterHtml: sanitizeHtml(raw.bodyHtml || "") };
    }

    const topic = byId.get(raw.topicId);
    if (!topic) return fail(`${raw.topicId || "(no topicId)"} is not a topic on this agenda`);
    if (deletedBy.has(topic.id)) return fail(`That topic is deleted by change ${deletedBy.get(topic.id) + 1}`);
    const base = { ...row, topicId: topic.id, topicName: topic.name || "(untitled)", stale: stale(topic.id, topic.updatedAt) };

    if (op === "delete_topic") {
      const by = changedBy.get(topic.id) ?? linkedTopics.get(topic.id);
      if (by !== undefined) return fail(`That topic is changed by change ${by + 1}`);
      deletedBy.set(topic.id, index);
      return { ...base, beforeHtml: sanitizeHtml(topic.bodyHtml || "") };
    }
    if (op === "update_topic") {
      const hasName = typeof raw.name === "string" && raw.name.trim() !== "";
      const hasBody = typeof raw.bodyHtml === "string";
      const hasKeys = raw.categoryIds !== undefined || raw.tagIds !== undefined;
      if (!hasName && !hasBody && !hasKeys) return fail("update_topic needs a name, bodyHtml, categoryIds or tagIds");
      if (hasKeys && !board) return fail("Topic categories and tags can't be changed here");
      if (changedBy.has(topic.id)) return fail(`That topic is already changed by change ${changedBy.get(topic.id) + 1}`);
      let keys = {};
      try {
        keys = hasKeys ? topicKeys(raw, topic, board) : {};
      } catch (err) {
        return fail(err.message);
      }
      const renamed = hasName && raw.name.trim() !== topic.name;
      if (!renamed && !hasBody && Object.keys(keys).length === 0) return fail("No change from the topic as it is");
      changedBy.set(topic.id, index);
      return {
        ...base,
        ...(renamed ? { name: raw.name.trim() } : {}),
        ...(hasBody ? { beforeHtml: sanitizeHtml(topic.bodyHtml || ""), afterHtml: sanitizeHtml(raw.bodyHtml) } : {}),
        ...(Object.keys(keys).length ? { keys } : {}),
      };
    }
    if (op === "remove_task" || op === "restore_task") {
      if (!board) return fail("Topic cards' tasks can't be changed here");
      const item = itemsById.get(raw.itemId);
      if (!item) return fail(`Item ${raw.itemId || "(none)"} not found`);
      if (linkedBy.has(`${topic.id}:${item.id}`)) return fail(`That task already has a change on this topic in change ${linkedBy.get(`${topic.id}:${item.id}`) + 1}`);
      const removed = topic.excludedItemIds || [];
      if (op === "remove_task" && !topicItems(topic, board.items, board.agendaOrgId).some((it) => it.id === item.id)) {
        return fail("That task isn't on this topic card");
      }
      if (op === "restore_task" && !removed.includes(item.id)) return fail("That task wasn't removed from this topic card");
      linkedBy.set(`${topic.id}:${item.id}`, index);
      if (!linkedTopics.has(topic.id)) linkedTopics.set(topic.id, index);
      return { ...base, itemId: item.id };
    }
    // move_topic
    const after = raw.afterTopicId;
    if (!after) return fail("move_topic needs afterTopicId (a topic id or \"start\")");
    if (after === topic.id) return fail("A topic cannot follow itself");
    if (after !== START) {
      const anchor = byId.get(after);
      if (!anchor) return fail(`afterTopicId ${after} is not a topic on this agenda`);
      if (deletedBy.has(after)) return fail(`afterTopicId ${after} is deleted by change ${deletedBy.get(after) + 1}`);
      if (isMaster && anchor.organizationId !== topic.organizationId) return fail("A topic must stay inside its organization's group");
      return { ...base, afterTopicId: after, afterName: anchor.name || "(untitled)" };
    }
    return { ...base, afterTopicId: START };
  });
}

// Staleness again, against the agenda as it is now — the review can stay open
// while others edit. Returns the rows with `stale` recomputed.
export function restale(rows, { topics, agenda, seen = {} }) {
  const live = new Map((topics || []).map((tp) => [tp.id, tp.updatedAt]));
  const isStale = (id, ts) => seen[id] != null && toMillis(ts) != null && toMillis(ts) > seen[id];
  return rows.map((r) => {
    if (!r.ok) return r;
    if (r.op === "set_open_floor") return { ...r, stale: openFloorStale(seen, sanitizeHtml(agenda?.openFloorHtml || "")) };
    if (r.topicId && live.has(r.topicId)) return { ...r, stale: isStale(r.topicId, live.get(r.topicId)) };
    return r;
  });
}

// The writes for the ticked, valid rows. A ticked row that depends on an
// unticked or invalid one fails here rather than half-applying.
// Returns { creates: [{ name, bodyHtml, sortOrder, organizationId }],
//           updates: [{ id, patch }], deletes: [id], openFloorHtml: string|null,
//           liveBodies: { [topicId | "openFloor"]: html } } — liveBodies are
// the bodies of EXISTING fragments to write into the live editor.
// newIds maps a board tempId (a tag or category the proposal created) to
// its real id.
export function planAgendaWrites(rows, checked, { topics, isMaster, orgs = [], newIds = {} }) {
  const real = (id) => newIds[id] || id;
  const removals = new Map();
  // Master agenda org groups run clients by sortOrder, then Vistamar (internal)
  // last — Sync Meeting's order. Used to slot a topic whose org has no group yet.
  const orgRank = (id) => {
    const o = orgs.find((x) => x.id === id);
    return [o?.type === "internal" ? 1 : 0, o?.sortOrder ?? 999];
  };
  const compareRank = (a, b) => a[0] - b[0] || a[1] - b[1];
  const kept = rows.filter((r) => r.ok && checked.has(r.index));
  const order = (topics || []).map((tp) => ({ id: tp.id, sortOrder: tp.sortOrder ?? 0, organizationId: tp.organizationId || null, placed: false }));
  const indexOf = (id) => order.findIndex((e) => e.id === id);
  const updates = new Map();
  const patch = (id, p) => updates.set(id, { ...(updates.get(id) || {}), ...p });
  const deletes = [];
  const liveBodies = {};
  let openFloorHtml = null;
  const creates = [];

  // Insert after `after` ("start", a topic id, or null = end — the end of the
  // org's group on a master agenda).
  const insertAt = (entry, anchor) => {
    if (anchor && anchor !== START) {
      const i = indexOf(anchor);
      if (i === -1) throw new Error(`Topic ${anchor} is no longer on the agenda`);
      order.splice(i + 1, 0, entry);
      return;
    }
    if (!isMaster) {
      if (anchor === START) order.unshift(entry);
      else order.push(entry);
      return;
    }
    const same = order.flatMap((e, i) => (e.organizationId === entry.organizationId ? [i] : []));
    if (same.length) {
      order.splice(anchor === START ? same[0] : same[same.length - 1] + 1, 0, entry);
      return;
    }
    // The org has no group yet: open one before the first group that sorts after it.
    const rank = orgRank(entry.organizationId);
    const next = order.findIndex((e) => compareRank(orgRank(e.organizationId), rank) > 0);
    order.splice(next === -1 ? order.length : next, 0, entry);
  };

  // The review can stay open while others edit; a topic removed meanwhile
  // fails the whole apply rather than writing around it.
  const live = new Set(order.map((e) => e.id));
  const gone = kept.find((r) => r.topicId && !live.has(r.topicId));
  if (gone) throw new Error(`“${gone.topicName}” was deleted after Claude read the agenda — ask again`);

  for (const r of kept) {
    if (r.op === "set_open_floor") {
      openFloorHtml = r.afterHtml;
      liveBodies[OPEN_FLOOR] = r.afterHtml;
    } else if (r.op === "create_topic") {
      const entry = { id: null, create: { name: r.name, bodyHtml: r.afterHtml, organizationId: r.orgId }, organizationId: r.orgId, placed: true };
      creates.push(entry);
      insertAt(entry, r.afterTopicId);
    } else if (r.op === "delete_topic") {
      order.splice(indexOf(r.topicId), 1);
      deletes.push(r.topicId);
    } else if (r.op === "update_topic") {
      if (r.name) patch(r.topicId, { name: r.name });
      if (r.afterHtml !== undefined) {
        patch(r.topicId, { bodyHtml: r.afterHtml });
        liveBodies[r.topicId] = r.afterHtml;
      }
      for (const [field, { after }] of Object.entries(r.keys || {})) patch(r.topicId, { [field]: after.map(real) });
    } else if (r.op === "remove_task" || r.op === "restore_task") {
      const topic = topics.find((tp) => tp.id === r.topicId);
      const list = removals.get(r.topicId) || new Set(topic.excludedItemIds || []);
      if (r.op === "remove_task") list.add(r.itemId); else list.delete(r.itemId);
      removals.set(r.topicId, list);
      patch(r.topicId, { excludedItemIds: [...list] });
    } else if (r.op === "move_topic") {
      const [entry] = order.splice(indexOf(r.topicId), 1);
      entry.placed = true;
      insertAt(entry, r.afterTopicId);
    }
  }

  // Placed entries (new or moved) take sort orders between their unplaced
  // neighbours, so no other topic is rewritten.
  for (let i = 0; i < order.length; i++) {
    if (!order[i].placed) continue;
    let j = i;
    while (j < order.length && order[j].placed) j++;
    const prev = i > 0 ? order[i - 1].sortOrder : null;
    const next = j < order.length ? order[j].sortOrder : null;
    const k = j - i;
    for (let n = 1; n <= k; n++) {
      let s;
      if (prev != null && next != null) s = prev + ((next - prev) * n) / (k + 1);
      else if (prev != null) s = prev + n;
      else if (next != null) s = next - (k + 1 - n);
      else s = n;
      order[i + n - 1].sortOrder = s;
    }
    i = j - 1;
  }
  for (const e of order) {
    if (!e.placed) continue;
    if (e.create) e.create.sortOrder = e.sortOrder;
    else patch(e.id, { sortOrder: e.sortOrder });
  }

  return {
    creates: creates.map((e) => e.create),
    updates: [...updates].map(([id, p]) => ({ id, patch: p })),
    deletes,
    openFloorHtml,
    liveBodies,
  };
}
