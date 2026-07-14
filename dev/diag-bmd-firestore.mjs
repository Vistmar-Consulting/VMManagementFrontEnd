// dev/diag-bmd-firestore.mjs
//
// READ-ONLY Firestore diagnostic for the BMD (Bryn Mawr Dermatology) blank-agenda
// bug (2026-07-13). Dumps every `agendas` and `calendar_series` doc whose title
// mentions BMD / Bryn Mawr / Content Strategy, with full linkage + content signals
// so we can see which doc holds the real content and which one the UI now lands on.
//
// For each agenda: id, title, calendarSeriesId, googleEventId, graphEventId,
// meetingDatetime, firefliesTitles[], createdAt/updatedAt, and a COUNT of the
// topics + openFloor subcollections (content signal — a blank shadow has 0).
//
// Touches nothing. Pure GET against Firestore REST (gcloud user token, Cloud IAM).
//
// Run:  gcloud auth login   (once)
//       node dev/diag-bmd-firestore.mjs
//
import { execSync } from "node:child_process";

const MATCHERS = ["bmd", "bryn mawr", "content strategy", "derm", "marketing"];
const PROJECT = "management-db9eb";
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = `projects/${PROJECT}/databases/(default)/documents`;

function token() {
  try { return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim(); }
  catch (e) {
    console.error("Could not get gcloud token. Run `gcloud auth login` first.\n", e.stderr || e.message);
    process.exit(1);
  }
}
const T = token();
const H = { Authorization: `Bearer ${T}` };

function matches(s) { return MATCHERS.some((m) => (s || "").toLowerCase().includes(m)); }
function line() { console.log("─".repeat(76)); }

// Unwrap a Firestore REST typed value into a plain JS value.
function unwrap(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("mapValue" in v) {
    const o = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = unwrap(vv);
    return o;
  }
  return JSON.stringify(v);
}

async function listAll(coll) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${FS_ROOT}/${FS_DB}/${coll}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error(`list ${coll} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function countSub(agendaId, sub) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/agendas/${agendaId}/${sub}?pageSize=300`, { headers: H });
  if (r.status === 404) return 0;
  if (!r.ok) throw new Error(`count ${sub} -> ${r.status}`);
  return ((await r.json()).documents || []).length;
}

function idOf(doc) { return doc.name.split("/").pop(); }
function fmtTs(ts) {
  if (!ts) return "(none)";
  const d = new Date(ts);
  return `${ts} (PT ${d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })})`;
}

(async () => {
  line();
  console.log("BMD Firestore diagnostic (READ-ONLY) — agendas + calendar_series");
  line();

  const agendas = await listAll("agendas");
  const series = await listAll("calendar_series");

  const matchAgendas = agendas.filter((d) => matches(unwrap(d.fields?.title)));
  const matchSeries = series.filter((d) => matches(unwrap(d.fields?.title)));

  console.log(`\nTotal agendas: ${agendas.length} | matching: ${matchAgendas.length}`);
  console.log(`Total calendar_series: ${series.length} | matching: ${matchSeries.length}`);

  console.log("\n\n=== MATCHING AGENDAS ===");
  for (const d of matchAgendas) {
    const id = idOf(d);
    const f = d.fields || {};
    const nTopics = await countSub(id, "topics");
    const nOpenFloor = await countSub(id, "openFloor");
    const ff = unwrap(f.firefliesTitles) || [];
    line();
    console.log(`agendas/${id}`);
    console.log(`  title            : ${unwrap(f.title)}`);
    console.log(`  organizationId   : ${unwrap(f.organizationId)}`);
    console.log(`  calendarSeriesId : ${unwrap(f.calendarSeriesId)}`);
    console.log(`  googleEventId    : ${unwrap(f.googleEventId)}`);
    console.log(`  graphEventId     : ${(unwrap(f.graphEventId) || "(none)").slice(0, 44)}${unwrap(f.graphEventId) ? "…" : ""}`);
    console.log(`  iCalUID          : ${unwrap(f.iCalUID)}`);
    console.log(`  meetingDatetime  : ${fmtTs(unwrap(f.meetingDatetime))}`);
    console.log(`  createdAt        : ${fmtTs(unwrap(f.createdAt))}`);
    console.log(`  updatedAt        : ${fmtTs(unwrap(f.updatedAt))}`);
    console.log(`  firefliesTitles  : [${ff.length}] ${JSON.stringify(ff)}`);
    console.log(`  openFloorHtml    : ${unwrap(f.openFloorHtml) ? `${String(unwrap(f.openFloorHtml)).length} chars` : "(empty)"}`);
    console.log(`  >> CONTENT: topics=${nTopics}  openFloor(sub)=${nOpenFloor}`);
  }

  console.log("\n\n=== MATCHING calendar_series ===");
  for (const d of matchSeries) {
    const id = idOf(d);
    const f = d.fields || {};
    line();
    console.log(`calendar_series/${id}`);
    console.log(`  title               : ${unwrap(f.title)}`);
    console.log(`  organizationId      : ${unwrap(f.organizationId)}`);
    console.log(`  googleSeriesEventId : ${unwrap(f.googleSeriesEventId)}`);
    console.log(`  graphSeriesEventId  : ${(unwrap(f.graphSeriesEventId) || "(none)").slice(0, 44)}${unwrap(f.graphSeriesEventId) ? "…" : ""}`);
    console.log(`  iCalUID             : ${unwrap(f.iCalUID)}`);
    console.log(`  createdAt           : ${fmtTs(unwrap(f.createdAt))}`);
    console.log(`  updatedAt           : ${fmtTs(unwrap(f.updatedAt))}`);
  }

  line();
  console.log("Done. Nothing was modified.");
})().catch((e) => { console.error("\nDIAG FAILED:", e.message); process.exit(1); });
