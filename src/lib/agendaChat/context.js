// src/lib/agendaChat/context.js
//
// Agenda → the AGENDA CONTEXT text Agenda Chat sends once per conversation,
// the live agenda view get_agenda returns, and `seen`: the updatedAt (ms) of
// every topic plus the agenda (Open Floor) the model was shown — the staleness
// baseline for the review.
import { sanitizeHtml } from "../agendaHtml.js";
import { visibleAttendees } from "../meetingHelpers.js";
import { memberName, toMillis } from "../boardChat/snapshot.js";
import { tsToDate } from "../../utils/firestoreTime.js";

export const OPEN_FLOOR = "openFloor";

// Topics in agenda order, each with what the model needs to read or edit it.
export function agendaView({ agenda, topics, orgs = [], isMaster }) {
  const orgName = (id) => orgs.find((o) => o.id === id)?.name || id;
  return {
    master: Boolean(isMaster),
    topics: (topics || []).map((tp) => ({
      topicId: tp.id,
      title: tp.name || "",
      ...(isMaster ? { orgId: tp.organizationId || null, org: tp.organizationId ? orgName(tp.organizationId) : null } : {}),
      bodyHtml: sanitizeHtml(tp.bodyHtml || ""),
    })),
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

export function buildAgendaContext({ agenda, topics, orgs = [], orgName, isMaster, user, users = [] }) {
  const me = users.find((u) => u.id === user.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = tsToDate(agenda?.meetingDatetime);
  const view = agendaView({ agenda, topics, orgs, isMaster });
  const attendees = visibleAttendees(agenda?.attendees).map((a) => (a.name ? `${a.name} <${a.email}>` : a.email));
  const topicBlocks = view.topics.map((tp, i) => [
    `--- TOPIC ${i + 1} | id ${tp.topicId}${isMaster ? ` | org ${tp.org || "none"} (${tp.orgId || "-"})` : ""} | ${tp.title || "(untitled)"}`,
    tp.bodyHtml || "(empty)",
  ].join("\n"));
  const text = [
    "AGENDA CONTEXT",
    `User: ${me ? memberName(me) : user.email} (id ${user.uid})`,
    `Now: ${new Date().toString()} (timezone ${tz})`,
    "",
    `Meeting: ${agenda?.title || "(untitled)"}`,
    `Organization: ${isMaster ? "master agenda — topics are grouped by organization" : orgName || "unknown"}`,
    ...(when ? [`Agenda date on file: ${when.toString()}`] : []),
    `Attendees: ${attendees.join(", ") || "none listed"}`,
    `Linked past-meeting titles: ${(agenda?.firefliesTitles || []).join(" ; ") || "none"}`,
    ...(isMaster ? ["", "ORGANIZATIONS (id | name)", ...orgs.map((o) => `${o.id} | ${o.name || o.id}`)] : []),
    "",
    `TOPICS (${view.topics.length}, in order; body HTML follows each header)`,
    ...topicBlocks,
    "",
    "--- OPEN FLOOR",
    view.openFloorHtml || "(empty)",
  ].join("\n");
  return { text, seen: mergeSeen({}, seenOf({ agenda, topics })) };
}
