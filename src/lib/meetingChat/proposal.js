// src/lib/meetingChat/proposal.js
//
// propose_agenda_changes → review rows (validated, with before/after) → the
// Firestore writes for the rows the user kept. Pure; no Firebase imports.
import { sanitizeHtml } from "../agendaHtml.js";
import { toMillis } from "../boardChat/snapshot.js";
import { OPEN_FLOOR } from "./context.js";

const OPS = new Set(["create_topic", "update_topic", "delete_topic", "move_topic", "set_open_floor"]);
const START = "start";

// ctx: { topics (agenda order), agenda, isMaster, orgIds: Set, seen }
export function buildReviewRows(ops, { topics, agenda, isMaster, orgIds, seen = {} }) {
  const byId = new Map((topics || []).map((tp) => [tp.id, tp]));
  const deletedBy = new Map();
  const changedBy = new Map();
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
      return { ...row, beforeHtml: sanitizeHtml(agenda?.openFloorHtml || ""), afterHtml: sanitizeHtml(raw.bodyHtml), stale: stale(OPEN_FLOOR, agenda?.updatedAt) };
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
      if (changedBy.has(topic.id)) return fail(`That topic is changed by change ${changedBy.get(topic.id) + 1}`);
      deletedBy.set(topic.id, index);
      return { ...base, beforeHtml: sanitizeHtml(topic.bodyHtml || "") };
    }
    if (op === "update_topic") {
      const hasName = typeof raw.name === "string" && raw.name.trim() !== "";
      const hasBody = typeof raw.bodyHtml === "string";
      if (!hasName && !hasBody) return fail("update_topic needs a name or bodyHtml");
      if (changedBy.has(topic.id)) return fail(`That topic is already changed by change ${changedBy.get(topic.id) + 1}`);
      changedBy.set(topic.id, index);
      return {
        ...base,
        ...(hasName && raw.name.trim() !== topic.name ? { name: raw.name.trim() } : {}),
        ...(hasBody ? { beforeHtml: sanitizeHtml(topic.bodyHtml || ""), afterHtml: sanitizeHtml(raw.bodyHtml) } : {}),
      };
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

// The writes for the ticked, valid rows. A ticked row that depends on an
// unticked or invalid one fails here rather than half-applying.
// Returns { creates: [{ name, bodyHtml, sortOrder, organizationId }],
//           updates: [{ id, patch }], deletes: [id], openFloorHtml: string|null,
//           liveBodies: { [topicId | "openFloor"]: html } } — liveBodies are
// the bodies of EXISTING fragments to write into the live editor.
export function planAgendaWrites(rows, checked, { topics, isMaster }) {
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
  const insertAt = (entry, after) => {
    if (after === START) {
      const first = isMaster ? order.findIndex((e) => e.organizationId === entry.organizationId) : -1;
      order.splice(first === -1 ? 0 : first, 0, entry);
      return;
    }
    if (after) {
      const i = indexOf(after);
      if (i === -1) throw new Error(`Topic ${after} is no longer on the agenda`);
      order.splice(i + 1, 0, entry);
      return;
    }
    if (isMaster) {
      let last = -1;
      order.forEach((e, i) => { if (e.organizationId === entry.organizationId) last = i; });
      if (last !== -1) { order.splice(last + 1, 0, entry); return; }
    }
    order.push(entry);
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
