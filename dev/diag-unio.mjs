// dev/diag-unio.mjs
//
// READ-ONLY landscape of every "Unio" recurring meeting the app could see,
// across ALL calendars the FE meeting-list aggregates (list.js DEFAULT_SUBJECTS:
// meetings@, trobinson@ [Tate — organizes Unio Weekly], ctucksherman@ [Cedric]).
//
// The FE reads the GOOGLE mirror of each subject and keys occurrence/reschedule
// on the Google series id (recurringEventId). So: any Unio series that exists
// on GOOGLE is FE-visible; a Unio series that exists only on Graph is NOT.
//
// For each Google series we print title / next / count / organizer / attendees
// / recurringEventId (== the FE's series_id) / m365EventId. Then the meetings@
// Graph side, to show the Graph-only ghosts for contrast.
//
// Touches nothing. No writes. Pure GET.
//
// Run:  node --env-file=.env.vercel dev/diag-unio.mjs

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";

const SUBJECTS = [
  "meetings@vistamarconsulting.com",
  "trobinson@vistamarconsulting.com",
  "ctucksherman@vistamarconsulting.com",
];
const WINDOW_START = new Date().toISOString().slice(0, 10);
const WINDOW_END = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
function line() { console.log("─".repeat(78)); }
function isUnio(s) { return (s || "").toLowerCase().includes("unio"); }

async function googleClient(subject) {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email, key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"], subject,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

async function googleUnioSeries(subject) {
  const cal = await googleClient(subject);
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
    singleEvents: true, orderBy: "startTime", maxResults: 2500,
  });
  const items = (res.data.items || []).filter(
    (e) => e.recurringEventId && e.status !== "cancelled" && e.start?.dateTime && isUnio(e.summary)
  );
  const byMaster = new Map();
  for (const e of items) {
    const k = e.recurringEventId;
    if (!byMaster.has(k)) {
      byMaster.set(k, {
        title: e.summary, organizer: e.organizer?.email || "-",
        m365: e.extendedProperties?.private?.m365EventId || null,
        orgId: e.extendedProperties?.private?.orgId || null,
        attendees: (e.attendees || []).map((a) => a.email),
        occ: [],
      });
    }
    byMaster.get(k).occ.push(e.start.dateTime.slice(0, 16));
  }
  return byMaster;
}

async function graphToken() {
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Graph auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function graphUnioSeries() {
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${hostUserId}/calendarView` +
    `?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
    `&$select=id,subject,seriesMasterId,start,isCancelled&$top=999`,
    { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Pacific Standard Time"' } }
  );
  if (!res.ok) throw new Error(`Graph calendarView -> ${res.status}`);
  const data = await res.json();
  const items = (data.value || []).filter((e) => e.seriesMasterId && !e.isCancelled && e.start?.dateTime && isUnio(e.subject));
  const byMaster = new Map();
  for (const e of items) {
    const k = e.seriesMasterId;
    if (!byMaster.has(k)) byMaster.set(k, { title: e.subject, occ: [] });
    byMaster.get(k).occ.push(e.start.dateTime.slice(0, 16));
  }
  return byMaster;
}

(async () => {
  line();
  console.log(`UNIO LANDSCAPE  window ${WINDOW_START}..${WINDOW_END}  (READ-ONLY)`);
  line();

  const googleM365 = new Set();
  console.log(`\n■ GOOGLE (what the FE reads / attaches to agendas)`);
  for (const subject of SUBJECTS) {
    let series;
    try { series = await googleUnioSeries(subject); }
    catch (e) { console.log(`\n  ${subject}: (read failed: ${e.message})`); continue; }
    console.log(`\n  ── calendar: ${subject} — ${series.size} Unio series`);
    for (const [mid, v] of series) {
      const dates = v.occ.sort();
      if (v.m365) googleM365.add(v.m365);
      console.log(`     • "${v.title}"  next=${dates[0]}  occ=${dates.length}  organizer=${v.organizer}  orgId=${v.orgId || "-"}`);
      console.log(`        recurringEventId (FE series_id): ${mid}`);
      console.log(`        m365EventId: ${v.m365 || "(none)"}`);
      console.log(`        attendees: ${v.attendees.join(", ") || "(none)"}`);
    }
  }

  console.log(`\n■ GRAPH meetings@ (canonical). Flag ⚠ = Graph-only (NOT FE-visible)`);
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const gx = await graphUnioSeries();
  for (const [mid, v] of gx) {
    const dates = v.occ.sort();
    const mirrored = googleM365.has(mid);
    console.log(`  ${mirrored ? "✓" : "⚠"} "${v.title}"  next=${dates[0]}  occ=${dates.length}  ${mirrored ? "(mirrored to Google)" : "(GRAPH-ONLY — ghost)"}`);
    // Full details so we can judge safe-to-delete (client attendees? origin?).
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${hostUserId}/events/${mid}` +
      `?$select=subject,organizer,createdDateTime,attendees`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const m = await res.json();
      const att = (m.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean);
      const externals = att.filter((e) => !e.toLowerCase().endsWith("@vistamarconsulting.com"));
      console.log(`      created=${m.createdDateTime}  organizer=${m.organizer?.emailAddress?.address}`);
      console.log(`      attendees (${att.length}): ${att.join(", ") || "(none)"}`);
      console.log(`      external/client attendees: ${externals.length ? externals.join(", ") : "NONE (internal-only)"}`);
    }
  }

  line();
  console.log("Done. Nothing was modified.");
  line();
})().catch((err) => { console.error("\nDIAG FAILED:", err.message); process.exit(1); });
