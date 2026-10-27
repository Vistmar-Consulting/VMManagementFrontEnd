// Pure helpers for Board Sync — the Task Board's all-org sync (spec
// docs/superpowers/specs/2026-10-26-board-sync-design.md). No Firebase/React
// imports; unit-tested in __tests__/boardSyncCore.test.js. boardSync.js does the
// I/O and calls these.
import { STATUS_OPTIONS } from "../constants/itemStatuses.js";
import { AI_GEN_STATUS } from "./itemStatusMap.js";
import { inferAssigneeIds } from "./syncMeeting.js";

// Twin: api/ai/_handlers/syncBoard.js BOARD_SYNC_EMAIL (api/ can't import src/).
// A test asserts the two match.
export const BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com";

const DAY_MS = 24 * 60 * 60 * 1000;
export const LOOKBACK_MS = 30 * DAY_MS;
export const MAX_NEW_TRANSCRIPTS = 25;
export const MAX_CONTEXT_TRANSCRIPTS = 10;
const MAX_BOARD_ITEMS = 40;

// Scopes that can create tasks for an org (spec 3.2). vistamar-internal and
// already-synced are context only.
const NEW_SCOPES = new Set(["this-org", "cross-org"]);

const norm = (s) => String(s || "").toLowerCase().trim();

export function toMs(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v.toMillis) return v.toMillis(); // Firestore Timestamp
  const p = Date.parse(v);
  return Number.isNaN(p) ? 0 : p;
}

export function canBoardSync(email) {
  return norm(email) === BOARD_SYNC_EMAIL;
}

// slugify a coined tag name → a stable lowercase-hyphenated id.
export function tagSlug(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Put each in-window Fireflies row into every org bucket it belongs to, tagged
// with its scope for that org (spec table 3.2):
//   master-mapped title      → cross-org in EVERY bucket
//   Vistamar meeting         → this-org for vistamar, vistamar-internal for clients
//   client meeting           → this-org for that client only
// Org resolution order: master title, then titleOrgs (explicit title→org agenda
// mapping, any non-master agenda), then attendee classification. Keys of
// masterTitles/titleOrgs are normalized here. Rows that are undated or that no
// rule claims are counted as unclassified, not silently dropped; out-of-window
// rows are dropped silently.
export function bucketTranscripts(list, { orgSlugs, masterTitles, titleOrgs, resolveOrg, sinceMs }) {
  const buckets = Object.fromEntries(orgSlugs.map((o) => [o, []]));
  const masters = new Set([...masterTitles].map(norm));
  const mapped = new Map([...titleOrgs].map(([k, v]) => [norm(k), v]));
  let unclassified = 0;
  for (const t of list || []) {
    const ms = toMs(t.date);
    if (!ms) {
      unclassified += 1;
      continue;
    }
    if (ms < sinceMs) continue;
    const title = norm(t.title);
    const row = { ...t, _ms: ms };
    if (masters.has(title)) {
      orgSlugs.forEach((o) => buckets[o].push({ ...row, scope: "cross-org" }));
      continue;
    }
    const org = mapped.get(title) || resolveOrg(t.meeting_attendees) || null;
    if (org === "vistamar") {
      orgSlugs.forEach((o) => buckets[o].push({ ...row, scope: o === "vistamar" ? "this-org" : "vistamar-internal" }));
    } else if (org && buckets[org]) {
      buckets[org].push({ ...row, scope: "this-org" });
    } else {
      unclassified += 1;
    }
  }
  return { buckets, unclassified };
}

// The moment Sync Meeting started stamping the ledger (rules + FE deploy). Set
// to the real deploy time at ship (morning checklist). Transcripts after it are
// judged by the ledger alone; backfill only covers history before it.
export const LEDGER_EPOCH_MS = Date.parse("2026-10-27T17:05:00Z");

// Ledger stamp, or — for pre-ledger transcripts only — backfill: it counts as
// synced for org X if it predates X's latest Sync Meeting. A cross-org meeting
// was only ever a SOURCE for the master agenda's sync (a client's Sync Meeting
// saw it as context), so it uses the master threshold alone. Spec 3.4.
function isSyncedFor(t, org, { ledger, thresholds, masterThreshold, epochMs = LEDGER_EPOCH_MS }) {
  if (ledger.get(t.id)?.orgs?.[org]) return true;
  if (t._ms >= epochMs) return false;
  const th = t.scope === "cross-org" ? masterThreshold || 0 : thresholds[org] || 0;
  return t._ms <= th;
}

// Split one org's bucket into new sources (may create tasks) and context.
export function splitBucket(bucket, org, ctx, { maxNew = MAX_NEW_TRANSCRIPTS, maxContext = MAX_CONTEXT_TRANSCRIPTS } = {}) {
  const sorted = [...(bucket || [])].sort((a, b) => b._ms - a._ms);
  const fresh = [];
  const synced = [];
  const internal = [];
  for (const t of sorted) {
    if (!NEW_SCOPES.has(t.scope)) internal.push(t);
    else if (isSyncedFor(t, org, ctx)) synced.push({ ...t, scope: "already-synced", crossOrg: t.scope === "cross-org" });
    else fresh.push(t);
  }
  // already-synced is the do-not-duplicate signal, so it survives the cap first.
  return {
    fresh: fresh.slice(0, maxNew),
    context: [...synced, ...internal].slice(0, maxContext),
    droppedNew: Math.max(0, fresh.length - maxNew),
  };
}

// Which (transcript, org) pairs a Sync Meeting apply stamps (spec 3.3).
// `transcripts` come from assembleGenInputs ({ id, org, scope, mapped }).
export function syncMeetingStamps(transcripts, { targetOrg, master, orgSlugs }) {
  const out = [];
  for (const t of transcripts || []) {
    if (!t?.id) continue;
    if (master) {
      if (t.mapped) orgSlugs.forEach((o) => out.push({ id: t.id, org: o }));
      else if (t.org) out.push({ id: t.id, org: t.org });
    } else if (t.scope === "this-org" && targetOrg) {
      out.push({ id: t.id, org: targetOrg });
    }
  }
  return out;
}

// A string usable as a Firestore doc id (a transcript id for the ledger, an
// item id from the model). doc() throws on anything else inside a transaction,
// which would abort the whole apply over one bad id.
export function isDocId(id) {
  return typeof id === "string" && id !== "" && id !== "." && id !== ".." && !id.includes("/") && !/^__.*__$/.test(id);
}
export const isLedgerId = isDocId;

// [{ id, org }] → { [id]: [org, …] } so each ledger doc is written once per tx.
// Ids Firestore can't use are skipped (that transcript stays unstamped = new).
export function groupStamps(stamps) {
  const out = {};
  for (const { id, org } of stamps || []) {
    if (!isDocId(id)) continue;
    if (!out[id]) out[id] = [];
    if (!out[id].includes(org)) out[id].push(org);
  }
  return out;
}

// Page the Fireflies list (newest first) until it passes sinceMs. Fails loudly
// rather than returning a silently truncated window.
export async function fetchTranscriptsSince(queryFn, listQuery, sinceMs, { pageSize = 50, maxPages = 10 } = {}) {
  const all = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const data = await queryFn(listQuery, { limit: pageSize, skip: page * pageSize });
    const rows = data?.transcripts || [];
    // Offset paging can shift when a transcript lands mid-run; keep each id once.
    for (const row of rows) if (!seen.has(row.id)) { seen.add(row.id); all.push(row); }
    if (rows.length < pageSize) return all;
    const dates = rows.map((r) => toMs(r.date)).filter(Boolean);
    if (dates.length && Math.min(...dates) < sinceMs) return all;
  }
  throw new Error(`Fireflies list did not reach ${new Date(sinceMs).toISOString().slice(0, 10)} within ${maxPages} pages`);
}

const statusLabel = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "?";

// One org's board inputs — same shapes as assembleGenInputs' per-org output.
// Item docs carry `title`; the projectBoard row field is still called `name`.
export function boardContextForOrg(items, org, sinceMs) {
  const own = (items || []).filter((it) => it.organizationId === org);
  const nameById = new Map((items || []).map((it) => [it.id, it.title]));
  const projectBoard = own
    .filter((it) => toMs(it.createdAt) >= sinceMs || toMs(it.updatedAt) >= sinceMs)
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
    .slice(0, MAX_BOARD_ITEMS)
    .map((it) => ({
      name: it.title || "",
      status: statusLabel(it.statusId),
      isNew: toMs(it.createdAt) >= sinceMs,
      project: it.parentId ? nameById.get(it.parentId) || null : null,
    }));
  const existingTasks = own
    .filter((it) => !it.parentId)
    .map((it) => ({ id: it.id, title: it.title || "", status: statusLabel(it.statusId), category: it.categoryId || null, organizationId: org }))
    .filter((t) => t.title);
  return { projectBoard, existingTasks };
}

function resolveTagId(raw, tags) {
  const name = String(raw || "").trim();
  if (!name) return null;
  const byId = tags.find((t) => t.id === name);
  if (byId) return byId.id;
  const byName = tags.find((t) => norm(t.name) === norm(name));
  if (byName) return byName.id;
  const slug = tagSlug(name);
  return tags.find((t) => t.id === slug)?.id || null;
}

// Initial review state for one create (spec 7, "Create mapping"): AI Gen status,
// first resolvable category, known tags as ids, unknown tags kept to coin at apply.
export function initPromotion(create, { categories, tags, users }) {
  const catIds = new Set((categories || []).map((c) => c.id));
  const catByName = new Map((categories || []).map((c) => [norm(c.name), c.id]));
  const categoryId = (create.categories || [])
    .map((c) => (catIds.has(String(c).trim()) ? String(c).trim() : catByName.get(norm(c)) || null))
    .find(Boolean) || null;
  const tagIds = [];
  const newTags = [];
  for (const raw of create.tags || []) {
    const id = resolveTagId(raw, tags || []);
    if (id) {
      if (!tagIds.includes(id)) tagIds.push(id);
    } else if (tagSlug(raw) && !newTags.some((n) => tagSlug(n) === tagSlug(raw))) {
      newTags.push(String(raw).trim());
    }
  }
  const assigneeIds = inferAssigneeIds(create.note, users || []);
  return { statusId: AI_GEN_STATUS, categoryId, tagIds, newTags, ...(assigneeIds.length ? { assigneeIds } : {}) };
}
