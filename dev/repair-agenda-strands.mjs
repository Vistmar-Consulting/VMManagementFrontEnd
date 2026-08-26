// dev/repair-agenda-strands.mjs
//
// One-off data repair for the 2026-08-26 recurrence-split strand incident.
//
// Google re-mints a recurring series' master id ({originalId}_R{splitStartUTC})
// on every "this and following" edit. Agendas were keyed by that raw id, so
// each reschedule minted a fresh EMPTY agenda and stranded the team's topics on
// the previous doc. The code fix (src/lib/agendaIds.js) keys agendas by the
// BASE id from now on; this script moves the already-stranded content onto the
// base doc so the fix has something to find.
//
// NON-DESTRUCTIVE. Copies forward only. Deletes nothing, overwrites no topic.
// The old _R docs stay exactly where they are as history — after the code fix
// nothing routes to them.
//
// NOT copied: `versions` and `aiGenLog` subcollections (audit trails stay with
// the doc that recorded them) and agenda-level `attendees` when the dest doc
// already has its own (ManageGuestsDialog curates that list).
//
// SAFETY: dry-run by default. Refuses to touch a dest that already has topics.
//
// Run (dry-run):  node dev/repair-agenda-strands.mjs
// Run (apply):    node dev/repair-agenda-strands.mjs --apply

import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = "projects/management-db9eb/databases/(default)/documents";

let _tok = null;
function token() {
  if (_tok) return _tok;
  try {
    _tok = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch (e) {
    console.error("gcloud token failed — run `gcloud auth login`.");
    process.exit(1);
  }
  return _tok;
}
const H = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });
const line = () => console.log("─".repeat(78));

// Stranded groups, resolved from the read-only survey. dest is always the BASE
// id that src's recurrence split derived from.
const MOVES = [
  {
    label: "Unio Weekly Marketing Meeting",
    src: "0u55qjoteslnrjsmftmlinea7i_R20260407T200000",
    dest: "0u55qjoteslnrjsmftmlinea7i",
  },
  {
    label: "VM Weekly Touch Base",
    src: "fin1psha42g36a1rba6l08iefd_R20260209T190000",
    dest: "fin1psha42g36a1rba6l08iefd",
  },
  {
    label: "Vistamar Platform Development updates",
    src: "_60q30c1g60o30e1i60o4ac1g60rj8gpl88rj2c1h84s34h9g60s30c1g60o30c1g6go46e1n60pj8c218opk8g9g64o30c1g60o30c1g60o30c1g60o32c1g60o30c1g84sj0di48ork6d9p651jedhk74sj0c9n74s30hhm64o3ica26spg_R20241003T210000",
    dest: "_60q30c1g60o30e1i60o4ac1g60rj8gpl88rj2c1h84s34h9g60s30c1g60o30c1g6go46e1n60pj8c218opk8g9g64o30c1g60o30c1g60o30c1g60o32c1g60o30c1g84sj0di48ork6d9p651jedhk74sj0c9n74s30hhm64o3ica26spg",
  },
  {
    // Two content docs exist. _R20260702 is the July copy-forward of
    // _R20260521 plus later edits (longer Content + Website bodies), so it is
    // the live one. Merging both would duplicate Content/Website/PPC.
    label: "BMD - Biweekly",
    src: "6295h9p4mu514u7fkqm0tgmr68_R20260702T183000",
    dest: "6295h9p4mu514u7fkqm0tgmr68",
  },
];

// GV and ID Care already hold their content on the base doc — the code fix
// alone resolves them, nothing to move.
const ALREADY_OK = [
  "ea74a0v5at8tqo46ka8mtth368 (GV – Biweekly)",
  "6jvfp6utmbu00gl122ps935n7g (ID Care - Biweekly)",
];

// Agenda-level content fields worth carrying forward. Binding fields
// (calendarSeriesId / googleEventId / graphEventId / iCalUID /
// meetingDatetime) are deliberately excluded: the reconciler owns those and
// the dest's values are fresher.
const CONTENT_FIELDS = [
  "title",
  "organizationId",
  "preBriefHtml",
  "openFloorHtml",
  "firefliesTitles",
  "notes",
  "meetingStyle",
  "status",
  "openFloorCollabSeeded",
];

async function getDoc(path) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}`, { headers: H() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function listAll(path) {
  const out = [];
  let tok = "";
  do {
    const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?pageSize=300${tok ? `&pageToken=${tok}` : ""}`, { headers: H() });
    if (r.status === 404) return out;
    if (!r.ok) throw new Error(`LIST ${path} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    tok = j.nextPageToken || "";
  } while (tok);
  return out;
}
async function patchDoc(path, fields) {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?${mask}`, {
    method: "PATCH", headers: H(), body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
const idOf = (d) => d.name.split("/").pop();

(async () => {
  line();
  console.log(`REPAIR AGENDA STRANDS  —  ${APPLY ? "APPLY" : "DRY-RUN (no writes)"}`);
  line();
  console.log("Already correct (content is on the base doc, code fix suffices):");
  for (const a of ALREADY_OK) console.log(`  ✓ ${a}`);

  let moved = 0, skipped = 0;

  for (const mv of MOVES) {
    line();
    console.log(`"${mv.label}"`);
    console.log(`  src : ${mv.src}`);
    console.log(`  dest: ${mv.dest}`);

    const srcDoc = await getDoc(`agendas/${mv.src}`);
    if (!srcDoc) { console.log("  ✋ SKIP — source agenda not found."); skipped++; continue; }

    const srcTopics = await listAll(`agendas/${mv.src}/topics`);
    if (srcTopics.length === 0) { console.log("  ✋ SKIP — source has no topics."); skipped++; continue; }

    const destDoc = await getDoc(`agendas/${mv.dest}`);
    const destTopics = destDoc ? await listAll(`agendas/${mv.dest}/topics`) : [];
    if (destTopics.length > 0) {
      console.log(`  ✋ SKIP — dest already has ${destTopics.length} topic(s); refusing to duplicate.`);
      skipped++; continue;
    }

    // Agenda-level content fields to carry forward.
    const srcFields = srcDoc.fields || {};
    const carry = {};
    for (const f of CONTENT_FIELDS) if (srcFields[f] !== undefined) carry[f] = srcFields[f];
    if (!destDoc && srcFields.attendees) carry.attendees = srcFields.attendees;
    carry.updatedAt = { timestampValue: new Date().toISOString() };

    console.log(`  topics to copy : ${srcTopics.length}`);
    console.log(`  fields to carry: ${Object.keys(carry).join(", ")}`);
    console.log(`  dest exists    : ${destDoc ? "yes (merge into it)" : "no (will be created)"}`);
    for (const t of srcTopics) {
      const n = t.fields?.name?.stringValue || "(unnamed)";
      const b = (t.fields?.bodyHtml?.stringValue || "").length;
      const subs = await Promise.all([
        listAll(`agendas/${mv.src}/topics/${idOf(t)}/talkingPoints`),
        listAll(`agendas/${mv.src}/topics/${idOf(t)}/notes`),
      ]);
      console.log(`     • "${n}"  body=${b}ch  tp=${subs[0].length} notes=${subs[1].length}`);
    }

    if (!APPLY) { console.log("  (dry-run — nothing written)"); continue; }

    // 1. Agenda doc content fields.
    await patchDoc(`agendas/${mv.dest}`, carry);
    // 2. Topics, preserving doc ids (and their legacy subcollections).
    for (const t of srcTopics) {
      const tid = idOf(t);
      await patchDoc(`agendas/${mv.dest}/topics/${tid}`, t.fields || {});
      for (const sub of ["talkingPoints", "notes"]) {
        for (const s of await listAll(`agendas/${mv.src}/topics/${tid}/${sub}`)) {
          await patchDoc(`agendas/${mv.dest}/topics/${tid}/${sub}/${idOf(s)}`, s.fields || {});
        }
      }
    }
    console.log(`  ✓ moved ${srcTopics.length} topic(s) onto ${mv.dest}`);
    moved++;
  }

  line();
  console.log(APPLY ? `Done. ${moved} group(s) repaired, ${skipped} skipped.` : `DRY-RUN complete. Re-run with --apply.`);
  console.log("Source docs were NOT deleted — they remain as history.");
  console.log("NOTE: each repaired agenda gets a fresh Liveblocks room (room id is");
  console.log("derived from the agenda doc id). The editor re-seeds from Firestore");
  console.log("bodyHtml on first open, so bodies appear after one page load.");
  line();
})().catch((e) => { console.error("\nREPAIR FAILED:", e.message); process.exit(1); });
