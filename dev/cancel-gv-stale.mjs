// dev/cancel-gv-stale.mjs
//
// One-off cleanup: cancel the STALE, Graph-only "GV - Biweekly" (plain-hyphen)
// series — the Apr-8 internal-only duplicate offset one week from the real
// app-managed "GV – Biweekly" (en-dash) series. Surfaced by
// audit-recurring-meetings.mjs + diag-gv-fork.mjs.
//
// Uses the app's own cancelEvent(series) → POST /cancel, which fans a proper
// cancellation .ics to the 2 internal attendees so it clears off their
// calendars (a silent DELETE would leave orphaned holds).
//
// SAFETY: dry-run by default — prints the target + the two guard checks and
// exits. Pass --apply to actually cancel. Two guards MUST pass before apply:
//   G1: NO external (non-@vistamarconsulting.com) attendees  → never nuke a
//       client-bearing series.
//   G2: target id is NOT present in the Google mirror         → only ever the
//       Graph-only ghost, never the app-managed live series.
//
// Run (dry-run):  node --env-file=.env.vercel dev/cancel-gv-stale.mjs
// Run (apply):    node --env-file=.env.vercel dev/cancel-gv-stale.mjs --apply

import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";
import { cancelEvent } from "../api/meetings/_lib/graph-events.js";

const APPLY = process.argv.includes("--apply");
const IMPERSONATE = "meetings@vistamarconsulting.com";
const VM_SUFFIX = "@vistamarconsulting.com";

// The stale master, from diag-gv-fork.mjs (created 2026-04-08, next Jul 8,
// attendees seo@ + adeemer@ only, NOT mirrored to Google).
const STALE_MASTER_ID =
  "AAMkAGRjMThkZDVmLThiYmMtNGM5MC04ZTdhLWE4NzJmMTk3YmVhOQBGAAAAAABDCg3PMGN9TqJf7wYBjZ7PBwBiZdk8S6fNSb5NJ286B1zXAAAAAAENAABiZdk8S6fNSb5NJ286B1zXAAAAH5XlAAA=";

const WINDOW_START = new Date().toISOString().slice(0, 10);
const WINDOW_END = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
function line() { console.log("─".repeat(76)); }

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

// Google mirror m365 ids for any GV event in the window (Guard G2).
async function googleMirrorGvM365Ids() {
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
    if ((e.summary || "").toLowerCase().includes("gv")) {
      const m = e.extendedProperties?.private?.m365EventId;
      if (m) ids.add(m);
    }
  }
  return ids;
}

(async () => {
  line();
  console.log(`CANCEL STALE GV SERIES  —  ${APPLY ? "APPLY" : "DRY-RUN (no changes)"}`);
  line();

  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();

  // Fetch target details.
  const m = await graphGet(
    token, hostUserId,
    `/events/${STALE_MASTER_ID}?$select=id,subject,organizer,createdDateTime,attendees,isCancelled`
  );
  const att = m.attendees || [];
  console.log(`TARGET  "${m.subject}"`);
  console.log(`  created   : ${m.createdDateTime}`);
  console.log(`  organizer : ${m.organizer?.emailAddress?.address}`);
  console.log(`  cancelled?: ${m.isCancelled}`);
  console.log(`  attendees (${att.length}):`);
  for (const a of att) console.log(`     - ${a.emailAddress?.address}`);

  // ── Guards ──
  const externals = att
    .map((a) => (a.emailAddress?.address || "").toLowerCase())
    .filter((e) => e && !e.endsWith(VM_SUFFIX));
  const mirrorIds = await googleMirrorGvM365Ids();
  const isMirrored = mirrorIds.has(STALE_MASTER_ID);

  const g1 = externals.length === 0;
  const g2 = !isMirrored;
  console.log(`\nGUARDS`);
  console.log(`  G1 no external/client attendees : ${g1 ? "PASS" : `FAIL → ${externals.join(", ")}`}`);
  console.log(`  G2 not mirrored to Google (ghost): ${g2 ? "PASS" : "FAIL → this id IS app-managed, refusing"}`);

  if (!g1 || !g2) {
    console.log(`\n✋ ABORT — a safety guard failed. Nothing cancelled.`);
    process.exit(1);
  }

  if (!APPLY) {
    line();
    console.log(`Guards pass. DRY-RUN only — nothing cancelled.`);
    console.log(`Re-run with --apply to cancel and notify the ${att.length} internal attendee(s).`);
    line();
    return;
  }

  console.log(`\nGuards pass. Cancelling series (sends cancellation .ics to attendees)…`);
  await cancelEvent({ eventId: STALE_MASTER_ID, mode: "series" });

  // Verify it's gone from the forward window.
  const check = await graphGet(
    token, hostUserId,
    `/calendarView?startDateTime=${WINDOW_START}T00:00:00&endDateTime=${WINDOW_END}T23:59:59` +
    `&$select=id,subject,seriesMasterId&$top=999`
  );
  const still = (check.value || []).filter((e) => e.seriesMasterId === STALE_MASTER_ID).length;
  line();
  console.log(still === 0
    ? `✓ Done. Stale GV series cancelled — 0 remaining occurrences in window.`
    : `⚠ Cancel sent but ${still} occurrence(s) still visible (may lag; re-check shortly).`);
  line();
})().catch((err) => {
  console.error("\nCANCEL FAILED:", err.message);
  process.exit(1);
});
