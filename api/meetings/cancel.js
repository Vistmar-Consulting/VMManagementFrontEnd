// DELETE /api/meetings/cancel
//
// Cancel on Google first (the copy that emails attendees), then on Graph.
// Occurrences are matched by exact start instant (original_start).
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { cancelEvent as graphCancel } from "./_lib/graph-events.js";
import { cancelEvent as googleCancel, getM365EventId } from "./_lib/google-calendar.js";
import { requireAuth, requireV2_2Enabled } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  try {
    const { org_id, event_id, mode, original_start, notify } = req.body;

    if (!org_id || !event_id || !mode) {
      return res.status(400).json({ error: "Missing required fields: org_id, event_id, mode" });
    }
    if (mode === "instance" && (!original_start || Number.isNaN(Date.parse(original_start)))) {
      return res.status(400).json({ error: "original_start (the occurrence's start instant) is required for instance mode. Reload the page and try again." });
    }

    const m365EventId = await getM365EventId(event_id);
    if (!m365EventId) {
      return res.status(409).json({
        error: "Event has no M365 binding (pre-pivot). Cancel via Google migration script.",
      });
    }

    // Google first: it is the invite-fan path (sendUpdates "all" emails a
    // cancellation to every attendee; "none" removes it silently). Graph cancel
    // is silent in our tenant (meetings@ has no send rights), so a Graph outage
    // must not block the attendee-facing cancel. Both steps are retry-safe.
    await googleCancel({
      eventId: event_id,
      mode,
      originalStart: original_start,
      sendUpdates: notify === false ? "none" : "all",
    });
    try {
      await graphCancel({ eventId: m365EventId, mode, originalStart: original_start });
    } catch (graphErr) {
      console.error("DELETE /api/meetings/cancel: Graph step failed after Google succeeded:", graphErr);
      return res.status(502).json({
        error:
          "The meeting is cancelled in Google Calendar (attendees' calendars), but the Outlook calendar on " +
          `meetings@ was not updated (${graphErr.message}). Click Cancel meeting again to finish — it is safe to retry.`,
        partial: true,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("DELETE /api/meetings/cancel error:", err);
    return res.status(500).json({ error: err.message });
  }
}
