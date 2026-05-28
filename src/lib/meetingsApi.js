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
// For 'instance', originalDate is required.
export function rescheduleMeeting({ orgId, eventId, mode, originalDate, newDate, newTime, timezone }) {
  return call("reschedule", {
    method: "PUT",
    body: {
      org_id: orgId || "management",  // backend only checks presence
      event_id: eventId,
      mode,
      original_date: originalDate,
      new_date: newDate,
      new_time: newTime,
      timezone: timezone || "America/Los_Angeles",
    },
  });
}
