// PUT /api/meetings/reschedule
//
// Patch Google first, then Graph. Google is the copy that emails attendees
// (sendUpdates:"all"; the meetings@ M365 mailbox has no send rights), so a
// Graph outage must not stop the attendee-facing change. Each side is
// retry-safe: an occurrence an earlier attempt already moved is skipped, so
// "Reschedule" can be clicked again after a partial failure.
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
  if (!(await requireAuth(req, res))) return;

  try {
    const { org_id, event_id, mode, original_start, new_date, new_time, timezone, duration_minutes } = req.body;

    if (!org_id || !event_id || !mode || !new_date || !new_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (mode === "instance" && (!original_start || Number.isNaN(Date.parse(original_start)))) {
      return res.status(400).json({ error: "original_start (the occurrence's start instant) is required for instance mode. Reload the page and try again." });
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

    const args = {
      mode,
      originalStart: original_start,
      newStartDateTime,
      newEndDateTime,
      timezone: tz,
    };

    // Step 1 — Google: moves the attendees' invites.
    await googleReschedule({ eventId: event_id, ...args });

    // Step 2 — Graph: keeps the meetings@ Outlook calendar (and Teams meeting
    // times) in step. A failure here leaves the two calendars apart, so say so
    // plainly; a retry finishes the job.
    try {
      await graphReschedule({ eventId: m365EventId, ...args });
    } catch (graphErr) {
      console.error("PUT /api/meetings/reschedule: Graph step failed after Google succeeded:", graphErr);
      return res.status(502).json({
        error:
          "Attendees were sent the new time, but the Outlook calendar on meetings@ was not updated " +
          `(${graphErr.message}). Click Reschedule again to finish — it is safe to retry.`,
        partial: true,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("PUT /api/meetings/reschedule error:", err);
    return res.status(500).json({ error: err.message });
  }
}
