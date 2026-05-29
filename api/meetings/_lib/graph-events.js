// api/meetings/_lib/graph-events.js
//
// Microsoft Graph client — full event lifecycle on meetings@'s M365 calendar.
// Replaces graph-calendar.js (which only minted standalone /onlineMeetings)
// AND m365-mirror.js (per-user fanout, no longer needed). Graph delivers .ics
// to every attendee NATIVELY when the event is created on meetings@'s calendar
// with isOnlineMeeting:true — in-tenant attendees get proper Teams binding for
// Outlook Join/Chat, external Gmail attendees get .ics that Google parses into
// the prominent Teams card via X-MICROSOFT-CDO-* headers.
//
// All operations target /users/meetings@/calendar/events. The Console-Meeting-
// Scheduler-Policy Application Access Policy (granted to meetings@'s Object ID)
// is what permits app-only Graph to mint Teams meetings during event creation.
//
// OrgId scoping: singleValueExtendedProperty
//   id: "String {c4e6a6c0-47d0-4f0a-b915-1a1e0a1b2c3d} Name OrgId"
//   value: <orgId>
// Read with $expand to get the value back on list/get.
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { getTeamsCredentials } from "./keyvault.js";

const ORG_ID_PROP = "String {c4e6a6c0-47d0-4f0a-b915-1a1e0a1b2c3d} Name OrgId";
const SOURCE_AGENDA_PROP = "String {c4e6a6c0-47d0-4f0a-b915-1a1e0a1b2c3d} Name SourceAgendaId";

// ── Auth ──

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

async function getHostUserId() {
  const { hostUserId } = await getTeamsCredentials();
  return hostUserId;
}

async function graphFetch(path, options = {}) {
  const token = await getToken();
  const userId = await getHostUserId();
  const url = `https://graph.microsoft.com/v1.0/users/${userId}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ── RRULE ⇄ Graph recurrence ──
//
// Ported from m365-mirror.js. Same restricted subset: weekly (with optional
// INTERVAL + BYDAY) and relativeMonthly (BYDAY ord+day).

const GRAPH_DAY = {
  SU: "sunday", MO: "monday", TU: "tuesday", WE: "wednesday",
  TH: "thursday", FR: "friday", SA: "saturday",
};
const ORDINAL_LABEL = { 1: "first", 2: "second", 3: "third", 4: "fourth", "-1": "last" };

function rruleToGraphRecurrence(rrule, startDate) {
  if (!rrule || !startDate) return undefined;
  const clean = String(rrule).replace(/^RRULE:/, "");
  const parts = Object.fromEntries(
    clean.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v?.trim()];
    })
  );
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const byday = (parts.BYDAY || "").split(",").filter(Boolean);
  if (parts.FREQ === "WEEKLY") {
    const days = byday.map((d) => GRAPH_DAY[d]).filter(Boolean);
    return {
      pattern: { type: "weekly", interval, daysOfWeek: days.length ? days : ["monday"] },
      range: { type: "noEnd", startDate },
    };
  }
  if (parts.FREQ === "MONTHLY") {
    const m = byday[0]?.match(/^(-?\d+)([A-Z]{2})$/);
    const ord = m ? Number(m[1]) : 1;
    const day = m ? GRAPH_DAY[m[2]] : "monday";
    return {
      pattern: {
        type: "relativeMonthly",
        interval,
        index: ORDINAL_LABEL[String(ord)] || "first",
        daysOfWeek: [day],
      },
      range: { type: "noEnd", startDate },
    };
  }
  return undefined;
}

// ── Body / attendees ──

function buildBody(description) {
  // Graph auto-injects the Teams join HTML when isOnlineMeeting:true. We only
  // pass the user-authored description here.
  const content = description ? `<p>${description}</p>` : "";
  return { contentType: "HTML", content };
}

function buildAttendees(attendees = []) {
  return attendees.map((a) => ({
    emailAddress: { address: a.email, name: a.name || a.email },
    type: "required",
  }));
}

// ── CREATE ──

export async function createEvent({
  orgId,
  title,
  startDateTime,    // local-ISO "YYYY-MM-DDTHH:mm:ss"
  endDateTime,      // local-ISO
  timezone,         // IANA, e.g. "America/Los_Angeles"
  attendees = [],
  rrule,            // optional; "FREQ=...;BYDAY=..." (no "RRULE:" prefix needed)
  description,      // optional plain text; wrapped in <p> for HTML body
  agendaId,         // optional; persisted as SourceAgendaId extended prop
  startDate,        // required when rrule is set; "YYYY-MM-DD" of first occurrence
}) {
  const extendedProps = [
    { id: ORG_ID_PROP, value: String(orgId) },
  ];
  if (agendaId !== undefined && agendaId !== null) {
    extendedProps.push({ id: SOURCE_AGENDA_PROP, value: String(agendaId) });
  }

  // Graph creates the event silently — the M365 meetings@ mailbox doesn't
  // have send rights in our tenant, so any Prefer header is a no-op and the
  // .ics fan-out path is dead on this side. Invites are fanned from the
  // Google mirror (google-calendar.js, sendUpdates:"all") instead, which
  // DOES have send rights on its meetings@ Workspace mailbox. Graph still
  // mints the Teams meeting binding here so the Google event can embed the
  // proper Teams joinUrl + conferenceData.
  const body = {
    subject: title,
    body: buildBody(description),
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
    attendees: buildAttendees(attendees),
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    singleValueExtendedProperties: extendedProps,
  };
  const recurrence = rruleToGraphRecurrence(rrule, startDate);
  if (recurrence) body.recurrence = recurrence;

  const res = await graphFetch("/calendar/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`graph-events.createEvent failed: ${res.status} ${text}`);
  }
  const ev = await res.json();

  // Fetch full onlineMeeting details by joinUrl so callers can construct the
  // full Google conferenceData shape (meetingCode + passcode + meetingId for
  // proper Microsoft Teams branded rendering on the Google mirror).
  const teamsDetails = await fetchOnlineMeetingDetails(ev.onlineMeeting?.joinUrl);

  return {
    eventId: ev.id,
    iCalUID: ev.iCalUId || ev.iCalUID || null,
    seriesId: rrule ? ev.id : null,
    joinUrl: ev.onlineMeeting?.joinUrl || null,
    webLink: ev.webLink || null,
    teamsDetails, // { onlineMeetingId, meetingCode, passcode, threadId, organizerId, meetingOptionsUrl } | null
  };
}

// Look up full onlineMeeting metadata by joinWebUrl. Returns null if Graph
// can't find the meeting (rare — only happens if joinUrl arrived missing or
// the user lacks read scope). Best-effort: a null teamsDetails just means
// the Google mirror gets a less-rich conferenceData payload.
async function fetchOnlineMeetingDetails(joinUrl) {
  if (!joinUrl) return null;
  try {
    const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl}'`);
    const path = `/onlineMeetings?$filter=${filter}`;
    const res = await graphFetch(path, { method: "GET" });
    if (!res.ok) {
      console.error(`fetchOnlineMeetingDetails ${res.status} ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const om = data.value?.[0];
    if (!om) return null;
    return {
      onlineMeetingId: om.id,
      meetingCode: om.meetingCode || om.joinMeetingIdSettings?.joinMeetingId || null,
      passcode: om.joinMeetingIdSettings?.passcode || null,
      threadId: om.chatInfo?.threadId || null,
      organizerId: om.participants?.organizer?.identity?.user?.id || null,
      meetingOptionsUrl: om.meetingOptionsWebUrl || null,
    };
  } catch (err) {
    console.error(`fetchOnlineMeetingDetails error: ${err.message}`);
    return null;
  }
}

export { fetchOnlineMeetingDetails };

// ── RESCHEDULE ──

async function findInstanceByDate(eventId, date) {
  const res = await graphFetch(
    `/calendar/events/${eventId}/instances?startDateTime=${date}T00:00:00&endDateTime=${date}T23:59:59&$top=1`,
    { method: "GET" }
  );
  if (!res.ok) throw new Error(`graph-events.findInstanceByDate failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const inst = data.value?.[0];
  if (!inst) throw new Error(`No Graph instance found for ${date}`);
  return inst;
}

export async function rescheduleEvent({
  eventId,
  mode,             // "series" | "instance"
  originalDate,     // required for instance mode
  newStartDateTime, // local-ISO
  newEndDateTime,
  timezone,
}) {
  const requestBody = {
    start: { dateTime: newStartDateTime, timeZone: timezone },
    end: { dateTime: newEndDateTime, timeZone: timezone },
  };
  let targetId = eventId;
  if (mode === "instance") {
    const inst = await findInstanceByDate(eventId, originalDate);
    targetId = inst.id;
  }
  // Reschedules always notify — attendees need to know the time changed.
  // Graph PATCH default is silent, so we set the Prefer header explicitly.
  const res = await graphFetch(`/calendar/events/${targetId}`, {
    method: "PATCH",
    headers: { Prefer: 'outlook.send-notifications="true"' },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    throw new Error(`graph-events.rescheduleEvent failed: ${res.status} ${await res.text()}`);
  }
}

// ── RENAME ──

export async function renameEvent({ eventId, title }) {
  // Always notify on title change — attendees need to know what was renamed
  // before they show up. Same Prefer header pattern as create/reschedule/cancel.
  const res = await graphFetch(`/calendar/events/${eventId}`, {
    method: "PATCH",
    headers: { Prefer: 'outlook.send-notifications="true"' },
    body: JSON.stringify({ subject: title }),
  });
  if (!res.ok) {
    throw new Error(`graph-events.renameEvent failed: ${res.status} ${await res.text()}`);
  }
}

// ── ATTENDEES (add/remove) ──

export async function updateAttendees({ eventId, add = [], remove = [] }) {
  // Graph PATCH replaces the attendees array wholesale, so we read-modify-write.
  const cur = await getRawEvent(eventId);
  let attendees = cur.attendees || [];

  const removeEmails = remove
    .map((e) => (typeof e === "object" && e ? e.email : e))
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  if (removeEmails.length) {
    const rm = new Set(removeEmails);
    attendees = attendees.filter((a) => !rm.has(String(a.emailAddress?.address || "").toLowerCase()));
  }
  for (const a of add) {
    const exists = attendees.some(
      (x) => String(x.emailAddress?.address || "").toLowerCase() === String(a.email).toLowerCase()
    );
    if (!exists) {
      attendees.push({
        emailAddress: { address: a.email, name: a.name || a.email },
        type: "required",
      });
    }
  }

  // Always notify on attendee changes — V2 policy is "emails happen whenever
  // scheduling is done." Console's old "silent for VM-only churn" policy was a
  // mirror-era artifact (Google was canonical, M365 was per-user backfill); in
  // V2 the M365 event on meetings@'s calendar IS canonical, so every change
  // needs to ship as an .ics so attendees can see the update in Outlook /
  // Gmail without having to refresh a calendar tab.
  const res = await graphFetch(`/calendar/events/${eventId}`, {
    method: "PATCH",
    headers: { Prefer: 'outlook.send-notifications="true"' },
    body: JSON.stringify({ attendees }),
  });
  if (!res.ok) {
    throw new Error(`graph-events.updateAttendees failed: ${res.status} ${await res.text()}`);
  }
}

// ── CANCEL ──

export async function cancelEvent({ eventId, mode, date }) {
  if (mode === "instance") {
    const inst = await findInstanceByDate(eventId, date);
    // Graph supports cancelling a single instance via /cancel action — sends
    // proper cancellation .ics to attendees for that occurrence only.
    const res = await graphFetch(`/calendar/events/${inst.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ Comment: "" }),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`graph-events.cancelEvent (instance) failed: ${res.status} ${await res.text()}`);
    }
    return;
  }
  // Series / one-time mode: use the /cancel action. Graph's DELETE
  // /calendar/events/{id} is SILENT by default in app-only context — it
  // removes the event from meetings@'s calendar and the attendees' mirrors
  // but does NOT send a cancellation .ics. POST /cancel is the canonical
  // cancel action that fans the cancellation invite to every attendee from
  // Outlook. Same root cause as the createEvent Prefer-header fix.
  // Confirmed on 2026-05-28: one-time meeting cancel removed both
  // calendars but delivered no email.
  const res = await graphFetch(`/calendar/events/${eventId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ Comment: "" }),
  });
  if (!res.ok && res.status !== 202 && res.status !== 404) {
    throw new Error(`graph-events.cancelEvent (series) failed: ${res.status} ${await res.text()}`);
  }
}

// ── GET ──

async function getRawEvent(eventId) {
  const res = await graphFetch(
    `/calendar/events/${eventId}?$expand=singleValueExtendedProperties($filter=id eq '${ORG_ID_PROP}' or id eq '${SOURCE_AGENDA_PROP}')`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(`graph-events.getRawEvent failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getEventDetails(eventId) {
  const e = await getRawEvent(eventId);
  return {
    title: e.subject,
    startLocal: e.start?.dateTime?.replace(/\.\d{7}$|\.\d+$|Z$/, "") || null,
    endLocal: e.end?.dateTime?.replace(/\.\d{7}$|\.\d+$|Z$/, "") || null,
    timezone: e.start?.timeZone || "America/Los_Angeles",
    teamsUrl: e.onlineMeeting?.joinUrl || null,
    iCalUID: e.iCalUId || e.iCalUID || null,
    rrule: null, // recurrence translated separately if needed
    startDate: e.start?.dateTime?.slice(0, 10) || null,
    isOnlineMeeting: !!e.isOnlineMeeting,
    webLink: e.webLink || null,
  };
}

// ── LIST + RSVP merge support ──
//
// Used by list.js to enrich Google-mirror reads with fresh attendee response
// statuses. Filters to events scoped to <orgId> via the extended property.
// Returns a map keyed by the Graph eventId so callers can join by m365EventId
// stored on the Google mirror.

export async function listEventResponses({ orgId, start, end }) {
  // VMManagement uses slug-based orgIds (Console used numeric). When orgId is
  // null/undefined, skip the orgId filter and return all events in window.
  const filter = (orgId != null && orgId !== "")
    ? encodeURIComponent(
        `singleValueExtendedProperties/Any(ep: ep/id eq '${ORG_ID_PROP}' and ep/value eq '${String(orgId)}')`
      )
    : null;
  const startEnc = encodeURIComponent(start);
  const endEnc = encodeURIComponent(end);
  const filterParam = filter ? `&$filter=${filter}` : "";
  const path = `/calendarView?startDateTime=${startEnc}&endDateTime=${endEnc}${filterParam}&$top=250&$select=id,iCalUId,seriesMasterId,attendees`;
  const res = await graphFetch(path, { method: "GET" });
  if (!res.ok) {
    throw new Error(`graph-events.listEventResponses failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const out = {};
  for (const ev of data.value || []) {
    const rsvps = (ev.attendees || []).map((a) => ({
      email: a.emailAddress?.address,
      status: a.status?.response || "none",
    }));
    if (ev.id) out[ev.id] = rsvps;
    if (ev.iCalUId) out[ev.iCalUId] = rsvps; // also key by iCalUID for Google-side join
    if (ev.seriesMasterId) {
      // For occurrences, also key by seriesMasterId so a single Google series row
      // can pick up RSVPs from any visible occurrence.
      if (!out[ev.seriesMasterId]) out[ev.seriesMasterId] = rsvps;
    }
  }
  return out;
}

// ── Legacy mirror cleanup ──
//
// Used once during ID Care - Biweekly migration to remove m365-mirror.js
// orphan events on each VM user's calendar. After this PR ships, no new
// per-user mirror events are created and these helpers can be deleted
// alongside the migration script.

export async function deleteUserMirrorEvent({ userEmail, eventId }) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/calendar/events/${eventId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok || res.status === 404) return;
  throw new Error(`deleteUserMirrorEvent ${userEmail}/${eventId}: ${res.status} ${await res.text()}`);
}

// Search a VM user's calendar for events matching a subject. Used by the ID
// Care migration to find orphan mirror events whose IDs were never persisted
// in the legacy m365Events map. Returns the event IDs of seriesMaster /
// singleInstance matches (skips occurrences — those go away when the master
// is deleted).
export async function findUserMirrorEventsByTitle({ userEmail, title }) {
  const token = await getToken();
  // $filter on subject is supported on calendar/events in v1.0. Cap at 50
  // results — realistic VM mailboxes have far fewer matching titles.
  const filter = encodeURIComponent(`subject eq '${title.replace(/'/g, "''")}'`);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/calendar/events?$filter=${filter}&$top=50&$select=id,subject,type`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`findUserMirrorEventsByTitle ${userEmail}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.value || [])
    .filter((e) => e.type === "seriesMaster" || e.type === "singleInstance")
    .map((e) => e.id);
}

// Map internal Graph response codes to Google Calendar's responseStatus
// vocabulary so list.js can blend without callers caring about the wire
// difference. Graph: none|organizer|tentativelyAccepted|accepted|declined|notResponded
// Google: needsAction|accepted|declined|tentative
export function graphResponseToGoogle(graphResponse) {
  switch (graphResponse) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "notResponded":
    case "none":
    default:
      return "needsAction";
  }
}
