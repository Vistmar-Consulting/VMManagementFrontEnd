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

// Add N minutes to a local ISO without a timezone suffix. Treats the input
// as UTC for the arithmetic, then strips the trailing Z — wall-clock
// semantics ride on the `timeZone` field that travels separately with the
// start/end objects in the Google + Graph payloads.
function addMinutes(localIso, minutes) {
  const d = new Date(`${localIso}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;

  try {
    const { org_id, event_id, mode, original_date, new_date, new_time, timezone, duration_minutes } = req.body;

    if (!org_id || !event_id || !mode || !new_date || !new_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (mode === "instance" && !original_date) {
      return res.status(400).json({ error: "original_date required for instance mode" });
    }

    const tz = timezone || "America/Los_Angeles";
    const newStartDateTime = toLocalIso(new_date, new_time);
    // Preserve the meeting's original duration. Archive used to hardcode 60
    // (addOneHour), silently flattening 30-min standups + 90-min strategy
    // sessions to 1hr. FE now derives durationMinutes from the meeting's
    // start/end and forwards it. Falls back to 60 only if the caller omits.
    const durMin = Number.isFinite(duration_minutes) && duration_minutes > 0
      ? duration_minutes
      : 60;
    const newEndDateTime = addMinutes(newStartDateTime, durMin);

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
