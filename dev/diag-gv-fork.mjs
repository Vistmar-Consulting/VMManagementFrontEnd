// dev/diag-gv-fork.mjs
//
// READ-ONLY deep-dive on the forked "GV – Biweekly" Graph series surfaced by
// audit-recurring-meetings.mjs. There are two live Graph masters:
//   • current  (Wed Jul 15 cadence) — mirrored to Google, app-managed
//   • stale    (Wed Jul  8 cadence) — Graph-only, invisible to the app
//
// For every GV series master on the meetings@ mailbox this dumps organizer,
// createdDateTime, recurrence pattern, and the full attendee list, plus a
// flag for whether the Google mirror carries the same m365 id — so we can
// decide whether the stale one is a safe-to-cancel duplicate and WHO would
// get a cancellation email.
//
// Touches nothing. No writes, no patches, no cancels. Pure GET.
//
// Run:  node --env-file=.env.vercel dev/diag-gv-fork.mjs

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

const TITLE_MATCH = "GV";
const WINDOW_START = new Date().toISOString().slice(0, 10);
const WINDOW_END = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
const IMPERSONATE = "meetings@vistamarconsulting.com";

function line() { console.log("─".repeat(76)); }
function norm(s) { return (s || "").replace(/[‒-―−-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase(); }

async function graphToken() {
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function graphGet(token, hostUserId, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${hostUserId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Pacific Standard Time"' },
  });
  if (!res.ok) throw new Error(`Graph GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Collect the Google mirror's set of m365 ids so we can mark which Graph
// master is actually mirrored (= app-managed).
async function googleMirrorM365Ids() {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email, key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"], subject: IMPERSONATE,
  });
  await auth.authorize();
  const cal = google.calendar({ version: "v3", auth });
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true, orderBy: "startTime", maxResults: 2500,
  });
  const ids = new Set();
  for (const e of res.data.items || []) {
    if (norm(e.summary).includes("gv")) {
      const m = e.extendedProperties?.private?.m365EventId;
      if (m) ids.add(m);
    }
  }
  return ids;
}

(async () => {
  line();
  console.log(`GV FORK DIAGNOSTIC  window ${WINDOW_START}..${WINDOW_END}  (READ-ONLY)`);
  line();

  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const mirrorIds = await googleMirrorM365Ids();

  // Find all GV series masters in the window.
  const view = await graphGet(
    token, hostUserId,
    `/calendarView?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
    `&$select=id,subject,seriesMasterId,start&$top=999`
  );
  const masters = new Map(); // seriesMasterId -> next start
  for (const e of (view.value || [])) {
    if (!e.seriesMasterId || !norm(e.subject).includes("gv")) continue;
    if (!masters.has(e.seriesMasterId)) masters.set(e.seriesMasterId, e.start?.dateTime?.slice(0, 16));
    else {
      const prev = masters.get(e.seriesMasterId);
      const cur = e.start?.dateTime?.slice(0, 16);
      if (cur && (!prev || cur < prev)) masters.set(e.seriesMasterId, cur);
    }
  }

  console.log(`GV Graph series masters found: ${masters.size}\n`);

  for (const [mid, next] of masters) {
    const m = await graphGet(
      token, hostUserId,
      `/events/${mid}?$select=id,subject,organizer,createdDateTime,recurrence,attendees,isCancelled`
    );
    const mirrored = mirrorIds.has(mid);
    line();
    console.log(`SERIES "${m.subject}"`);
    console.log(`  masterId       : ${mid}`);
    console.log(`  next occurrence: ${next || "-"}`);
    console.log(`  APP-MANAGED    : ${mirrored ? "YES — mirrored to Google (this is the live one)" : "NO  — Graph-only (candidate stale duplicate)"}`);
    console.log(`  created        : ${m.createdDateTime || "-"}`);
    console.log(`  organizer      : ${m.organizer?.emailAddress?.address || "-"}`);
    const rp = m.recurrence?.pattern;
    console.log(`  recurrence     : ${rp ? `${rp.type} every ${rp.interval} on ${(rp.daysOfWeek || []).join(",")}` : "-"}  range=${m.recurrence?.range?.startDate || "-"}..${m.recurrence?.range?.endDate || "(open)"}`);
    const att = m.attendees || [];
    console.log(`  attendees (${att.length}):`);
    for (const a of att) {
      console.log(`     - ${a.emailAddress?.address || "?"}  (${a.type}, ${a.status?.response || "none"})`);
    }
  }
  line();
  console.log("Done. Nothing was modified. No cancellations sent.");
  line();
})().catch((err) => {
  console.error("\nDIAGNOSTIC FAILED:", err.message);
  process.exit(1);
});
