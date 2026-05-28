// PUT /api/meetings/rename
//
// M365-primary flow: rename on Graph first (Graph fans out the title-change
// to attendees as a meeting update), then mirror the title to the Google
// copy with sendUpdates:"none".
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { renameEvent as graphRename } from "./_lib/graph-events.js";
import { renameEvent as googleRename, getM365EventId } from "./_lib/google-calendar.js";
import { requireAuth, requireV2_2Enabled } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  if (!requireV2_2Enabled(req, res)) return;
  if (!requireAuth(req, res)) return;

  try {
    const { event_id, title } = req.body;
    if (!event_id || !title) {
      return res.status(400).json({ error: "Missing required params: event_id, title" });
    }

    const m365EventId = await getM365EventId(event_id);
    if (!m365EventId) {
      return res.status(409).json({
        error: "Event has no M365 binding (pre-pivot). Cancel and recreate via the new architecture.",
      });
    }

    await graphRename({ eventId: m365EventId, title });
    await googleRename({ eventId: event_id, title });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PUT /api/meetings/rename error:", err);
    return res.status(500).json({ error: err.message });
  }
}
