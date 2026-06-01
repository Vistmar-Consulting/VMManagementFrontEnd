// api/meetings/send-message.js
//
// Sends a custom note to a meeting's attendees alongside a cancel or
// reschedule. The native Google cancellation/reschedule notice has no
// custom-message slot, so this is a separate per-attendee email (VM → relay,
// external → Graph mail) — same routing as send-schedule.
import { sendMail } from "./_lib/graph-mail.js";
import { sendRelay } from "./_lib/relay-mail.js";
import { requireAuth } from "./_lib/auth.js";
import { applyCors } from "./_lib/cors.js";

function isVmEmail(email) {
  return String(email || "").toLowerCase().endsWith("@vistamarconsulting.com");
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml({ title, kind, dateFormatted, message }) {
  const heading = kind === "cancel" ? "Meeting Cancelled" : "Meeting Rescheduled";
  const sub = kind === "cancel"
    ? `${esc(title)} has been cancelled.`
    : `${esc(title)} has been rescheduled${dateFormatted ? ` to ${esc(dateFormatted)}` : ""}.`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px;">
  <div style="background:#fff;border-radius:10px;padding:24px;border:1px solid #eee;">
    <h2 style="margin:0 0 6px;font-size:18px;color:#1a1a2e;">${heading}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#555;">${sub}</p>
    <div style="border-top:1px solid #eee;padding-top:16px;font-size:14px;color:#1a1a2e;white-space:pre-wrap;">${esc(message)}</div>
  </div>
  <p style="font-size:11px;color:#999;text-align:center;margin-top:14px;">Vistamar Consulting</p>
</div>
</body></html>`;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  try {
    const { title, kind, dateFormatted, message, attendees } = req.body;
    if (!title || !message || !attendees?.length) {
      return res.status(400).json({ error: "Missing required fields: title, message, attendees" });
    }
    const subject = kind === "cancel" ? `${title} — cancellation note` : `${title} — reschedule note`;
    const html = buildHtml({ title, kind, dateFormatted, message });

    const results = { sent: 0, failed: 0, errors: [] };
    for (const att of attendees) {
      try {
        if (isVmEmail(att.email)) await sendRelay({ to: att.email, subject, htmlBody: html });
        else await sendMail({ to: att.email, subject, htmlBody: html });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push({ email: att.email, error: err.message });
      }
    }
    return res.status(200).json(results);
  } catch (err) {
    console.error("POST /api/meetings/send-message error:", err);
    return res.status(500).json({ error: err.message });
  }
}
