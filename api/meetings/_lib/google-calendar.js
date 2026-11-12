// api/meetings/_lib/google-calendar.js
//
// Google Calendar client for the Meetings API. WRITE-MIRROR ROLE for
// reads/event-state, INVITE-FANNER for emails. Microsoft Graph
// (graph-events.js) is the canonical event/Teams binding write path; this
// module mirrors every Graph mutation onto meetings@'s Google primary
// calendar AND fans .ics invites from the Google side via sendUpdates="all".
//
// Why Google fans instead of Graph: the M365 meetings@ mailbox does not have
// send rights in our tenant, so Graph's notification headers are no-ops —
// events create silently and zero .ics ever leaves Outlook. The Google
// meetings@ Workspace mailbox HAS send rights, so flipping the fan-out to
// the Google side is the only working path. Confirmed 2026-05-28: zero
// meetings@ invite delivery since April 29 across all Graph paths.
//
// OrgId scoping uses extendedProperties.private.orgId.
// Cross-stack binding to Graph events uses extendedProperties.private.m365EventId.
// List filter: privateExtendedProperty=["orgId=<n>"].
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md
// (Supersedes 2026-04-24-google-calendar-meeting-scheduler-design.md.)

import { google } from "googleapis";
import { getGoogleCredentials } from "./keyvault.js";
import { dedupeEventsAcrossSubjects } from "./dedupe-events.js";
import { instantOf, localDateIn, onDate, sameInstant, wallClockToInstant, windowAround } from "./instance-time.js";

const CALENDAR_ID = "primary"; // primary calendar of whichever subject is impersonated
const IMPERSONATE = "meetings@vistamarconsulting.com";
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// DWD impersonation cache. Most write operations always target meetings@;
// read aggregation (list events across multiple Workspace users) needs to
// switch subject. Each subject gets its own cached calendar client because
// the JWT subject is baked into the token.
const cachedClientBySubject = new Map();

async function getCalendar(subject = IMPERSONATE) {
  const existing = cachedClientBySubject.get(subject);
  if (existing) return existing;
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
    subject,
  });
  await auth.authorize();
  const client = google.calendar({ version: "v3", auth });
  cachedClientBySubject.set(subject, client);
  return client;
}

function buildDescription(teamsUrl, body) {
  // Description preamble is a belt-and-suspenders fallback so the join URL
  // is visible even if the conferenceData card fails to render for any
  // reason. The canonical "Join Microsoft Teams Meeting" prominent card is
  // produced by buildConferenceData below.
  const preamble = teamsUrl ? `Join Microsoft Teams Meeting: ${teamsUrl}\n\n` : "";
  return preamble + (body || "");
}

function appendAddOnQuerystring(teamsUrl) {
  // Mimics what the Microsoft Teams Workspace add-on appends when it writes
  // entryPoints.uri via Google Calendar's UI. Google appears to use these
  // querystring tokens to bind the entry to the registered add-on so the
  // proper Teams icon + label render (instead of the generic addOn fallback
  // with "Join Undefined parameter - NAME"). correlationId is for analytics —
  // any UUID works.
  if (!teamsUrl || teamsUrl.includes("launchAgent=GSuiteAddOn")) return teamsUrl;
  const correlationId = randomUuid();
  const sep = teamsUrl.includes("?") ? "&" : "?";
  return `${teamsUrl}${sep}launchAgent=GSuiteAddOn&correlationId=${correlationId}`;
}

function randomUuid() {
  // RFC 4122 v4 UUID. Node 19+ has crypto.randomUUID; we avoid the import
  // for the sake of this single-call helper.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildConferenceData(teamsUrl, teamsDetails) {
  // Google Calendar's prominent Microsoft Teams card requires conferenceData
  // with type "addOn" — which itself requires the Microsoft Teams meetings
  // Workspace add-on installed in vistamarconsulting.com (verified 2026-04-28).
  //
  // The full canonical shape was reverse-engineered from a Microsoft-add-on-
  // created reference event (dev/probe-read-addon-event.mjs):
  //   - URI carries `launchAgent=GSuiteAddOn&correlationId=<uuid>` so Google
  //     can match the entry to the registered add-on (without these,
  //     Google renders the label as "Join Undefined parameter - NAME").
  //   - entryPoints[0].meetingCode + passcode → "ID: ... / Passcode: ..." display
  //   - conferenceId → matches meetingCode
  //   - parameters.addOnParameters.parameters.meetingId → binds to the registered
  //     add-on so Google renders the proper Microsoft Teams icon + label
  //   - notes (HTML) → "For organizers: Meeting Options" link
  //
  // teamsDetails is best-effort from graph-events.fetchOnlineMeetingDetails;
  // null/missing fields degrade to a plainer (but still type=addOn) rendering.
  if (!teamsUrl) return undefined;

  const uriWithAgent = appendAddOnQuerystring(teamsUrl);

  const entryPoint = {
    entryPointType: "video",
    uri: uriWithAgent,
    label: "Join Microsoft Teams Meeting",
  };
  if (teamsDetails?.meetingCode) entryPoint.meetingCode = teamsDetails.meetingCode;
  if (teamsDetails?.passcode) entryPoint.passcode = teamsDetails.passcode;

  const cd = {
    conferenceSolution: {
      key: { type: "addOn" },
      // Microsoft Teams Workspace add-on must be installed in the calling
      // Workspace AND the calendar owner (meetings@) must have completed
      // the Microsoft OAuth handshake via the add-on UI once. With both
      // satisfied, Google accepts these "read-only" fields on insert and
      // renders the canonical Teams card. Without them, rendering falls
      // back to "Join Undefined parameter - NAME". Verified live 2026-04-28.
      name: "Microsoft Teams Meeting",
      iconUri: "https://lh3.googleusercontent.com/8w10SpfgiAzZhxEatSEmJWTPpbjYs-I8pM0Mu45qkuvd3Z0hwj8",
    },
    entryPoints: [entryPoint],
  };
  if (teamsDetails?.meetingCode) cd.conferenceId = teamsDetails.meetingCode;

  if (teamsDetails?.onlineMeetingId || teamsDetails?.meetingOptionsUrl) {
    const params = {};
    if (teamsDetails.onlineMeetingId) params.meetingId = teamsDetails.onlineMeetingId;
    if (teamsDetails.meetingOptionsUrl) {
      params.forOrganizersHeaderText = "For organizers";
      params.meetingOptionsLink = `<a rel='noopener noreferrer' target='_blank' href='${teamsDetails.meetingOptionsUrl}'>Meeting Options</a>`;
    }
    cd.parameters = { addOnParameters: { parameters: params } };
  }

  if (teamsDetails?.meetingOptionsUrl) {
    cd.notes = `<b>For organizers</b><br /><a rel="noopener noreferrer" href="${teamsDetails.meetingOptionsUrl}" target="_blank">Meeting Options</a><br />`;
  }

  return cd;
}

function wrapRrule(rrule) {
  if (!rrule) return undefined;
  const trimmed = String(rrule).trim();
  return [trimmed.startsWith("RRULE:") ? trimmed : `RRULE:${trimmed}`];
}

export async function createEvent({
  orgId,
  title,
  startDateTime,
  endDateTime,
  timezone,
  attendees = [],
  teamsUrl,
  teamsDetails, // optional rich onlineMeeting metadata from graph-events.createEvent
  rrule,
  description,
  agendaId,
  m365EventId,
}) {
  const cal = await getCalendar();
  const priv = { orgId: String(orgId) };
  if (teamsUrl) priv.teamsUrl = teamsUrl;
  if (agendaId !== undefined && agendaId !== null) priv.sourceAgendaId = String(agendaId);
  if (m365EventId) priv.m365EventId = m365EventId;

  const requestBody = {
    summary: title,
    description: buildDescription(teamsUrl, description),
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
    attendees: attendees.map((a) => ({
      email: a.email,
      displayName: a.name,
      responseStatus: "needsAction",
    })),
    extendedProperties: { private: priv },
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: true },
  };
  const conferenceData = buildConferenceData(teamsUrl, teamsDetails);
  if (conferenceData) requestBody.conferenceData = conferenceData;
  const recurrence = wrapRrule(rrule);
  if (recurrence) requestBody.recurrence = recurrence;

  const res = await cal.events.insert({
    calendarId: CALENDAR_ID,
    sendUpdates: "all",
    conferenceDataVersion: conferenceData ? 1 : 0,
    requestBody,
  });
  return {
    eventId: res.data.id,
    seriesId: recurrence ? res.data.id : null,
    teamsUrl: teamsUrl || null,
    iCalUID: res.data.iCalUID || null,
  };
}

// Read events from a single subject's primary calendar. `subject` defaults to
// meetings@; pass another Workspace user's address (e.g. trobinson@,
// ctucksherman@) to read THEIR primary calendar via DWD impersonation. The
// `organizer_email` field is stamped onto each returned event so the FE /
// reconciliation worker can tell which user's calendar it came from.
export async function listEvents({ orgId, start, end, subject = IMPERSONATE }) {
  const cal = await getCalendar(subject);
  const listParams = {
    calendarId: CALENDAR_ID,
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  };
  // VMManagement uses slug-based orgIds; Console used numeric. When orgId is
  // null/undefined we skip the filter and return all events in window, letting
  // the FE filter client-side. Existing Console events still have numeric
  // string orgIds in extendedProperties; new Management events will have slugs.
  if (orgId != null && orgId !== "") {
    listParams.privateExtendedProperty = [`orgId=${orgId}`];
  }
  const res = await cal.events.list(listParams);
  return (res.data.items || []).map((e) => ({
    event_id: e.id,
    series_id: e.recurringEventId || null,
    iCalUID: e.iCalUID || null,
    m365EventId: e.extendedProperties?.private?.m365EventId || null,
    org_id: e.extendedProperties?.private?.orgId || null,
    title: e.summary,
    date: e.start?.dateTime || e.start?.date,
    end_date: e.end?.dateTime || e.end?.date,
    type: e.recurringEventId ? "recurring" : "single",
    teams_url: e.extendedProperties?.private?.teamsUrl || e.location || null,
    organizer_email: e.organizer?.email || null,
    source_calendar: subject,
    attendees: (e.attendees || []).map((a) => ({
      email: a.email,
      name: a.displayName || a.email,
      status: a.responseStatus || "needsAction",
    })),
  }));
}

// Aggregate `listEvents` across multiple Workspace users' calendars and dedupe
// by iCalUID. The same meeting is typically on every attendee's calendar; the
// canonical copy is whichever calendar the organizer's address matches —
// otherwise we keep the first one seen (lookup-order preference).
//
// Subjects: array of Workspace user emails to impersonate. Order matters for
// dedupe tie-breaking — list `meetings@` first so its copies are the
// canonical ones for meetings@-organized events.
export async function listEventsAcrossSubjects({ subjects, orgId, start, end }) {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    return listEvents({ orgId, start, end });
  }
  const results = await Promise.allSettled(
    subjects.map((subject) => listEvents({ orgId, start, end, subject }))
  );
  const perSubjectResults = results.map((r, i) => {
    if (r.status !== "fulfilled") {
      console.error(`google-calendar.listEventsAcrossSubjects: subject ${subjects[i]} failed`, r.reason?.message || r.reason);
      return [];
    }
    return r.value;
  });
  // Dedup logic extracted to dedupe-events.js (unit-tested). Keys on
  // iCalUID+instance-start so recurring instances aren't collapsed into one.
  return dedupeEventsAcrossSubjects(perSubjectResults, subjects);
}

// Every occurrence of series `eventId` at `startIso`: live ones that start
// there, plus cancelled ones that started there (Google only guarantees
// originalStartTime on a cancelled occurrence, so those match on either).
// Two can share a start when one was moved onto another's slot.
//
// Google may return an empty page with a nextPageToken (documented: a page can
// hold fewer items than maxResults, "or none at all"). This happens once an
// instance has been moved (an exception), so read every page.
async function findInstancesAt(cal, eventId, startIso) {
  const { from, to } = windowAround(startIso);
  const target = Date.parse(startIso);
  const found = [];
  let pageToken;
  do {
    const res = await cal.events.instances({
      calendarId: CALENDAR_ID,
      eventId,
      timeMin: from,
      timeMax: to,
      showDeleted: true,
      pageToken,
    });
    for (const i of res.data.items || []) {
      const atStart = sameInstant(startOf(i), target);
      const atOriginal = !isLive(i) && sameInstant(originalOf(i), target);
      if (atStart || atOriginal) found.push(i);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return found;
}

const isLive = (inst) => !!inst && inst.status !== "cancelled";
const startOf = (i) => instantOf(i.start?.dateTime, i.start?.timeZone);
const endOf = (i) => instantOf(i.end?.dateTime, i.end?.timeZone);
const originalOf = (i) => instantOf(i.originalStartTime?.dateTime, i.originalStartTime?.timeZone);
const wasMoved = (i) => Number.isFinite(originalOf(i)) && !sameInstant(originalOf(i), startOf(i));
const seriesSlot = (i) => {
  const t = originalOf(i);
  if (!Number.isFinite(t)) throw new Error(`Google occurrence ${i.id} has no originalStartTime`);
  return new Date(t).toISOString();
};

// Of several live occurrences at one start, the one that was scheduled there
// (not moved onto it) — that is the one the user sees as "the 2pm meeting".
const pickLive = (items) => {
  const live = items.filter(isLive);
  return live.find((i) => !wasMoved(i)) || live[0] || null;
};

// Returns { alreadyApplied?, seriesSlot? }. alreadyApplied: a previous attempt
// already made this change, so a retry after a partial failure is safe and
// sends no second email. seriesSlot (instance mode): the occurrence's original
// scheduled start — fixed however often it moves — which the Graph step uses
// to find the same occurrence in Outlook.
//
// Series mode on a recurring event changes the time of day only: the series
// keeps its first date (so its weekday and past occurrences). On a one-time
// event it moves the event to the new date and time.
export async function rescheduleEvent({
  eventId,
  mode,
  originalStart,    // ISO instant of the occurrence's current start (instance mode)
  newStartDateTime,
  newEndDateTime,
  timezone,
}) {
  const cal = await getCalendar();
  const body = (start, end) => ({
    start: { dateTime: start, timeZone: timezone },
    end: { dateTime: end, timeZone: timezone },
  });
  if (mode === "instance") {
    const newStart = Date.parse(wallClockToInstant(newStartDateTime, timezone));
    const newEnd = Date.parse(wallClockToInstant(newEndDateTime, timezone));
    const inst = pickLive(await findInstancesAt(cal, eventId, originalStart));
    if (!inst) {
      // An earlier attempt may have moved it already: look for an occurrence
      // moved onto the new start (prefer one whose slot is originalStart).
      const moved = (await findInstancesAt(cal, eventId, new Date(newStart).toISOString()))
        .filter((i) => isLive(i) && wasMoved(i));
      const mine = moved.find((i) => sameInstant(originalOf(i), Date.parse(originalStart))) || moved[0];
      if (mine) return { alreadyApplied: true, seriesSlot: seriesSlot(mine) };
      throw new Error(`Google Calendar has no live occurrence of this meeting starting at ${originalStart}`);
    }
    if (sameInstant(startOf(inst), newStart) && sameInstant(endOf(inst), newEnd)) {
      return { alreadyApplied: true, seriesSlot: seriesSlot(inst) };
    }
    await cal.events.patch({
      calendarId: CALENDAR_ID,
      eventId: inst.id,
      sendUpdates: "all",
      requestBody: body(newStartDateTime, newEndDateTime),
    });
    return { seriesSlot: seriesSlot(inst) };
  }
  const master = (await cal.events.get({ calendarId: CALENDAR_ID, eventId })).data;
  let start = newStartDateTime;
  let end = newEndDateTime;
  if (master.recurrence?.length) {
    const firstDate = localDateIn(instantOf(master.start?.dateTime, master.start?.timeZone), timezone);
    ({ start, end } = onDate(firstDate, newStartDateTime, newEndDateTime));
  }
  const unchanged =
    sameInstant(instantOf(master.start?.dateTime, master.start?.timeZone), Date.parse(wallClockToInstant(start, timezone)))
    && sameInstant(instantOf(master.end?.dateTime, master.end?.timeZone), Date.parse(wallClockToInstant(end, timezone)));
  if (unchanged) return { alreadyApplied: true };
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    sendUpdates: "all",
    requestBody: body(start, end),
  });
}

export async function updateAttendees({ eventId, add = [], remove = [] }) {
  const cal = await getCalendar();
  const cur = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  let attendees = cur.data.attendees || [];
  if (remove.length) {
    // Accept either email strings or { email, name } objects so handlers and
    // the FE can pass whichever shape they have without mapping at call sites.
    const rm = new Set(
      remove
        .map((e) => (typeof e === "object" && e ? e.email : e))
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
    );
    attendees = attendees.filter((a) => !rm.has(String(a.email).toLowerCase()));
  }
  for (const a of add) {
    const exists = attendees.some(
      (x) => String(x.email).toLowerCase() === String(a.email).toLowerCase()
    );
    if (!exists) {
      attendees.push({
        email: a.email,
        displayName: a.name,
        responseStatus: "needsAction",
      });
    }
  }
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    sendUpdates: "all",
    requestBody: { attendees },
  });
}

// Returns { alreadyApplied?, seriesSlot? } as rescheduleEvent does: a retry
// after a partial failure is safe.
export async function cancelEvent({ eventId, mode, originalStart, sendUpdates = "all" }) {
  // Default sendUpdates="all" — Google is now the invite-fan source since
  // the M365 meetings@ mailbox can't send. Callers can pass "none" to
  // explicitly suppress (e.g. backfill scripts that don't want to spam).
  const cal = await getCalendar();
  if (mode === "instance") {
    const items = await findInstancesAt(cal, eventId, originalStart);
    // A live occurrence wins over a cancelled one at the same start, so an old
    // cancellation can't mask the meeting the user is cancelling now.
    const inst = pickLive(items);
    if (inst) {
      await cal.events.patch({
        calendarId: CALENDAR_ID,
        eventId: inst.id,
        sendUpdates,
        requestBody: { status: "cancelled" },
      });
      return { seriesSlot: seriesSlot(inst) };
    }
    const cancelled = items.find((i) => !isLive(i));
    if (cancelled) return { alreadyApplied: true, seriesSlot: seriesSlot(cancelled) };
    throw new Error(`Google Calendar has no occurrence of this meeting starting at ${originalStart}`);
  }
  try {
    await cal.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
      sendUpdates,
    });
  } catch (err) {
    // 410 Gone: already deleted (an earlier attempt, or someone in Google).
    if (err?.code === 410 || err?.response?.status === 410) return { alreadyApplied: true };
    throw err;
  }
}

export async function getEventDetails(eventId) {
  const cal = await getCalendar();
  const res = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const e = res.data;
  const teamsUrl = e.extendedProperties?.private?.teamsUrl || null;
  const rrule = (e.recurrence && e.recurrence[0]) || null;
  // start.dateTime is local-ISO + timezone label; we keep them split.
  return {
    title: e.summary,
    startLocal: e.start?.dateTime?.replace(/[+-]\d{2}:?\d{2}$|Z$/, "") || null,
    endLocal: e.end?.dateTime?.replace(/[+-]\d{2}:?\d{2}$|Z$/, "") || null,
    timezone: e.start?.timeZone || "America/Los_Angeles",
    teamsUrl,
    rrule: rrule ? rrule.replace(/^RRULE:/, "") : null,
    startDate: e.start?.dateTime?.slice(0, 10) || null,
  };
}

export async function renameEvent({ eventId, title }) {
  const cal = await getCalendar();
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    sendUpdates: "all",
    requestBody: { summary: title },
  });
}

// Read the m365EventId binding stored on a Google event by createEvent.
// Mutation handlers use this to find the canonical Graph row to patch first.
export async function getM365EventId(eventId) {
  const cal = await getCalendar();
  const res = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  return res.data?.extendedProperties?.private?.m365EventId || null;
}

// Read the legacy Plan D per-user mirror map (extendedProperties.private.m365Events)
// from a Google event. Used ONLY by the one-time ID Care - Biweekly migration
// script to clean up orphan VM-user mirror events. After migration, no Google
// events carry this property; the architecture stores a single m365EventId
// (singular) in extendedProperties.private.m365EventId instead. Delete this
// helper after the migration ships.
export async function getLegacyM365EventsMap(eventId) {
  const cal = await getCalendar();
  const res = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const raw = res.data?.extendedProperties?.private?.m365Events;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ── RRULE helpers ──
//
// Ported verbatim from _lib/ics.js (which Plan D deletes). Google Calendar
// consumes RRULE strings directly in the `recurrence` array — same shape
// Graph's .ics builder needed, so the mapping is reusable.

const WEEKDAY = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

export function graphRecurrenceToRrule(pattern) {
  if (!pattern) return null;
  const days = (pattern.daysOfWeek || [])
    .map((d) => WEEKDAY[d.toLowerCase()])
    .filter(Boolean)
    .join(",");
  if (pattern.type === "weekly") {
    const interval =
      pattern.interval && pattern.interval > 1 ? `;INTERVAL=${pattern.interval}` : "";
    return `FREQ=WEEKLY${interval}${days ? `;BYDAY=${days}` : ""}`;
  }
  if (pattern.type === "relativeMonthly") {
    const interval =
      pattern.interval && pattern.interval > 1 ? `;INTERVAL=${pattern.interval}` : "";
    const ord = ORDINAL[pattern.index || "first"];
    const byday = days
      .split(",")
      .filter(Boolean)
      .map((d) => `${ord}${d}`)
      .join(",");
    return `FREQ=MONTHLY${interval}${byday ? `;BYDAY=${byday}` : ""}`;
  }
  return null;
}

// Mirror of graph-calendar.js :: buildRecurrence cadence → pattern translation,
// then pattern → RRULE. Called by create.js when cadence is supplied.
export function cadenceToRrule(cadence) {
  if (!cadence) return null;
  const day = cadence.day && cadence.day.toLowerCase();
  if (!day) return null;
  const pattern = { type: "weekly", daysOfWeek: [day], interval: 1 };
  if (cadence.frequency === "biweekly") pattern.interval = 2;
  if (cadence.frequency === "monthly") {
    pattern.type = "relativeMonthly";
    pattern.index = cadence.ordinal || "first";
    pattern.interval = 1;
  }
  if (cadence.frequency === "quarterly") {
    pattern.type = "relativeMonthly";
    pattern.index = cadence.ordinal || "first";
    pattern.interval = 3;
  }
  return graphRecurrenceToRrule(pattern);
}
