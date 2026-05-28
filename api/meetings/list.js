// GET /api/meetings/list
//
// Returns events for an org in a time window. Reads from the Google mirror
// (orgId-scoped via extendedProperties.private.orgId) and enriches attendee
// responseStatus with FRESH RSVPs from Graph — Graph is now the canonical
// invite-fanout path, so attendee Accept/Decline routes to M365, not Google.
//
// Each Google event carries m365EventId in its extendedProperties; we use it
// to join Graph's per-event attendee response data. Pre-pivot events that
// lack m365EventId fall through with stale (likely "needsAction") statuses
// from Google — until they're migrated, that's the best we can do.
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { listEvents } from "./_lib/google-calendar.js";
import { listEventResponses, graphResponseToGoogle } from "./_lib/graph-events.js";
import { requireAuth } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

function mergeRsvps(events, graphRsvpsByEventId) {
  return events.map((ev) => {
    const key = ev.m365EventId || ev.series_id;
    if (!key) return ev;
    const graphRsvps = graphRsvpsByEventId[key];
    if (!graphRsvps) return ev;
    const graphByEmail = new Map(
      graphRsvps.map((r) => [String(r.email || "").toLowerCase(), r.status])
    );
    return {
      ...ev,
      attendees: ev.attendees.map((a) => {
        const graphStatus = graphByEmail.get(String(a.email || "").toLowerCase());
        if (!graphStatus) return a;
        return { ...a, status: graphResponseToGoogle(graphStatus) };
      }),
    };
  });
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { org_id, start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Missing required params: start, end" });
    }

    // VMManagement uses slug-based orgIds (strings, e.g. 'vistamar', 'total-vision');
    // Console used numeric. Pass through as-is — null/empty = "all orgs" (FE filters).
    const orgId = org_id || null;
    const events = await listEvents({ orgId, start, end });

    // Best-effort RSVP enrichment from Graph. If Graph fails, return Google-
    // only data with possibly-stale statuses rather than 500ing the whole list.
    let graphRsvps = {};
    try {
      graphRsvps = await listEventResponses({ orgId, start, end });
    } catch (rsvpErr) {
      console.error("list.js graph RSVP merge failed (using stale Google statuses):", rsvpErr.message);
    }

    const merged = mergeRsvps(events, graphRsvps);
    return res.status(200).json({ meetings: merged });
  } catch (err) {
    console.error("GET /api/meetings/list error:", err);
    return res.status(500).json({ error: err.message });
  }
}
