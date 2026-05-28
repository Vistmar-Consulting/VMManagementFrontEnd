/**
 * schedule-email.js
 * Pure function that builds a meeting schedule/reschedule notification email.
 * All styles are inline (email client requirement).
 */

const COPPER = "#b87333";
const CREAM = "#faf8f5";

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build a complete HTML email document for a schedule notification.
 *
 * @param {Object} params
 * @param {string} params.title           - Meeting title
 * @param {string} params.dateFormatted   - Pre-formatted date string
 * @param {string|null} params.teamsUrl   - Teams join URL or null
 * @param {boolean} params.isReschedule   - true = rescheduled, false = newly scheduled
 * @param {string[]} params.attendeeNames - Array of attendee display names
 * @returns {string} Complete HTML document string
 */
export function buildScheduleHtml({ title, dateFormatted, teamsUrl, isReschedule, attendeeNames }) {
  const heading = isReschedule ? "Meeting Rescheduled" : "Meeting Scheduled";
  const subheading = isReschedule
    ? `${escHtml(title)} has been rescheduled.`
    : `${escHtml(title)} has been scheduled.`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:white;">
  <tr><td style="background:${CREAM};padding:28px 32px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:20px;font-weight:500;color:#2a2520;">${escHtml(title)}</div>
    <div style="font-size:13px;color:${COPPER};font-weight:600;margin-top:6px;">${heading}</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <div style="font-size:14px;color:#5a5249;line-height:1.6;">${subheading}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">
      <tr>
        <td style="padding:12px 16px;background:${CREAM};border-radius:8px;">
          <div style="font-size:11px;color:#8a8077;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Date & Time</div>
          <div style="font-size:15px;color:#2a2520;font-weight:500;margin-top:4px;">${escHtml(dateFormatted)}</div>
        </td>
      </tr>
    </table>
    ${teamsUrl ? `<div style="margin-top:16px;"><a href="${escHtml(teamsUrl)}" style="display:inline-block;background:#5059C9;color:white;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Join Microsoft Teams Meeting</a></div>` : ""}
    ${attendeeNames?.length ? `<div style="margin-top:20px;font-size:12px;color:#8a8077;"><strong>Attendees:</strong> ${attendeeNames.map(escHtml).join(", ")}</div>` : ""}
  </td></tr>
  <tr><td style="padding:20px 32px;background:${CREAM};text-align:center;">
    <div style="font-size:11px;color:#b0a89e;">Vistamar Consulting</div>
  </td></tr>
</table>
</body></html>`;
}
