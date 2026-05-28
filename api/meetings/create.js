// POST /api/meetings/create
//
// M365-primary flow (supersedes Plan D's Google-primary two-step):
//   1. POST event to meetings@'s M365 calendar via Graph with
//      isOnlineMeeting:true. Graph mints a Teams meeting bound to the event
//      AND fans out .ics to every attendee NATIVELY:
//        - In-tenant attendees (VM users): proper Teams binding → Outlook
//          renders Join/Chat.
//        - External attendees (Gmail / other Outlook tenants): .ics carries
//          X-MICROSOFT-CDO-* headers → Google Calendar renders the prominent
//          Teams meeting card; non-Google clients render a regular Teams
//          invite.
//   2. Mirror the event to meetings@'s Google primary calendar with
//      sendUpdates="none" (Graph already invited everyone) + conferenceData
//      pointing at the Graph-minted joinUrl. The Google mirror serves the
//      Console read path and renders correctly when meetings@'s Google
//      calendar is opened directly.
//
// Response: { agenda_id, eventId, m365EventId, seriesId, teamsUrl, iCalUID }.
// `eventId` is the Google mirror ID (the Console UI's existing contract).
// `m365EventId` is exposed for migration scripts; production callers ignore it.
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { createEvent as graphCreateEvent } from "./_lib/graph-events.js";
import { createEvent as googleCreateEvent, cadenceToRrule } from "./_lib/google-calendar.js";
import { withSilentProxies } from "./_lib/attendee-helpers.js";
import { requireAuth } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

function toLocalIso(date, time) {
  if (!date || !time) return null;
  const t = time.length === 5 ? `${time}:00` : time;
  return `${date}T${t}`;
}

function addOneHour(localIso) {
  const d = new Date(`${localIso}Z`);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 19);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { agenda_id, org_id, title, cadence, date, time, timezone, attendees } = req.body;

    if (!org_id || !title || !timezone) {
      return res.status(400).json({ error: "Missing required fields: org_id, title, timezone" });
    }
    if (!cadence && (!date || !time)) {
      return res.status(400).json({ error: "Single events require date and time fields" });
    }
    if (cadence && (!cadence.startDate || !cadence.time)) {
      return res.status(400).json({ error: "Recurring events require cadence.startDate and cadence.time" });
    }

    const fullAttendees = withSilentProxies(attendees);
    const startLocal = cadence
      ? toLocalIso(cadence.startDate, cadence.time)
      : toLocalIso(date, time);
    const endLocal = addOneHour(startLocal);
    const rrule = cadence ? cadenceToRrule(cadence) : null;
    const startDateForRecurrence = cadence ? cadence.startDate : date;

    // Step 1 — Canonical write: Graph creates event on meetings@'s M365
    // calendar with isOnlineMeeting:true. Graph mints Teams meeting bound to
    // the event row AND fans out .ics to every attendee.
    const graphResult = await graphCreateEvent({
      orgId: org_id,
      title,
      startDateTime: startLocal,
      endDateTime: endLocal,
      timezone,
      attendees: fullAttendees,
      rrule,
      startDate: startDateForRecurrence,
      agendaId: agenda_id,
    });

    if (!graphResult.joinUrl) {
      // Defensive: every meetings@ event should mint a Teams meeting. If Graph
      // returned no joinUrl, the Application Access Policy may have regressed.
      console.error("graph-events.createEvent returned no joinUrl. Event:", graphResult.eventId);
    }

    // Step 2 — Mirror to Google with sendUpdates:"none" and conferenceData so
    // Google Calendar renders the prominent Teams card when the meetings@
    // calendar is viewed directly. Console read path consumes this mirror.
    const googleResult = await googleCreateEvent({
      orgId: org_id,
      title,
      startDateTime: startLocal,
      endDateTime: endLocal,
      timezone,
      attendees: fullAttendees,
      teamsUrl: graphResult.joinUrl,
      teamsDetails: graphResult.teamsDetails,
      rrule,
      agendaId: agenda_id,
      m365EventId: graphResult.eventId,
    });

    return res.status(200).json({
      agenda_id: agenda_id || null,
      eventId: googleResult.eventId,
      m365EventId: graphResult.eventId,
      seriesId: googleResult.seriesId,
      teamsUrl: graphResult.joinUrl,
      iCalUID: googleResult.iCalUID,
    });
  } catch (err) {
    console.error("POST /api/meetings/create error:", err);
    return res.status(500).json({ error: err.message });
  }
}
