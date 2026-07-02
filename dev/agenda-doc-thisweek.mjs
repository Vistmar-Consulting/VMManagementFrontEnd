// dev/agenda-doc-thisweek.mjs
//
// Read (and optionally fix) the series-level agenda doc for "VM - Weekly
// Business Dev" after the Jun 12 -> Jun 15 calendar repair. Agendas are
// series-level (doc id == Google series id), and reconcileMeetings does NOT
// update meetingDatetime on existing docs — only the RescheduleDialog success
// handler does, which never ran because the reschedules threw. So this doc's
// meetingDatetime may be stale.
//
// Auth: uses your gcloud user token (`gcloud auth print-access-token`) against
// the Firestore REST API. REST goes through Cloud IAM, not Firestore security
// rules, so your project-owner access writes directly. Run `gcloud auth login`
// first if the token call errors.
//
// Read-only:  node dev/agenda-doc-thisweek.mjs
// Apply fix:  node dev/agenda-doc-thisweek.mjs --apply
//   (--apply sets meetingDatetime = Mon Jun 15 2026 1:00 PM PT, duration 60)

import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const PROJECT = "management-db9eb";
const AGENDA_ID = "0k0ph9i2hsjbbmhu1kq7o9evn0"; // == Google series id
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/agendas/${AGENDA_ID}`;

// Target: Mon Jun 15 2026 1:00 PM Pacific (PDT, UTC-7) == 20:00:00Z.
const TARGET_UTC = "2026-06-15T20:00:00Z";
const TARGET_DURATION = 60;

function token() {
  try {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch (e) {
    console.error("Could not get gcloud token. Run `gcloud auth login` first.\n", e.stderr || e.message);
    process.exit(1);
  }
}

function fmt(ts) {
  if (!ts) return "(none)";
  const d = new Date(ts);
  return `${ts}  (Pacific: ${d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })})`;
}

(async () => {
  const t = token();
  const get = await fetch(BASE, { headers: { Authorization: `Bearer ${t}` } });
  if (!get.ok) {
    console.error(`GET failed: ${get.status} ${await get.text()}`);
    process.exit(1);
  }
  const doc = await get.json();
  const f = doc.fields || {};
  const curDt = f.meetingDatetime?.timestampValue || null;
  const curDur = f.durationMinutes?.integerValue ?? f.durationMinutes?.doubleValue ?? null;

  console.log("─".repeat(72));
  console.log(`agendas/${AGENDA_ID}`);
  console.log(`  title           : ${f.title?.stringValue ?? "(none)"}`);
  console.log(`  googleEventId   : ${f.googleEventId?.stringValue ?? "(none)"}`);
  console.log(`  graphEventId    : ${(f.graphEventId?.stringValue ?? "(none)").slice(0, 40)}…`);
  console.log(`  meetingDatetime : ${fmt(curDt)}`);
  console.log(`  durationMinutes : ${curDur}`);
  console.log("─".repeat(72));

  const isStale = curDt !== TARGET_UTC;
  console.log(isStale
    ? `STALE — meetingDatetime is not ${fmt(TARGET_UTC)}`
    : `OK — meetingDatetime already at target (Mon Jun 15 1:00 PM PT).`);

  if (!isStale) return;
  if (!APPLY) {
    console.log(`\nDRY-RUN: re-run with --apply to set meetingDatetime=${TARGET_UTC}, durationMinutes=${TARGET_DURATION}.`);
    return;
  }

  const url = `${BASE}?updateMask.fieldPaths=meetingDatetime&updateMask.fieldPaths=durationMinutes&updateMask.fieldPaths=updatedAt`;
  const body = {
    fields: {
      meetingDatetime: { timestampValue: TARGET_UTC },
      durationMinutes: { integerValue: String(TARGET_DURATION) },
      updatedAt: { timestampValue: new Date().toISOString() },
    },
  };
  const patch = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!patch.ok) {
    console.error(`PATCH failed: ${patch.status} ${await patch.text()}`);
    process.exit(1);
  }
  const after = await patch.json();
  console.log(`\n✓ Updated. meetingDatetime now: ${fmt(after.fields?.meetingDatetime?.timestampValue)}`);
})();
