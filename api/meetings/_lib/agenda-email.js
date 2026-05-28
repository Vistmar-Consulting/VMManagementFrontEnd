/**
 * agenda-email.js
 * Pure function that takes structured agenda data and returns a complete HTML email string.
 * All styles are inline (email client requirement).
 * Max width 600px, table-safe layout for Outlook.
 */

const STATUS_COLORS = {
  "Assigned":    { bg: "#f5f5f5", text: "#616161" },
  "In Progress": { bg: "#e3f2fd", text: "#1565c0" },
  "Review":      { bg: "#f3e5f5", text: "#7b1fa2" },
  "On Hold":     { bg: "#fce4ec", text: "#c62828" },
  "Done":        { bg: "#e8f5e9", text: "#2e7d32" },
};

const PRIORITY_COLORS = {
  "High":   "#ef5350",
  "Medium": "#ffa726",
  "Low":    "#66bb6a",
};

/**
 * Convert Fireflies overview markdown to safe HTML.
 * - **text** → <strong>text</strong>
 * - Strip leading "- " from lines
 * - Split on double newlines → join with <br><br>
 */
export function overviewToHtml(markdown) {
  if (!markdown) return "";
  return markdown
    .split(/\n\n+/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.replace(/^- /, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"))
        .join(" ")
        .trim()
    )
    .filter(Boolean)
    .join("<br><br>");
}

/**
 * Build a complete HTML email document for a meeting agenda.
 *
 * @param {Object} params
 * @param {string} params.title             - Meeting title (e.g. "Unio - Weekly")
 * @param {string} params.dateFormatted     - Pre-formatted date (e.g. "Tuesday, April 14 at 1:00 PM ET")
 * @param {Array}  params.topics            - Array of { Topic_Name, Topic_Desc, talkingPoints: [{ Talking_Point }] }
 * @param {Array}  params.openFloor         - Array of { Discussion_Item }
 * @param {Array}  params.tasks             - Array of { Item_Title, parentTopic, Status_Name, Priority_Name, Due_Date, isCompleted }
 * @param {string|null} params.lastMeetingOverview - Fireflies markdown or null
 * @returns {string} Complete HTML document string
 */
export function buildAgendaHtml({ title, dateFormatted, topics, openFloor, tasks, lastMeetingOverview }) {

  // ─── HERO ───────────────────────────────────────────────────────────────────
  const heroHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf8f5;border-bottom:3px solid #b87333;">
      <tr>
        <td style="padding:24px 32px 20px;">
          <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">${escHtml(title)}</p>
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#7a7067;">${escHtml(dateFormatted)}</p>
        </td>
      </tr>
    </table>`;

  // ─── TOPICS ─────────────────────────────────────────────────────────────────
  const topicsHtml = topics && topics.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:16px 32px 6px;font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#b87333;">Topics</td>
      </tr>
    </table>
    ${topics.map((topic, i) => {
      const isLast = i === topics.length - 1;
      const tpRows = (topic.talkingPoints || []).map((tp) =>
        `<p style="margin:3px 0 0;font-family:-apple-system,Arial,sans-serif;font-size:12px;color:#3a3530;line-height:1.55;"><span style="color:#b87333;margin-right:4px;">›</span>${escHtml(tp.Talking_Point)}</p>`
      ).join("");
      const descRow = topic.Topic_Desc
        ? `<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:12.5px;color:#5a534b;line-height:1.5;">${escHtml(topic.Topic_Desc)}</p>`
        : "";
      return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${isLast ? "" : "border-bottom:1px solid #f0ece7;"}">
      <tr>
        <td style="padding:12px 32px 14px;">
          <p style="margin:0 0 3px;font-family:-apple-system,Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">${escHtml(topic.Topic_Name)}</p>
          ${descRow}
          ${tpRows}
        </td>
      </tr>
    </table>`;
    }).join("")}` : "";

  // ─── OPEN FLOOR ─────────────────────────────────────────────────────────────
  const openFloorHtml = openFloor && openFloor.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #f0ece7;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:16px 32px 6px;font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#b87333;">Open Floor</td>
      </tr>
    </table>
    ${openFloor.map((item) =>
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:4px 32px;font-family:Georgia,'Times New Roman',serif;font-size:12.5px;color:#3a3530;line-height:1.5;"><span style="color:#b87333;margin-right:6px;">○</span>${escHtml(item.Discussion_Item)}</td>
      </tr>
    </table>`
    ).join("")}` : "";

  // ─── YOUR TASKS ─────────────────────────────────────────────────────────────
  let tasksHtml = "";
  if (tasks && tasks.length > 0) {
    const activeTasks = tasks.filter((t) => !t.isCompleted);
    const doneTasks   = tasks.filter((t) => t.isCompleted);

    const renderTaskRow = (task, isDone) => {
      const statusColor = STATUS_COLORS[task.Status_Name] || STATUS_COLORS["Assigned"];
      const priorityDotColor = PRIORITY_COLORS[task.Priority_Name] || "#a09890";
      const priorityLabel = task.Priority_Name === "Medium" ? "Med" : (task.Priority_Name || "");
      const dueLabel = task.Due_Date ? formatDueDate(task.Due_Date) : "";
      const isOverdue = task.Due_Date && !isDone && isPastDue(task.Due_Date);
      const rowOpacity = isDone ? "opacity:0.5;" : "";
      const titleWeight = isDone ? "font-weight:400;" : "font-weight:500;";

      return `
          <tr style="${rowOpacity}">
            <td style="font-family:-apple-system,Arial,sans-serif;font-size:12px;color:#3a3530;padding:8px 0;vertical-align:top;border-bottom:1px solid #f8f6f3;">
              <p style="margin:0;${titleWeight}color:#1a1a1a;">${escHtml(task.Item_Title)}</p>
              ${task.parentTopic ? `<p style="margin:1px 0 0;font-size:10px;color:#a09890;">${escHtml(task.parentTopic)}</p>` : ""}
            </td>
            <td style="font-family:-apple-system,Arial,sans-serif;font-size:12px;color:#3a3530;padding:8px 0 8px 8px;vertical-align:top;border-bottom:1px solid #f8f6f3;width:90px;">
              <span style="display:inline-block;font-family:-apple-system,Arial,sans-serif;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;letter-spacing:0.2px;background-color:${statusColor.bg};color:${statusColor.text};">${escHtml(task.Status_Name || "")}</span>
            </td>
            <td style="font-family:-apple-system,Arial,sans-serif;font-size:12px;color:#3a3530;padding:8px 0 8px 8px;vertical-align:top;border-bottom:1px solid #f8f6f3;width:65px;">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${priorityDotColor};margin-right:4px;vertical-align:middle;"></span><span style="font-size:11px;color:#5a534b;vertical-align:middle;">${escHtml(priorityLabel)}</span>
            </td>
            <td style="font-family:-apple-system,Arial,sans-serif;font-size:11px;color:${isOverdue ? "#c62828" : "#7a7067"};${isOverdue ? "font-weight:600;" : ""}padding:8px 0;vertical-align:top;border-bottom:1px solid #f8f6f3;width:55px;text-align:right;">${escHtml(dueLabel)}</td>
          </tr>`;
    };

    const separatorRow = doneTasks.length > 0 && activeTasks.length > 0 ? `
          <tr>
            <td colspan="4" style="padding:0;border-bottom:none;"><hr style="border:none;border-top:1px solid #d5d0c9;margin:4px 0;"></td>
          </tr>` : "";

    tasksHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #f0ece7;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:16px 32px 6px;font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#b87333;">Your Tasks</td>
      </tr>
    </table>
    <table width="calc(100% - 64px)" cellpadding="0" cellspacing="0" border="0" style="width:calc(100% - 64px);margin:0 32px 16px;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#a09890;text-align:left;padding:0 0 6px;border-bottom:1px solid #f0ece7;">Item</th>
          <th style="font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#a09890;text-align:left;padding:0 0 6px;border-bottom:1px solid #f0ece7;width:90px;padding-left:8px;">Status</th>
          <th style="font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#a09890;text-align:left;padding:0 0 6px;border-bottom:1px solid #f0ece7;width:65px;padding-left:8px;">Priority</th>
          <th style="font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#a09890;text-align:right;padding:0 0 6px;border-bottom:1px solid #f0ece7;width:55px;">Due</th>
        </tr>
      </thead>
      <tbody>
        ${activeTasks.map((t) => renderTaskRow(t, false)).join("")}
        ${separatorRow}
        ${doneTasks.map((t) => renderTaskRow(t, true)).join("")}
      </tbody>
    </table>`;
  }

  // ─── LAST MEETING ───────────────────────────────────────────────────────────
  let lastMeetingHtml = "";
  if (lastMeetingOverview) {
    const overviewContent = overviewToHtml(lastMeetingOverview);
    lastMeetingHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #f0ece7;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:16px 32px 6px;font-family:-apple-system,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#b87333;">Last Meeting</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:12px 32px 16px;font-family:Georgia,'Times New Roman',serif;font-size:12.5px;color:#3a3530;line-height:1.6;">${overviewContent}</td>
      </tr>
    </table>`;
  }

  // ─── FOOTER ─────────────────────────────────────────────────────────────────
  const footerHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf8f5;border-top:1px solid #f0ece7;">
      <tr>
        <td style="padding:16px 32px;text-align:center;font-family:-apple-system,Arial,sans-serif;font-size:10px;color:#a09890;">
          Prepared by <a href="#" style="color:#b87333;text-decoration:none;">Vistamar Consulting</a><br>
          <a href="#" style="color:#b87333;text-decoration:none;">View full agenda in Console</a> &middot; <a href="#" style="color:#b87333;text-decoration:none;">Unsubscribe</a>
        </td>
      </tr>
    </table>`;

  // ─── FULL DOCUMENT ───────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — Meeting Agenda</title>
</head>
<body style="margin:0;padding:0;background-color:#e8e4df;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8e4df;">
  <tr>
    <td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:4px;overflow:hidden;">
        <tr>
          <td>
            ${heroHtml}
            ${topicsHtml}
            ${openFloorHtml}
            ${tasksHtml}
            ${lastMeetingHtml}
            ${footerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent injection.
 */
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format a Due_Date string into a short label like "Apr 11".
 */
function formatDueDate(dueDateStr) {
  if (!dueDateStr) return "";
  const d = new Date(dueDateStr);
  if (isNaN(d.getTime())) return dueDateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Return true if the due date is in the past (past midnight today).
 */
function isPastDue(dueDateStr) {
  if (!dueDateStr) return false;
  const d = new Date(dueDateStr);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}
