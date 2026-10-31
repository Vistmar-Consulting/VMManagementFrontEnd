// src/lib/agendaChat/context.js
//
// Agenda → the AGENDA CONTEXT text Agenda Chat sends once per conversation,
// the live agenda view get_agenda returns, and `seen`: the updatedAt (ms) of
// every topic plus the agenda (Open Floor) the model was shown — the staleness
// baseline for the review. With the board (items, categories, tags), each
// topic also lists its categories, tags and the Task Board items its card
// shows, and a BOARD section follows (Board Chat's snapshot, limited to the
// agenda's organization unless it is the master agenda); `boardSeen` is the
// items' baseline.
import { sanitizeHtml } from "../agendaHtml.js";
import { visibleAttendees } from "../meetingHelpers.js";
import { buildBoardSnapshot, itemRef, memberName, toMillis } from "../boardChat/snapshot.js";
import { memberIdFromEmail } from "../orgMembers.js";
import { removedFromTopic, topicTree } from "../topicItems.js";
import { tsToDate } from "../../utils/firestoreTime.js";

export const OPEN_FLOOR = "openFloor";

const named = (ids, list) => (ids || []).map((id) => `${list.find((x) => x.id === id)?.name || id} (${id})`);

// Topics in agenda order, each with what the model needs to read or edit it.
// board: { items, categories, tags, organizationId } adds each topic's
// categories, tags and the items on its card.
export function agendaView({ agenda, topics, orgs = [], isMaster, board = null }) {
  const orgName = (id) => orgs.find((o) => o.id === id)?.name || id;
  const refs = (list) => list.map((it) => `${itemRef(it, board.items)} ${it.title || "(untitled)"} [${it.id}]`);
  return {
    master: Boolean(isMaster),
    topics: (topics || []).map((tp) => {
      const tree = board ? topicTree(tp, board.items, board.organizationId) : null;
      return {
        topicId: tp.id,
        title: tp.name || "",
        ...(isMaster ? { orgId: tp.organizationId || null, org: tp.organizationId ? orgName(tp.organizationId) : null } : {}),
        bodyHtml: sanitizeHtml(tp.bodyHtml || ""),
        ...(board ? {
          categories: named(tp.categoryIds, board.categories),
          tags: named(tp.tagIds, board.tags),
          tasksOnCard: refs(tree.parents),
          removedFromCard: refs(removedFromTopic(tp, board.items, board.organizationId)),
        } : {}),
      };
    }),
    openFloorHtml: sanitizeHtml(agenda?.openFloorHtml || ""),
  };
}

// Topics are compared by updatedAt (null = a write still waiting on its server
// timestamp). The Open Floor is compared by content: its timestamp is the
// agenda doc's, which a title rename also bumps.
export function seenOf({ agenda, topics }) {
  return {
    ...Object.fromEntries((topics || []).map((tp) => [tp.id, toMillis(tp.updatedAt)])),
    [OPEN_FLOOR]: sanitizeHtml(agenda?.openFloorHtml || ""),
  };
}

// Merge a fresh read into the baseline, keeping known values over pending nulls.
export function mergeSeen(seen, fresh) {
  const out = { ...seen };
  for (const [id, v] of Object.entries(fresh)) if (v != null) out[id] = v;
  return out;
}

// The board items Agenda Chat sees: the agenda's organization's, or every
// organization's on the master agenda.
export const boardItemsFor = (items, { isMaster, organizationId }) => (isMaster ? items : items.filter((it) => it.organizationId === organizationId));

// users: the people directory list (lib/people.js), so attendees and members
// carry their role. board: { items, categories, tags, organizationId } or null.
export function buildAgendaContext({ agenda, topics, orgs = [], orgName, isMaster, user, users = [], board = null }) {
  const me = users.find((u) => u.id === user.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = tsToDate(agenda?.meetingDatetime);
  const view = agendaView({ agenda, topics, orgs, isMaster, board });
  const roleOf = (email) => users.find((u) => u.email && u.email === memberIdFromEmail(email))?.memberRole;
  const attendees = visibleAttendees(agenda?.attendees).map((a) => {
    const role = roleOf(a.email);
    return `${a.name ? `${a.name} <${a.email}>` : a.email}${role ? ` (${role})` : ""}`;
  });
  const topicBlocks = view.topics.map((tp, i) => [
    `--- TOPIC ${i + 1} | id ${tp.topicId}${isMaster ? ` | org ${tp.org || "none"} (${tp.orgId || "-"})` : ""} | ${tp.title || "(untitled)"}`,
    ...(board ? [
      `Categories: ${tp.categories.join(", ") || "none"} | Tags: ${tp.tags.join(", ") || "none"}`,
      `Tasks on this card (with their subtasks): ${tp.tasksOnCard.join("; ") || "none"}`,
      ...(tp.removedFromCard.length ? [`Removed from this card by hand: ${tp.removedFromCard.join("; ")}`] : []),
    ] : []),
    tp.bodyHtml || "(empty)",
  ].join("\n"));
  const snap = board ? buildBoardSnapshot({ items: boardItemsFor(board.items, { isMaster, organizationId: board.organizationId }), users, orgs, categories: board.categories, tags: board.tags }) : null;
  const text = [
    "AGENDA CONTEXT",
    `User: ${me ? memberName(me) : user.email} (id ${user.uid})`,
    `Now: ${new Date().toString()} (timezone ${tz})`,
    "",
    `Meeting: ${agenda?.title || "(untitled)"}`,
    `Organization: ${isMaster ? "master agenda — topics are grouped by organization" : `${orgName || "unknown"}${board?.organizationId ? ` (${board.organizationId})` : ""}`}`,
    ...(when ? [`Agenda date on file: ${when.toString()}`] : []),
    `Attendees: ${attendees.join(", ") || "none listed"}`,
    `Linked past-meeting titles: ${(agenda?.firefliesTitles || []).join(" ; ") || "none"}`,
    ...(isMaster && !board ? ["", "ORGANIZATIONS (id | name)", ...orgs.map((o) => `${o.id} | ${o.name || o.id}`)] : []),
    "",
    `TOPICS (${view.topics.length}, in order; body HTML follows each header)`,
    ...topicBlocks,
    "",
    "--- OPEN FLOOR",
    view.openFloorHtml || "(empty)",
    ...(snap ? ["", "TASK BOARD", snap.text] : []),
  ].join("\n");
  return { text, seen: mergeSeen({}, seenOf({ agenda, topics })), boardSeen: snap ? snap.seen : {} };
}
