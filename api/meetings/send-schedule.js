import { buildScheduleHtml } from "./_lib/schedule-email.js";
import { sendMail } from "./_lib/graph-mail.js";
import { sendRelay } from "./_lib/relay-mail.js";
import { requireAuth, requireV2_2Enabled } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

function isVmEmail(email) {
  return String(email || "").toLowerCase().endsWith("@vistamarconsulting.com");
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  try {
    const { title, dateFormatted, teamsUrl, isReschedule, attendees } = req.body;
    if (!title || !dateFormatted || !attendees?.length) {
      return res.status(400).json({ error: "Missing required fields: title, dateFormatted, attendees" });
    }

    const subject = isReschedule
      ? `${title} — Rescheduled to ${dateFormatted}`
      : `${title} — Scheduled for ${dateFormatted}`;

    const attendeeNames = attendees.map((a) => a.name).filter(Boolean);
    const html = buildScheduleHtml({ title, dateFormatted, teamsUrl, isReschedule, attendeeNames });

    const results = { sent: 0, failed: 0, errors: [] };
    for (const att of attendees) {
      try {
        if (isVmEmail(att.email)) {
          await sendRelay({ to: att.email, subject, htmlBody: html });
        } else {
          await sendMail({ to: att.email, subject, htmlBody: html });
        }
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({ email: att.email, error: err.message });
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error("POST /api/meetings/send-schedule error:", err);
    return res.status(500).json({ error: err.message });
  }
}
