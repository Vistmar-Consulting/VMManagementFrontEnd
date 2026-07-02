// dev/repair-business-dev-thisweek.mjs
//
// One-off RECOVERY for the "VM - Weekly Business Dev" series whose this-week
// occurrence (originalStart Fri Jun 12 11:30) diverged: Graph moved it to
// Mon Jun 15 1:00 PM, but the Google mirror is stranded at Fri Jun 12 1:00 PM.
// Google is the invite-fan path, so attendees currently see Friday.
//
// This script aligns the Google occurrence to Graph (Mon Jun 15 1:00 PM,
// duration preserved) and re-notifies attendees. Future Friday occurrences
// are untouched.
//
// SAFETY: dry-run by default — prints the planned change and exits. Pass
// --apply to actually PATCH Google and email attendees (sendUpdates:all).
//
// Run (dry-run):  node --env-file=.env.vercel dev/repair-business-dev-thisweek.mjs
// Run (apply):    node --env-file=.env.vercel dev/repair-business-dev-thisweek.mjs --apply

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

const APPLY = process.argv.includes("--apply");
const NOTIFY = !process.argv.includes("--silent"); // --silent → sendUpdates:none (no attendee email)
const TITLE_MATCH = "Weekly Business Dev";
const IMPERSONATE = "meetings@vistamarconsulting.com";
const WINDOW_START = "2026-06-06";
const WINDOW_END = "2026-06-22";

// The occurrence we're repairing, identified by its original recurrence date.
const ORIGINAL_OCCURRENCE_DATE = "2026-06-12"; // Fri, the natural slot it came from
const TARGET_DATE = "2026-06-15";              // Mon
const EXPECTED_GRAPH_DATE = "2026-06-15";      // Graph should already be here
const EXPECTED_LOCAL_TIME = "13:00:00";        // 1:00 PM PT

function line() { console.log("─".repeat(72)); }
function stripOffset(dt) { return dt ? dt.replace(/[+-]\d{2}:?\d{2}$|Z$/, "") : dt; }
function swapDate(localDt, newDate) {
  // "2026-06-12T13:00:00" -> "2026-06-15T13:00:00"
  return localDt.replace(/^\d{4}-\d{2}-\d{2}/, newDate);
}

// ── Google ──
async function googleClient() {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject: IMPERSONATE,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

async function resolveMasters(cal) {
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
    q: TITLE_MATCH,
  });
  const items = (res.data.items || []).filter((e) => (e.summary || "").includes(TITLE_MATCH));
  const googleMaster = items.find((e) => e.recurringEventId)?.recurringEventId || null;
  const graphMaster =
    items.map((e) => e.extendedProperties?.private?.m365EventId).find(Boolean) || null;
  return { googleMaster, graphMaster };
}

async function getGoogleThisWeek(cal, googleMaster) {
  const res = await cal.events.instances({
    calendarId: "primary",
    eventId: googleMaster,
    timeMin: `${WINDOW_START}T00:00:00Z`,
    timeMax: `${WINDOW_END}T23:59:59Z`,
    showDeleted: true,
    maxResults: 50,
  });
  const items = res.data.items || [];
  // The repaired occurrence is the one whose ORIGINAL start is Jun 12.
  return items.find((e) =>
    (e.originalStartTime?.dateTime || e.originalStartTime?.date || "").startsWith(ORIGINAL_OCCURRENCE_DATE)
  ) || null;
}

// ── Graph (read-only verify) ──
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

async function getGraphThisWeek(graphMaster) {
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${hostUserId}/calendar/events/${graphMaster}/instances` +
      `?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
      `&$select=id,type,start,end,isCancelled`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="Pacific Standard Time"',
      },
    }
  );
  if (!res.ok) throw new Error(`Graph instances GET -> ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.value || []).find((e) => e.type === "exception") || null;
}

// ── main ──
(async () => {
  line();
  console.log(`REPAIR "${TITLE_MATCH}" this-week occurrence  —  mode: ${APPLY ? `APPLY (${NOTIFY ? "will email attendees" : "SILENT, no email"})` : "DRY-RUN"}`);
  line();

  const cal = await googleClient();
  const { googleMaster, graphMaster } = await resolveMasters(cal);
  console.log(`googleMaster = ${googleMaster}`);
  console.log(`graphMaster  = ${graphMaster}`);
  if (!googleMaster || !graphMaster) throw new Error("Could not resolve both master ids — aborting.");

  // 1) Verify Graph is already at the target (Mon Jun 15 1:00 PM, not cancelled).
  const gx = await getGraphThisWeek(graphMaster);
  if (!gx) throw new Error("No Graph exception found for this week — state differs from expectation, aborting.");
  const gxLocal = stripOffset(gx.start?.dateTime);
  console.log(`\nGraph this-week exception: start=${gxLocal} (${gx.start?.timeZone})  isCancelled=${gx.isCancelled}`);
  if (gx.isCancelled) throw new Error("Graph exception is cancelled — aborting; needs different recovery.");
  if (!gxLocal?.startsWith(EXPECTED_GRAPH_DATE) || !gxLocal?.includes(EXPECTED_LOCAL_TIME)) {
    throw new Error(`Graph not at expected ${EXPECTED_GRAPH_DATE}T${EXPECTED_LOCAL_TIME} — aborting (no assumptions).`);
  }
  console.log("✓ Graph confirmed at Mon Jun 15 1:00 PM.");

  // 2) Read the stranded Google occurrence.
  const ev = await getGoogleThisWeek(cal, googleMaster);
  if (!ev) throw new Error("Could not find the Google this-week occurrence (originalStart Jun 12) — aborting.");
  const curStartLocal = stripOffset(ev.start?.dateTime);
  const curEndLocal = stripOffset(ev.end?.dateTime);
  console.log(`\nGoogle occurrence to repair: id=${ev.id}`);
  console.log(`  current: ${curStartLocal} → ${curEndLocal}  (status=${ev.status})`);

  // 3) Build the new times: keep wall-clock (1:00 PM) + duration, move day to Jun 15.
  const newStartLocal = swapDate(curStartLocal, TARGET_DATE);
  const newEndLocal = swapDate(curEndLocal, TARGET_DATE);
  console.log(`  target:  ${newStartLocal} → ${newEndLocal}  (America/Los_Angeles)`);

  // Sanity: new start must be 1:00 PM, else our assumption about the Google
  // time is wrong and we should not proceed silently.
  if (!newStartLocal.includes(EXPECTED_LOCAL_TIME)) {
    throw new Error(`Google start is not ${EXPECTED_LOCAL_TIME} (${newStartLocal}) — aborting; confirm intended time.`);
  }

  if (!APPLY) {
    line();
    console.log("DRY-RUN: no changes made. Re-run with --apply to PATCH Google + email attendees (sendUpdates:all).");
    line();
    return;
  }

  // 4) Apply.
  await cal.events.patch({
    calendarId: "primary",
    eventId: ev.id,
    sendUpdates: NOTIFY ? "all" : "none",
    requestBody: {
      start: { dateTime: newStartLocal, timeZone: "America/Los_Angeles" },
      end: { dateTime: newEndLocal, timeZone: "America/Los_Angeles" },
    },
  });
  console.log(`\n✓ PATCHed Google occurrence to Mon Jun 15 1:00 PM (sendUpdates:${NOTIFY ? "all" : "none"}${NOTIFY ? "" : " — attendees NOT emailed"}).`);

  // 5) Verify parity.
  const after = await getGoogleThisWeek(cal, googleMaster);
  console.log(`Verify Google now: ${stripOffset(after?.start?.dateTime)} → ${stripOffset(after?.end?.dateTime)}  status=${after?.status}`);
  line();
  console.log("Done.");
})().catch((err) => {
  console.error("\nREPAIR FAILED:", err.message);
  process.exit(1);
});
