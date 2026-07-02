// dev/cancel-stale-series.mjs
//
// Generalized cleanup for a STALE, Graph-only recurring series on the
// meetings@ mailbox (the Apr-8 internal-only placeholders: GV/Unio ghosts).
// Cancels via the app's cancelEvent(series) → POST /cancel, which fans a
// proper cancellation .ics so the meeting clears off attendees' calendars.
//
// Two guards MUST pass before apply (refuses otherwise):
//   G1: NO external (non-@vistamarconsulting.com) attendees → never a client meeting.
//   G2: target id is NOT present in the Google mirror        → only ever a ghost.
//
// Usage:
//   node --env-file=.env.vercel dev/cancel-stale-series.mjs <masterId>            # dry-run
//   node --env-file=.env.vercel dev/cancel-stale-series.mjs <masterId> --apply    # cancel

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";
import { cancelEvent } from "../api/meetings/_lib/graph-events.js";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const MASTER_ID = ARGS.find((a) => !a.startsWith("--"));
const IMPERSONATE = "meetings@vistamarconsulting.com";
const VM_SUFFIX = "@vistamarconsulting.com";
const WINDOW_START = new Date().toISOString().slice(0, 10);
const WINDOW_END = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
function line() { console.log("─".repeat(78)); }

if (!MASTER_ID) { console.error("Usage: cancel-stale-series.mjs <masterId> [--apply]"); process.exit(1); }

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
async function graphGet(token, hostUserId, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${hostUserId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="Pacific Standard Time"' },
  });
  if (!res.ok) throw new Error(`Graph GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
// All m365 ids present in the Google mirror across the FE's aggregated calendars.
async function googleMirrorM365Ids() {
  const creds = await getGoogleCredentials();
  const ids = new Set();
  for (const subject of [IMPERSONATE, "trobinson@vistamarconsulting.com", "ctucksherman@vistamarconsulting.com"]) {
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar"], subject });
    await auth.authorize();
    const cal = google.calendar({ version: "v3", auth });
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: new Date(`${WINDOW_START}T00:00:00Z`).toISOString(),
      timeMax: new Date(`${WINDOW_END}T23:59:59Z`).toISOString(),
      singleEvents: true, maxResults: 2500,
    });
    for (const e of res.data.items || []) {
      const m = e.extendedProperties?.private?.m365EventId;
      if (m) ids.add(m);
    }
  }
  return ids;
}

(async () => {
  line();
  console.log(`CANCEL STALE SERIES  —  ${APPLY ? "APPLY" : "DRY-RUN (no changes)"}`);
  console.log(`master: ${MASTER_ID}`);
  line();
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const m = await graphGet(token, hostUserId,
    `/events/${MASTER_ID}?$select=id,subject,organizer,createdDateTime,attendees,isCancelled`);
  const att = m.attendees || [];
  console.log(`TARGET  "${m.subject}"  created=${m.createdDateTime}  cancelled?=${m.isCancelled}`);
  console.log(`  organizer: ${m.organizer?.emailAddress?.address}`);
  console.log(`  attendees (${att.length}): ${att.map((a) => a.emailAddress?.address).join(", ")}`);

  const externals = att.map((a) => (a.emailAddress?.address || "").toLowerCase()).filter((e) => e && !e.endsWith(VM_SUFFIX));
  const mirrorIds = await googleMirrorM365Ids();
  const g1 = externals.length === 0;
  const g2 = !mirrorIds.has(MASTER_ID);
  console.log(`\nGUARDS  G1 no-external: ${g1 ? "PASS" : `FAIL → ${externals.join(", ")}`}   G2 not-mirrored: ${g2 ? "PASS" : "FAIL"}`);
  if (!g1 || !g2) { console.log(`\n✋ ABORT — guard failed. Nothing cancelled.`); process.exit(1); }

  if (!APPLY) { console.log(`\nDRY-RUN only. Re-run with --apply to cancel + notify ${att.length} internal attendee(s).`); line(); return; }

  console.log(`\nCancelling…`);
  await cancelEvent({ eventId: MASTER_ID, mode: "series" });
  const check = await graphGet(token, hostUserId,
    `/calendarView?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59&$select=id,seriesMasterId&$top=999`);
  const still = (check.value || []).filter((e) => e.seriesMasterId === MASTER_ID).length;
  console.log(still === 0 ? `✓ Done — 0 remaining occurrences.` : `⚠ Cancel sent; ${still} still visible (may lag).`);
  line();
})().catch((err) => { console.error("\nFAILED:", err.message); process.exit(1); });
