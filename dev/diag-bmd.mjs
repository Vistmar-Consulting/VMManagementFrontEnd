// dev/diag-bmd.mjs
//
// READ-ONLY diagnostic for the Bryn Mawr Dermatology meeting(s). Dumps the
// Google (invite-fan mirror) + Graph (canonical) state for any event whose
// title contains "BMD" or "Bryn Mawr", over a window covering last week's
// Thursday (Jun 18) through early July, so we can see:
//   - how many distinct series exist (one "BMD – Biweekly" vs a stale
//     "BMD Marketing"),
//   - their master ids (Google recurringEventId + Graph m365EventId),
//   - each occurrence's date/status across the window.
//
// Touches nothing. No writes, no patches, no cancels. Pure GET.
//
// Run:  node --env-file=.env.vercel dev/diag-bmd.mjs

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

const MATCHERS = ["BMD", "Bryn Mawr", "Marketing", "Derm"];
const WINDOW_START = "2026-05-01";
const WINDOW_END = "2026-09-01";
const SUBJECTS = [
  "meetings@vistamarconsulting.com",
  "trobinson@vistamarconsulting.com",
  "ctucksherman@vistamarconsulting.com",
];

function line() { console.log("─".repeat(72)); }
function matches(s) { return MATCHERS.some((m) => (s || "").toLowerCase().includes(m.toLowerCase())); }

async function googleClient(subject) {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

async function googleSweep(cal) {
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  const items = (res.data.items || []).filter((e) => matches(e.summary));
  console.log(`GOOGLE singleEvents matches in window: ${items.length}`);
  // Group by master so we can see distinct series.
  const byMaster = new Map();
  for (const e of items) {
    const masterKey = e.recurringEventId || `(single:${e.id})`;
    if (!byMaster.has(masterKey)) byMaster.set(masterKey, []);
    byMaster.get(masterKey).push(e);
  }
  for (const [masterKey, evs] of byMaster) {
    const sample = evs[0];
    console.log(`\n  ── series/master: ${masterKey}`);
    console.log(`     summary: "${sample.summary}"`);
    console.log(`     m365EventId (extProp): ${sample.extendedProperties?.private?.m365EventId || "(none)"}`);
    for (const e of evs) {
      console.log(
        `       • ${e.start?.dateTime || e.start?.date}  status=${e.status}  ` +
          `recurringEventId=${e.recurringEventId || "(none)"}  id=${e.id}`
      );
    }
  }
  return byMaster;
}

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

async function graphSweep() {
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${hostUserId}/calendarView` +
      `?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
      `&$select=id,subject,type,start,end,isCancelled,seriesMasterId&$top=200`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="Pacific Standard Time"',
      },
    }
  );
  if (!res.ok) throw new Error(`Graph calendarView GET -> ${res.status} ${await res.text()}`);
  const data = await res.json();
  const vals = (data.value || []).filter((e) => matches(e.subject));
  console.log(`GRAPH calendarView matches in window: ${vals.length}`);
  for (const e of vals) {
    console.log(
      `  • ${e.start?.dateTime} (${e.start?.timeZone})  subject="${e.subject}"  type=${e.type}  ` +
        `isCancelled=${e.isCancelled}  seriesMasterId=${e.seriesMasterId || "(none)"}  id=${e.id}`
    );
  }
}

(async () => {
  line();
  console.log(`Diagnostic: BMD / Bryn Mawr  window ${WINDOW_START}..${WINDOW_END}  (READ-ONLY)`);
  line();
  for (const subject of SUBJECTS) {
    console.log(`\n### GOOGLE calendar of ${subject}`);
    const cal = await googleClient(subject);
    await googleSweep(cal);
  }
  line();
  await graphSweep();
  line();
  console.log("Done. Nothing was modified.");
})().catch((err) => {
  console.error("\nDIAGNOSTIC FAILED:", err.message);
  process.exit(1);
});
