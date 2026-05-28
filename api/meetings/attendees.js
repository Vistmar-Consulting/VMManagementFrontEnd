// PUT /api/meetings/attendees
//
// M365-primary flow: patch attendees on Graph first (Graph delivers .ics to
// new attendees with proper Teams binding AND cancellation .ics to removed
// ones), then mirror the attendee list to the Google copy with
// sendUpdates:"none".
//
// Removal of the Fireflies guest is silently blocked at this layer.
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { updateAttendees as graphUpdateAttendees } from "./_lib/graph-events.js";
import { updateAttendees as googleUpdateAttendees, getM365EventId } from "./_lib/google-calendar.js";
import { FIREFLIES_GUEST_EMAIL } from "./_lib/attendee-helpers.js";
import { requireAuth } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { org_id, event_id, add, remove } = req.body;

    if (!org_id || !event_id) {
      return res.status(400).json({ error: "Missing required fields: org_id, event_id" });
    }

    const filteredRemove = (remove || []).filter(
      (r) => r.email?.toLowerCase() !== FIREFLIES_GUEST_EMAIL
    );
    const safeAdd = add || [];

    if (!safeAdd.length && !filteredRemove.length) {
      return res.status(400).json({ error: "Must provide add or remove array" });
    }

    const m365EventId = await getM365EventId(event_id);
    if (!m365EventId) {
      return res.status(409).json({
        error: "Event has no M365 binding (pre-pivot). Cancel and recreate via the new architecture.",
      });
    }

    // Step 1 — Graph patch fans out add/remove .ics to attendees.
    await graphUpdateAttendees({
      eventId: m365EventId,
      add: safeAdd,
      remove: filteredRemove,
    });

    // Step 2 — Mirror attendee list to Google (no fanout).
    await googleUpdateAttendees({
      eventId: event_id,
      add: safeAdd,
      remove: filteredRemove,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PUT /api/meetings/attendees error:", err);
    return res.status(500).json({ error: err.message });
  }
}
