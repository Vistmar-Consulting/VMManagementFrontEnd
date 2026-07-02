// dev/diag-business-dev-reschedule.mjs
//
// READ-ONLY diagnostic. Dumps the current Graph + Google state of the
// "VM - Weekly Business Dev" weekly-Friday series around the Jun 11/12/15/19
// window, so we can see exactly how the Jun 12 occurrence diverged after the
// Jun 11 -> Jun 12 single-instance reschedule (the move landed an exception
// onto the series' own natural Friday slot).
//
// Touches nothing. No writes, no patches, no cancels. Pure GET.
//
// Run:  node --env-file=.env.local dev/diag-business-dev-reschedule.mjs
//   (env must contain AZURE_KV_URL / AZURE_KV_TENANT_ID / AZURE_KV_CLIENT_ID
//    / AZURE_KV_CLIENT_SECRET — the same vars the deployed function reads.
//    Get them with `vercel env pull .env.local` if you don't have them yet.)

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

const TITLE_MATCH = "Weekly Business Dev";
const WINDOW_START = "2026-06-06";
const WINDOW_END = "2026-06-22";
const IMPERSONATE = "meetings@vistamarconsulting.com";

function line() { console.log("─".repeat(72)); }

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

async function findMasters(cal) {
  // singleEvents:true expands the series; any expanded instance carries the
  // master ids we need (recurringEventId + the m365EventId extended prop).
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
    q: TITLE_MATCH,
  });
  const items = (res.data.items || []).filter((e) =>
    (e.summary || "").includes(TITLE_MATCH)
  );
  console.log(`Google singleEvents matches in window: ${items.length}`);
  for (const e of items) {
    console.log(
      `  • ${e.start?.dateTime || e.start?.date}  status=${e.status}  ` +
        `id=${e.id}  recurringEventId=${e.recurringEventId || "(none)"}`
    );
  }
  const withMaster = items.find((e) => e.recurringEventId);
  const googleMaster = withMaster?.recurringEventId || null;
  const graphMaster =
    items.map((e) => e.extendedProperties?.private?.m365EventId).find(Boolean) || null;
  return { googleMaster, graphMaster, sampleInstanceId: items[0]?.id || null };
}

async function dumpGoogleInstances(cal, googleMaster) {
  if (!googleMaster) { console.log("No Google master id — skipping instance dump."); return; }
  // showDeleted so cancelled/moved exceptions are visible too.
  const res = await cal.events.instances({
    calendarId: "primary",
    eventId: googleMaster,
    timeMin: `${WINDOW_START}T00:00:00Z`,
    timeMax: `${WINDOW_END}T23:59:59Z`,
    showDeleted: true,
    maxResults: 50,
  });
  const items = res.data.items || [];
  console.log(`Google instances of master ${googleMaster}: ${items.length}`);
  for (const e of items) {
    console.log(
      `  • ${e.start?.dateTime || e.start?.date || "(no start)"}  ` +
        `status=${e.status}  originalStart=${e.originalStartTime?.dateTime || e.originalStartTime?.date || "-"}  id=${e.id}`
    );
  }
}

// ── Graph ──

async function graphToken() {
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function graphGet(token, userId, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph GET ${path} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

async function dumpGraph(graphMaster) {
  if (!graphMaster) { console.log("No Graph master id (m365EventId) found — skipping Graph dump."); return; }
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();

  // 1) The series master itself — recurrence pattern + type.
  const master = await graphGet(
    token,
    hostUserId,
    `/calendar/events/${graphMaster}?$select=id,subject,type,start,end,recurrence`
  );
  console.log(`Graph master: subject="${master.subject}" type=${master.type}`);
  console.log(`  recurrence: ${JSON.stringify(master.recurrence?.pattern || null)}`);
  console.log(`  range:      ${JSON.stringify(master.recurrence?.range || null)}`);

  // 2) Instances expansion over the window — what reschedule.js / cancel.js
  //    actually see via findInstanceByDate. This is the crux: which dates
  //    return an occurrence.
  const inst = await graphGet(
    token,
    hostUserId,
    `/calendar/events/${graphMaster}/instances?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59&$select=id,type,start,end,isCancelled,seriesMasterId`
  );
  const vals = inst.value || [];
  console.log(`Graph /instances over window: ${vals.length}`);
  for (const e of vals) {
    console.log(
      `  • ${e.start?.dateTime} (${e.start?.timeZone})  type=${e.type}  isCancelled=${e.isCancelled}  id=${e.id}`
    );
  }

  // 3) calendarView over the same window — catches DETACHED occurrences that
  //    /instances drops (a moved-then-orphaned exception shows here but not
  //    above). Filter to the same subject so we see strays.
  const cv = await graphGet(
    token,
    hostUserId,
    `/calendarView?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59&$select=id,subject,type,start,isCancelled,seriesMasterId&$top=100`
  );
  const strays = (cv.value || []).filter((e) => (e.subject || "").includes(TITLE_MATCH));
  console.log(`Graph /calendarView matches "${TITLE_MATCH}": ${strays.length}`);
  for (const e of strays) {
    console.log(
      `  • ${e.start?.dateTime}  type=${e.type}  isCancelled=${e.isCancelled}  ` +
        `seriesMasterId=${e.seriesMasterId || "(none/detached)"}  id=${e.id}`
    );
  }
}

// ── main ──

(async () => {
  line();
  console.log(`Diagnostic: "${TITLE_MATCH}"  window ${WINDOW_START}..${WINDOW_END}  (READ-ONLY)`);
  line();
  const cal = await googleClient();
  const { googleMaster, graphMaster } = await findMasters(cal);
  console.log(`\nResolved masters:\n  googleMaster = ${googleMaster}\n  graphMaster  = ${graphMaster}`);
  line();
  console.log("GOOGLE");
  await dumpGoogleInstances(cal, googleMaster);
  line();
  console.log("GRAPH");
  await dumpGraph(graphMaster);
  line();
  console.log("Done. Nothing was modified.");
})().catch((err) => {
  console.error("\nDIAGNOSTIC FAILED:", err.message);
  process.exit(1);
});
