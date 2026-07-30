// dev/repair-bmd-biweekly-content.mjs
//
// Repair for the 2026-07-13 "BMD - Biweekly is blank / no history" incident.
//
// ROOT CAUSE: the Google mirror of "BMD - Biweekly" split into a new recurrence
// master (_R20260702T183000) at the Jul 2 boundary. Agendas are keyed by Google
// recurrence-master id, so reconcile minted a fresh EMPTY agenda for the new
// master. The app now routes upcoming occurrences (Jul 16+) to that empty doc,
// while the team's real content sits stranded on the previous master's doc.
// (Graph/Outlook is unaffected — one intact series there.)
//
// FIX: copy the durable Firestore content forward from the stranded doc to the
// doc the app now routes to. Firestore bodyHtml/openFloorHtml are canonical; the
// Liveblocks room self-heals from bodyHtml on first open (see agendaRoom.js),
// so no collab-room surgery is needed.
//
//   SRC  (has content) : agendas/6295...tgmr68_R20260521T183000   (4 topics, fireflies history)
//   DEST (empty, live) : agendas/6295...tgmr68_R20260702T183000   (owns Jul 16, 30, Aug 13, 27...)
//
// Copies: topics/* (verbatim, same ids) + firefliesTitles + versions/* (history).
// Does NOT touch: SRC (left intact as archive), or DEST's meeting-binding fields
// (googleEventId/graphEventId/calendarSeriesId/iCalUID/title/organizationId/
// meetingDatetime). openFloorHtml is empty on SRC → skipped.
//
// DRY-RUN default. Aborts if DEST/topics is not empty (never clobbers).
//
// Run (dry):    node dev/repair-bmd-biweekly-content.mjs
// Run (apply):  node dev/repair-bmd-biweekly-content.mjs --apply
//
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const PROJECT = "management-db9eb";
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = `projects/${PROJECT}/databases/(default)/documents`;
const SRC = "6295h9p4mu514u7fkqm0tgmr68_R20260521T183000";
const DEST = "6295h9p4mu514u7fkqm0tgmr68_R20260702T183000";

const T = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const H = { Authorization: `Bearer ${T}` };
const tag = () => (APPLY ? "APPLY" : "DRY-RUN");
const line = () => console.log("─".repeat(76));

function unwrap(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("mapValue" in v) return "(map)";
  return "(?)";
}
async function getDoc(path) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function listDocs(path) {
  const out = [];
  let tok = "";
  do {
    const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?pageSize=300${tok ? `&pageToken=${tok}` : ""}`, { headers: H });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`LIST ${path} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    tok = j.nextPageToken || "";
  } while (tok);
  return out;
}
const idOf = (d) => d.name.split("/").pop();

// createOrOverwrite a doc at an explicit id with the given fields object (verbatim).
async function putDoc(path, fields) {
  if (!APPLY) { console.log(`    [dry] would WRITE ${path}  (${Object.keys(fields).length} fields)`); return; }
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`WRITE ${path} -> ${r.status} ${await r.text()}`);
  console.log(`    ✓ wrote ${path}`);
}
// patch only specific field paths on an existing doc (never full overwrite).
async function patchFields(path, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  if (!APPLY) { console.log(`    [dry] would PATCH ${path}  fields=[${Object.keys(fields).join(", ")}]`); return; }
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?${mask}`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
  console.log(`    ✓ patched ${path} [${Object.keys(fields).join(", ")}]`);
}

(async () => {
  line(); console.log(`BMD - Biweekly content repair  (${tag()})`); line();

  // ── Guards ──
  const src = await getDoc(`agendas/${SRC}`);
  const dest = await getDoc(`agendas/${DEST}`);
  if (!src) throw new Error(`SRC agendas/${SRC} not found — aborting.`);
  if (!dest) throw new Error(`DEST agendas/${DEST} not found — aborting.`);
  if (unwrap(dest.fields?.title) !== "BMD - Biweekly") throw new Error(`DEST title is "${unwrap(dest.fields?.title)}", expected "BMD - Biweekly" — aborting.`);

  const srcTopics = await listDocs(`agendas/${SRC}/topics`);
  const destTopics = await listDocs(`agendas/${DEST}/topics`);
  const srcVersions = await listDocs(`agendas/${SRC}/versions`);
  const destVersions = await listDocs(`agendas/${DEST}/versions`);

  console.log(`SRC  ${SRC}`);
  console.log(`  topics=${srcTopics.length}  versions=${srcVersions.length}  firefliesTitles=${JSON.stringify(unwrap(src.fields?.firefliesTitles) || [])}`);
  console.log(`DEST ${DEST}`);
  console.log(`  topics=${destTopics.length}  versions=${destVersions.length}  firefliesTitles=${JSON.stringify(unwrap(dest.fields?.firefliesTitles) || [])}`);

  if (destTopics.length > 0) throw new Error(`DEST already has ${destTopics.length} topics — refusing to clobber. Manual review needed.`);
  console.log(`\nGuards OK. Plan: copy ${srcTopics.length} topics + ${srcVersions.length} versions + firefliesTitles → DEST.\n`);

  // ── 1) topics (verbatim, same ids) ──
  console.log("STEP 1 — copy topics");
  for (const t of srcTopics) {
    const tid = idOf(t);
    console.log(`  topics/${tid}  ("${unwrap(t.fields?.name)}", ${String(unwrap(t.fields?.bodyHtml) || "").length} chars body)`);
    await putDoc(`agendas/${DEST}/topics/${tid}`, t.fields);
  }

  // ── 2) firefliesTitles (history) ──
  console.log("\nSTEP 2 — copy firefliesTitles");
  if (src.fields?.firefliesTitles) {
    await patchFields(`agendas/${DEST}`, { firefliesTitles: src.fields.firefliesTitles });
  } else {
    console.log("    (source has no firefliesTitles — skip)");
  }

  // ── 3) versions subcollection (agenda version history) ──
  console.log("\nSTEP 3 — copy versions (history)");
  if (srcVersions.length === 0) console.log("    (no versions to copy)");
  for (const v of srcVersions) {
    const vid = idOf(v);
    console.log(`  versions/${vid}`);
    await putDoc(`agendas/${DEST}/versions/${vid}`, v.fields);
  }

  line();
  console.log(APPLY
    ? "Done. Reload the BMD - Biweekly agenda — topics + history should render (room self-seeds from bodyHtml)."
    : "DRY-RUN complete. Re-run with --apply to execute.");
})().catch((e) => { console.error("\nREPAIR FAILED:", e.message); process.exit(1); });
