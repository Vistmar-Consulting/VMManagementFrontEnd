// src/lib/meetingsApi.js
//
// Thin fetch wrapper for /api/meetings/* Vercel serverless functions.
// Same-origin in deployed environments; for local dev a vite proxy points
// /api/* at the deployed preview (see vite.config.js).
//
// Auth: passes the Firebase ID token in the X-User-Token header.
// V2.1 backend does presence-only check; full token validation lives in a
// follow-up to api/meetings/_lib/auth.js.

import { auth } from "../firebase.js";

async function getToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  return user.getIdToken();
}

async function call(path, { method = "GET", body, params } = {}) {
  const url = new URL(`/api/meetings/${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const token = await getToken();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-Token": token,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// GET /api/meetings/list
// org_id is optional in Management (slug-based; backend treats null as "all orgs")
export function listMeetings({ start, end, orgId }) {
  return call("list", { params: { start, end, org_id: orgId } });
}

// PUT /api/meetings/reschedule
// mode: 'instance' | 'series'
// For 'instance', originalDate is required and eventId must be the recurring
// series master id (not an expanded instance id) — Google's events.instances
// API rejects instance ids when looking up the target instance.
// durationMinutes preserves the meeting's original length (defaults to 60 if
// the caller omits it).
export function rescheduleMeeting({ orgId, eventId, mode, originalDate, newDate, newTime, timezone, durationMinutes }) {
  return call("reschedule", {
    method: "PUT",
    body: {
      org_id: orgId || "unspecified",  // backend only checks presence; flag obviously
      event_id: eventId,
      mode,
      original_date: originalDate,
      new_date: newDate,
      new_time: newTime,
      timezone: timezone || "America/Los_Angeles",
      duration_minutes: durationMinutes,
    },
  });
}

// DELETE /api/meetings/cancel
// mode: 'instance' | 'series'
// For 'instance', date is required (YYYY-MM-DD of the specific occurrence).
export function cancelMeeting({ orgId, eventId, mode, date }) {
  return call("cancel", {
    method: "DELETE",
    body: {
      org_id: orgId || "unspecified",
      event_id: eventId,
      mode,
      date: date || null,
    },
  });
}

// POST /api/meetings/create
// Mints a Graph event (canonical) + Google mirror, fans .ics invites to all
// attendees from meetings@. For one-time meetings pass `date` + `time` and
// `cadence: null`; for recurring pass `cadence: { frequency, day, startDate,
// time, ordinal? }` and omit top-level date/time.
// Response: { agenda_id, eventId, m365EventId, seriesId, teamsUrl, iCalUID }
export function createMeeting({ orgId, title, agendaId, cadence, date, time, timezone, attendees }) {
  return call("create", {
    method: "POST",
    body: {
      agenda_id: agendaId || null,
      org_id: orgId || "unspecified",
      title,
      cadence: cadence || null,
      date: date || null,
      time: time || null,
      timezone: timezone || "America/Los_Angeles",
      attendees: attendees || [],
    },
  });
}

// POST /api/meetings/send-prep
// Sends the Meeting Prep email to every attendee. The endpoint walks the
// attendees array and renders + sends a per-attendee HTML email via Postmark
// (for @vistamarconsulting.com) or Graph (for everyone else).
export function sendMeetingPrep({ title, dateFormatted, topics, openFloor, attendees, lastMeetingOverview }) {
  return call("send-prep", {
    method: "POST",
    body: {
      title,
      dateFormatted,
      topics: topics || [],
      openFloor: openFloor || [],
      attendees: attendees || [],
      lastMeetingOverview: lastMeetingOverview || null,
    },
  });
}

// POST /api/meetings/send-schedule
// Sends the schedule confirmation email per attendee.
export function sendScheduleEmail({ title, dateFormatted, teamsUrl, isReschedule, attendees }) {
  return call("send-schedule", {
    method: "POST",
    body: {
      title,
      dateFormatted,
      teamsUrl,
      isReschedule: !!isReschedule,
      attendees: attendees || [],
    },
  });
}
