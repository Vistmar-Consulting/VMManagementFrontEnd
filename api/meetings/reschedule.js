// PUT /api/meetings/reschedule
//
// M365-primary flow: patch the Graph event first (Graph fans out updates to
// all attendees), then mirror the time change to the Google copy with
// sendUpdates:"none".
//
// `event_id` from the FE is the GOOGLE mirror event ID (unchanged contract).
// We resolve the m365EventId from the Google event's extendedProperties.
//
// Spec: docs/specs/2026-04-28-m365-primary-meeting-scheduler-design.md

import { rescheduleEvent as graphReschedule } from "./_lib/graph-events.js";
import { rescheduleEvent as googleReschedule, getM365EventId } from "./_lib/google-calendar.js";
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
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { org_id, event_id, mode, original_date, new_date, new_time, timezone } = req.body;

    if (!org_id || !event_id || !mode || !new_date || !new_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (mode === "instance" && !original_date) {
      return res.status(400).json({ error: "original_date required for instance mode" });
    }

    const tz = timezone || "America/Los_Angeles";
    const newStartDateTime = toLocalIso(new_date, new_time);
    const newEndDateTime = addOneHour(newStartDateTime);

    const m365EventId = await getM365EventId(event_id);
    if (!m365EventId) {
      // Pre-pivot events created via Plan D have no m365EventId. They must be
      // migrated (cancel + recreate via new path) — see ID Care recreation.
      return res.status(409).json({
        error: "Event has no M365 binding (pre-pivot). Cancel and recreate via the new architecture.",
      });
    }

    // Step 1 — Canonical patch on Graph. Graph fans out time-change .ics to all attendees.
    await graphReschedule({
      eventId: m365EventId,
      mode,
      originalDate: original_date,
      newStartDateTime,
      newEndDateTime,
      timezone: tz,
    });

    // Step 2 — Mirror time-change to Google (no fanout, Graph already did).
    await googleReschedule({
      eventId: event_id,
      mode,
      originalDate: original_date,
      newStartDateTime,
      newEndDateTime,
      timezone: tz,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PUT /api/meetings/reschedule error:", err);
    return res.status(500).json({ error: err.message });
  }
}
