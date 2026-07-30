// dev/audit-agenda-strands.mjs
//
// READ-ONLY audit for the "recurrence-split stranded agenda" bug (see
// project_agenda_recurrence_split_bug). Finds EVERY agenda that is blank for
// the same reason BMD - Biweekly was: a recurring meeting's Google series split
// into a new recurrence master, agendas are keyed by Google master id, so the
// live (upcoming-owning) master's agenda doc is EMPTY while a sibling master's
// doc still holds the team's topics + Fireflies history.
//
// Method:
//   1. Firestore: list all agendas; group by BASE id (strip _R<YYYYMMDD>T<HHMMSS>).
//      Record content signal per doc: topics count, firefliesTitles count.
//   2. Google: sweep meetings@ / Tate / Cedric calendars for occurrences from
//      TODAY forward; record which recurrence masters own upcoming occurrences.
//   3. Flag STRAND = a group where a LIVE master (owns an upcoming occurrence)
//      has an empty agenda doc AND a sibling master has a non-empty one.
//      Suggested repair source = most-recently-updated non-empty sibling.
//
// Touches nothing. Run:  node --env-file=.env.vercel dev/audit-agenda-strands.mjs
//
import { execSync } from "node:child_process";
import { google } from "googleapis";
import { getGoogleCredentials } from "../api/meetings/_lib/keyvault.js";

const PROJECT = "management-db9eb";
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = `projects/${PROJECT}/databases/(default)/documents`;
const SUBJECTS = [
  "meetings@vistamarconsulting.com",
  "trobinson@vistamarconsulting.com",
  "ctucksherman@vistamarconsulting.com",
];
// Window: from now forward. (Uses a fixed "now" passed via arg-free Date is
// disallowed in workflows but this is a plain node script, so Date is fine.)
const NOW = new Date();
const WINDOW_END = new Date(NOW.getTime() + 120 * 864e5); // +120 days

const FS_TOKEN = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const H = { Authorization: `Bearer ${FS_TOKEN}` };
const line = () => console.log("─".repeat(78));
const RSUFFIX = /_R\d{8}T\d{6}$/;
const baseOf = (id) => id.replace(RSUFFIX, "");

function unwrap(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("booleanValue" in v) return v.booleanValue;
  if ("doubleValue" in v) return v.doubleValue;
  return null;
}
async function fsListAll(coll) {
  const out = []; let tok = "";
  do {
    const r = await fetch(`${FS_ROOT}/${FS_DB}/${coll}?pageSize=300${tok ? `&pageToken=${tok}` : ""}`, { headers: H });
    if (!r.ok) throw new Error(`list ${coll} -> ${r.status}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    tok = j.nextPageToken || "";
  } while (tok);
  return out;
}
async function fsCount(path) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?pageSize=300`, { headers: H });
  if (r.status === 404) return 0;
  if (!r.ok) throw new Error(`count ${path} -> ${r.status}`);
  return ((await r.json()).documents || []).length;
}
const idOf = (d) => d.name.split("/").pop();

async function googleClient(subject) {
  const creds = await getGoogleCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email, key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"], subject,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

(async () => {
  line();
  console.log(`AGENDA STRAND AUDIT (READ-ONLY)  now=${NOW.toISOString().slice(0, 10)} → ${WINDOW_END.toISOString().slice(0, 10)}`);
  line();

  // ── 1. Firestore agenda docs + content signal ──
  const docs = await fsListAll("agendas");
  const agendas = [];
  for (const d of docs) {
    const id = idOf(d);
    const f = d.fields || {};
    const topics = await fsCount(`agendas/${id}/topics`);
    const ff = (unwrap(f.firefliesTitles) || []).length;
    agendas.push({
      id, base: baseOf(id),
      title: unwrap(f.title) || "(untitled)",
      org: unwrap(f.organizationId),
      calendarSeriesId: unwrap(f.calendarSeriesId),
      googleEventId: unwrap(f.googleEventId),
      topics, ff,
      hasContent: topics > 0 || ff > 0,
      updatedAt: unwrap(f.updatedAt) || "",
      meetingDatetime: unwrap(f.meetingDatetime) || "",
    });
  }

  // ── 2. Google: which masters own an UPCOMING occurrence ──
  const liveMasters = new Map(); // recurringEventId -> earliest upcoming ISO date
  for (const subject of SUBJECTS) {
    let cal;
    try { cal = await googleClient(subject); } catch { continue; }
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: NOW.toISOString(),
      timeMax: WINDOW_END.toISOString(),
      singleEvents: true, orderBy: "startTime", maxResults: 500,
    });
    for (const e of res.data.items || []) {
      const rid = e.recurringEventId;
      if (!rid) continue;
      const when = e.start?.dateTime || e.start?.date;
      if (!liveMasters.has(rid) || when < liveMasters.get(rid)) liveMasters.set(rid, when);
    }
  }

  // ── 3. Correlate by base group ──
  const groups = new Map();
  for (const a of agendas) {
    if (!groups.has(a.base)) groups.set(a.base, []);
    groups.get(a.base).push(a);
  }

  const strands = [];
  for (const [base, members] of groups) {
    if (members.length < 2) continue; // no split, no strand
    const liveEmpty = members.filter((m) => liveMasters.has(m.id) && !m.hasContent);
    const contentSibs = members.filter((m) => m.hasContent);
    if (liveEmpty.length === 0 || contentSibs.length === 0) continue;
    // best source = most-recently-updated non-empty sibling
    const source = [...contentSibs].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
    for (const dest of liveEmpty) {
      strands.push({ base, source, dest, nextOccur: liveMasters.get(dest.id) });
    }
  }

  // ── Report ──
  console.log(`Total agendas: ${agendas.length}  |  multi-master groups: ${[...groups.values()].filter((g) => g.length > 1).length}\n`);
  console.log("=== Split series (groups with >1 master) ===");
  for (const [base, members] of groups) {
    if (members.length < 2) continue;
    console.log(`\n base: ${base}   ("${members[0].title}")`);
    for (const m of members.sort((a, b) => a.id.localeCompare(b.id))) {
      const live = liveMasters.has(m.id) ? `LIVE→${liveMasters.get(m.id).slice(0, 16)}` : "(no upcoming)";
      const flag = liveMasters.has(m.id) && !m.hasContent ? "  ⟵ EMPTY & LIVE" : "";
      console.log(`   ${m.id}`);
      console.log(`      topics=${m.topics} ff=${m.ff} content=${m.hasContent}  ${live}  upd=${(m.updatedAt || "").slice(0, 10)}${flag}`);
    }
  }

  // ── 3b. Vector B: dual-id-scheme strand (NewMeetingDialog random-id doc has
  //        content; an empty shadow exists at agendas/{calendarSeriesId} which
  //        the Calendar routes to). Correlate by shared title+org.
  const byTitle = new Map();
  for (const a of agendas) {
    const key = `${(a.title || "").trim().toLowerCase()}|${a.org || ""}`;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(a);
  }
  const dualStrands = [];
  for (const a of agendas) {
    if (!a.hasContent) continue;
    if (!a.calendarSeriesId || a.calendarSeriesId === a.id) continue; // random-id doc only
    const shadow = agendas.find((x) => x.id === a.calendarSeriesId);
    if (shadow && !shadow.hasContent) {
      dualStrands.push({ source: a, dest: shadow });
    }
  }

  console.log("\n=== Vector B check (random-id content doc + empty series-id shadow) ===");
  const randomIdContentDocs = agendas.filter((a) => a.hasContent && a.calendarSeriesId && a.calendarSeriesId !== a.id);
  if (randomIdContentDocs.length === 0) {
    console.log("  (no content-bearing random-id agenda docs — Vector B not applicable)");
  } else {
    for (const a of randomIdContentDocs) {
      const shadow = agendas.find((x) => x.id === a.calendarSeriesId);
      console.log(`  "${a.title}" [${a.org}] id=${a.id}  →seriesId=${a.calendarSeriesId}  shadow=${shadow ? (shadow.hasContent ? "EXISTS(content)" : "EXISTS(EMPTY!)") : "none"}`);
    }
  }

  line();
  const total = strands.length + dualStrands.length;
  if (total === 0) {
    console.log("✓ NO STRANDS FOUND. BMD was the only one (already repaired).");
  } else {
    console.log(`⚠ ${total} STRANDED AGENDA(S):\n`);
    for (const s of strands) {
      console.log(`  [split] "${s.dest.title}" [${s.dest.org}]  next occurrence ${s.nextOccur?.slice(0, 16)}`);
      console.log(`      SOURCE (content): ${s.source.id}  topics=${s.source.topics} ff=${s.source.ff} upd=${s.source.updatedAt.slice(0, 10)}`);
      console.log(`      DEST   (empty)  : ${s.dest.id}`);
      console.log("");
    }
    for (const s of dualStrands) {
      console.log(`  [dual-id] "${s.dest.title}" [${s.dest.org}]`);
      console.log(`      SOURCE (content): ${s.source.id}  topics=${s.source.topics} ff=${s.source.ff} upd=${s.source.updatedAt.slice(0, 10)}`);
      console.log(`      DEST   (empty)  : ${s.dest.id}`);
      console.log("");
    }
    console.log("Repair each with a copy-forward (same pattern as BMD).");
  }
  line();
  console.log("Done. Nothing modified.");
})().catch((e) => { console.error("AUDIT FAILED:", e.message); process.exit(1); });
