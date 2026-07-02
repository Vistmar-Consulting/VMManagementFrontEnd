// dev/bmd-cleanup.mjs
//
// One-off BMD (Bryn Mawr Dermatology) reconciliation. Four discrete steps,
// each independently gated. DRY-RUN by default; pass --apply to execute.
//
//   1) reschedule       Move the live "BMD - Biweekly" (Google 6295 / Graph
//                       U3mG6) Jun 18 occurrence → Thu Jun 25, 11:30 AM PT
//                       (60 min preserved), single instance, notify all.
//   2) cancel-marketing Cancel the old "BMD Marketing" Google-only series
//                       (boc4jg, organized by trobinson@), notify all 7
//                       attendees, then hard-delete its orphan Firestore
//                       agenda + calendar_series docs.
//   3) cancel-ghost     Cancel the orphan 8:30 AM "BMD - Biweekly" Graph-only
//                       series (m365 FWvh9, no Google mirror), 2 internal
//                       attendees.
//   4) remove-single    Remove the one-off Apr 30 "BMD - Marketing" leftover
//                       (Google v2e7 / Graph Q5Kde) + its Firestore docs.
//
// Run (dry-run, all):  node --env-file=.env.vercel dev/bmd-cleanup.mjs
// Run (one step):      node --env-file=.env.vercel dev/bmd-cleanup.mjs --step=reschedule
// Apply:               node --env-file=.env.vercel dev/bmd-cleanup.mjs --step=reschedule --apply
//
// Firestore writes use the gcloud user token (project-owner via Cloud IAM,
// bypasses security rules). Run `gcloud auth login` first if it errors.

import { execSync } from "node:child_process";
import { google } from "googleapis";
import { getGoogleCredentials, getTeamsCredentials } from "../api/meetings/_lib/keyvault.js";
import {
  rescheduleEvent as graphReschedule,
  cancelEvent as graphCancel,
} from "../api/meetings/_lib/graph-events.js";
import {
  rescheduleEvent as googleReschedule,
  cancelEvent as googleCancel,
  getM365EventId,
} from "../api/meetings/_lib/google-calendar.js";

const APPLY = process.argv.includes("--apply");
const stepArg = (process.argv.find((a) => a.startsWith("--step=")) || "--step=all").split("=")[1];
const STEPS = stepArg === "all"
  ? ["reschedule", "cancel-marketing", "cancel-ghost", "remove-single"]
  : [stepArg];

const TZ = "America/Los_Angeles";
function line() { console.log("─".repeat(72)); }
function tag() { return APPLY ? "APPLY" : "DRY-RUN"; }

// ── Google (per-subject impersonation; the _lib helpers lock to meetings@) ──
let _creds;
async function googleClientAs(subject) {
  _creds ||= await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: _creds.client_email, key: _creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"], subject,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

// ── Graph raw (for a silent DELETE on the past single's Graph copy) ──
async function graphToken() {
  const { clientId, clientSecret, tenantId } = await getTeamsCredentials();
  const r = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!r.ok) throw new Error(`Graph auth failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function graphDeleteSilent(eventId) {
  const token = await graphToken();
  const { hostUserId } = await getTeamsCredentials();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${hostUserId}/calendar/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok && r.status !== 404) throw new Error(`Graph DELETE -> ${r.status} ${await r.text()}`);
  return r.status;
}

// ── Firestore REST (gcloud user token) ──
let _fsToken;
function fsToken() {
  if (_fsToken) return _fsToken;
  try { _fsToken = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim(); }
  catch (e) { console.error("gcloud token failed — run `gcloud auth login`.\n", e.stderr || e.message); process.exit(1); }
  return _fsToken;
}
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = "projects/management-db9eb/databases/(default)/documents";
async function fsList(parentResource, sub) {
  const r = await fetch(`${FS_ROOT}/${parentResource}/${sub}?pageSize=300`,
    { headers: { Authorization: `Bearer ${fsToken()}` } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`FS list ${sub} -> ${r.status} ${await r.text()}`);
  return ((await r.json()).documents || []).map((d) => d.name); // full resource names
}
async function fsDelete(resourceName) {
  if (!APPLY) { console.log(`    [dry] would delete ${resourceName.replace(FS_DB + "/", "")}`); return; }
  const r = await fetch(`${FS_ROOT}/${resourceName}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${fsToken()}` } });
  if (!r.ok && r.status !== 404) throw new Error(`FS delete -> ${r.status} ${await r.text()}`);
  console.log(`    deleted ${resourceName.replace(FS_DB + "/", "")}`);
}
// Walk an agenda's subcollections (topics → talkingPoints/notes, openFloor)
// then the doc itself — mirrors CancelAgendaDialog so nothing leaks as orphans.
async function fsDeleteAgendaDeep(agendaId) {
  const agendaName = `${FS_DB}/agendas/${agendaId}`;
  const topics = await fsList(agendaName, "topics");
  for (const topic of topics) {
    for (const tp of await fsList(topic, "talkingPoints")) await fsDelete(tp);
    for (const n of await fsList(topic, "notes")) await fsDelete(n);
    await fsDelete(topic);
  }
  for (const of of await fsList(agendaName, "openFloor")) await fsDelete(of);
  await fsDelete(agendaName);
}
async function fsDeleteDoc(coll, id) { await fsDelete(`${FS_DB}/${coll}/${id}`); }

// ── Step 1: reschedule BMD - Biweekly Jun 18 → Jun 25 11:30 (60 min) ──
async function stepReschedule() {
  line(); console.log(`STEP 1 — reschedule "BMD - Biweekly" Jun 18 → Jun 25 11:30 (${tag()})`); line();
  const GOOGLE_MASTER = "6295h9p4mu514u7fkqm0tgmr68_R20260521T183000";
  const ORIGINAL_DATE = "2026-06-18";
  const NEW_START = "2026-06-25T11:30:00";
  const NEW_END = "2026-06-25T12:30:00";
  const m365 = await getM365EventId(GOOGLE_MASTER);
  console.log(`  google master : ${GOOGLE_MASTER}`);
  console.log(`  graph m365    : ${m365 ? m365.slice(0, 32) + "…" : "(none)"}`);
  console.log(`  move          : instance ${ORIGINAL_DATE} → ${NEW_START} (${TZ}), notify all`);
  if (!m365) throw new Error("No m365 binding on the Google master — aborting.");
  if (!APPLY) { console.log("  [dry] would PATCH Graph instance, then Google instance (sendUpdates:all)."); return; }
  await graphReschedule({ eventId: m365, mode: "instance", originalDate: ORIGINAL_DATE,
    newStartDateTime: NEW_START, newEndDateTime: NEW_END, timezone: TZ });
  console.log("  ✓ Graph instance patched (canonical).");
  await googleReschedule({ eventId: GOOGLE_MASTER, mode: "instance", originalDate: ORIGINAL_DATE,
    newStartDateTime: NEW_START, newEndDateTime: NEW_END, timezone: TZ });
  console.log("  ✓ Google instance patched (sendUpdates:all → attendees notified).");
}

// ── Step 2: cancel BMD Marketing (boc4jg, Tate-organized) + Firestore cleanup ──
async function stepCancelMarketing() {
  line(); console.log(`STEP 2 — cancel old "BMD Marketing" series + remove orphan docs (${tag()})`); line();
  const ORGANIZER = "trobinson@vistamarconsulting.com";
  // Google masters in the boc4jg split-chain. Notify on the future-bearing one;
  // the two past-only masters are deleted silently.
  const masters = [
    { id: "boc4jg4q1l4bk3cadeoklcg02v_R20260604T183000", sendUpdates: "all",  note: "future-bearing → notify 7 attendees" },
    { id: "boc4jg4q1l4bk3cadeoklcg02v_R20260521T183000", sendUpdates: "none", note: "past-only" },
    { id: "boc4jg4q1l4bk3cadeoklcg02v",                  sendUpdates: "none", note: "past-only (root)" },
  ];
  const cal = await googleClientAs(ORGANIZER);
  for (const m of masters) {
    console.log(`  delete Google master ${m.id}  sendUpdates=${m.sendUpdates}  (${m.note})`);
    if (!APPLY) continue;
    try {
      await cal.events.delete({ calendarId: "primary", eventId: m.id, sendUpdates: m.sendUpdates });
      console.log(`    ✓ deleted`);
    } catch (e) {
      if (e.code === 404 || e.code === 410) console.log(`    · already gone (${e.code})`);
      else throw e;
    }
  }
  console.log("  Firestore orphan docs:");
  for (const id of ["boc4jg4q1l4bk3cadeoklcg02v", "boc4jg4q1l4bk3cadeoklcg02v_R20260521T183000", "boc4jg4q1l4bk3cadeoklcg02v_R20260604T183000"]) {
    await fsDeleteAgendaDeep(id);
    await fsDeleteDoc("calendar_series", id);
  }
}

// ── Step 3: cancel the 8:30 Graph-only ghost ──
async function stepCancelGhost() {
  line(); console.log(`STEP 3 — cancel orphan 8:30 AM "BMD - Biweekly" Graph-only series (${tag()})`); line();
  const GHOST = "AAMkAGRjMThkZDVmLThiYmMtNGM5MC04ZTdhLWE4NzJmMTk3YmVhOQBGAAAAAABDCg3PMGN9TqJf7wYBjZ7PBwBiZdk8S6fNSb5NJ286B1zXAAAAAAENAABiZdk8S6fNSb5NJ286B1zXAAAFWvh9AAA=";
  console.log(`  graph series master: …FWvh9AAA=  (organizer meetings@, 2 internal attendees)`);
  if (!APPLY) { console.log("  [dry] would POST /cancel on the Graph series master."); return; }
  await graphCancel({ eventId: GHOST, mode: "series" });
  console.log("  ✓ Graph series cancelled.");
}

// ── Step 4: remove the Apr 30 single "BMD - Marketing" leftover ──
async function stepRemoveSingle() {
  line(); console.log(`STEP 4 — remove past one-off "BMD - Marketing" (Apr 30) + docs (${tag()})`); line();
  const GOOGLE_ID = "v2e7hpoclo8teiegpekijnlags";
  const GRAPH_ID = "AAMkAGRjMThkZDVmLThiYmMtNGM5MC04ZTdhLWE4NzJmMTk3YmVhOQBGAAAAAABDCg3PMGN9TqJf7wYBjZ7PBwBiZdk8S6fNSb5NJ286B1zXAAAAAAENAABiZdk8S6fNSb5NJ286B1zXAAAQ5KdeAAA=";
  console.log(`  google ${GOOGLE_ID} + graph …Q5KdeAAA=  → silent delete (past event, no emails)`);
  if (APPLY) {
    await googleCancel({ eventId: GOOGLE_ID, mode: "series", sendUpdates: "none" });
    console.log("  ✓ Google copy deleted (silent).");
    const st = await graphDeleteSilent(GRAPH_ID);
    console.log(`  ✓ Graph copy deleted (silent, status ${st}).`);
  } else {
    console.log("  [dry] would delete Google + Graph copies silently.");
  }
  console.log("  Firestore docs:");
  await fsDeleteAgendaDeep(GOOGLE_ID);
  await fsDeleteDoc("calendar_series", GOOGLE_ID);
}

const RUNNERS = {
  "reschedule": stepReschedule,
  "cancel-marketing": stepCancelMarketing,
  "cancel-ghost": stepCancelGhost,
  "remove-single": stepRemoveSingle,
};

(async () => {
  line(); console.log(`BMD cleanup — steps: [${STEPS.join(", ")}]  mode: ${tag()}`);
  for (const s of STEPS) {
    const fn = RUNNERS[s];
    if (!fn) { console.error(`Unknown step: ${s}`); process.exit(1); }
    await fn();
  }
  line(); console.log(APPLY ? "Done." : "DRY-RUN complete — re-run with --apply to execute.");
})().catch((err) => { console.error("\nFAILED:", err.message); process.exit(1); });
