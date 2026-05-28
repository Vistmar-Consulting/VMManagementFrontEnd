// DELETE /api/meetings/cancel
//
// M365-primary flow: cancel on Graph first (Graph fans out cancellation .ics
// to all attendees), then mirror the cancellation/delete to the Google copy
// with sendUpdates:"none".
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { cancelEvent as graphCancel } from "./_lib/graph-events.js";
import { cancelEvent as googleCancel, getM365EventId } from "./_lib/google-calendar.js";
import { requireAuth } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { org_id, event_id, mode, date } = req.body;

    if (!org_id || !event_id || !mode) {
      return res.status(400).json({ error: "Missing required fields: org_id, event_id, mode" });
    }
    if (mode === "instance" && !date) {
      return res.status(400).json({ error: "date required for instance mode" });
    }

    const m365EventId = await getM365EventId(event_id);
    if (!m365EventId) {
      return res.status(409).json({
        error: "Event has no M365 binding (pre-pivot). Cancel via Google migration script.",
      });
    }

    await graphCancel({ eventId: m365EventId, mode, date });
    await googleCancel({ eventId: event_id, mode, date });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("DELETE /api/meetings/cancel error:", err);
    return res.status(500).json({ error: err.message });
  }
}
