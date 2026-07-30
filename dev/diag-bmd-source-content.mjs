// dev/diag-bmd-source-content.mjs
//
// READ-ONLY. Dumps the full content shape of the stranded "BMD - Biweekly"
// agenda doc (Google master _R20260521T183000) so we know EXACTLY what a
// content migration to the new master (_R20260702T183000) must carry:
// parent content fields, every topic doc's fields, and any nested
// subcollections (talkingPoints / notes / etc) via :listCollectionIds.
//
// Run:  node dev/diag-bmd-source-content.mjs
//
import { execSync } from "node:child_process";

const PROJECT = "management-db9eb";
const FS_ROOT = "https://firestore.googleapis.com/v1";
const FS_DB = `projects/${PROJECT}/databases/(default)/documents`;
const SRC = "6295h9p4mu514u7fkqm0tgmr68_R20260521T183000";

const T = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
const H = { Authorization: `Bearer ${T}` };

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
  return "(?)";
}
async function getDoc(path) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}
async function listDocs(path) {
  const out = [];
  let tok = "";
  do {
    const r = await fetch(`${FS_ROOT}/${FS_DB}/${path}?pageSize=300${tok ? `&pageToken=${tok}` : ""}`, { headers: H });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`LIST ${path} -> ${r.status}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    tok = j.nextPageToken || "";
  } while (tok);
  return out;
}
async function listCollIds(docPath) {
  const r = await fetch(`${FS_ROOT}/${FS_DB}/${docPath}:listCollectionIds`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}",
  });
  if (!r.ok) return [];
  return (await r.json()).collectionIds || [];
}
const idOf = (d) => d.name.split("/").pop();
const preview = (s, n = 90) => (s ? `${String(s).slice(0, n).replace(/\s+/g, " ")}${String(s).length > n ? "…" : ""}` : "(empty)");

(async () => {
  console.log("─".repeat(76));
  console.log(`SOURCE agendas/${SRC} — full content shape (READ-ONLY)`);
  console.log("─".repeat(76));

  const parent = await getDoc(`agendas/${SRC}`);
  const pf = parent.fields || {};
  console.log(`title           : ${unwrap(pf.title)}`);
  console.log(`organizationId  : ${unwrap(pf.organizationId)}`);
  console.log(`firefliesTitles : ${JSON.stringify(unwrap(pf.firefliesTitles) || [])}`);
  console.log(`openFloorHtml   : ${unwrap(pf.openFloorHtml) ? `${String(unwrap(pf.openFloorHtml)).length} chars — "${preview(unwrap(pf.openFloorHtml))}"` : "(empty)"}`);
  console.log(`parent subcollections: ${JSON.stringify(await listCollIds(`agendas/${SRC}`))}`);
  console.log(`\nALL parent field keys: ${JSON.stringify(Object.keys(pf))}`);

  const topics = await listDocs(`agendas/${SRC}/topics`);
  console.log(`\n${"═".repeat(40)}\nTOPICS (${topics.length})`);
  for (const t of topics) {
    const tid = idOf(t);
    const tf = t.fields || {};
    console.log(`\n topics/${tid}`);
    console.log(`   field keys : ${JSON.stringify(Object.keys(tf))}`);
    console.log(`   name/title : ${unwrap(tf.name) ?? unwrap(tf.title)}`);
    console.log(`   sortOrder  : ${unwrap(tf.sortOrder) ?? unwrap(tf.order)}`);
    console.log(`   bodyHtml   : ${unwrap(tf.bodyHtml) ? `${String(unwrap(tf.bodyHtml)).length} chars — "${preview(unwrap(tf.bodyHtml))}"` : "(empty)"}`);
    const subs = await listCollIds(`agendas/${SRC}/topics/${tid}`);
    console.log(`   subcollections: ${JSON.stringify(subs)}`);
    for (const s of subs) {
      const sd = await listDocs(`agendas/${SRC}/topics/${tid}/${s}`);
      console.log(`     · ${s}: ${sd.length} docs`);
    }
  }
  console.log(`\n${"─".repeat(76)}\nDone. Nothing modified.`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
