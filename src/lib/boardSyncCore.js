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
// Rows no rule claims are counted, not silently dropped.
export function bucketTranscripts(list, { orgSlugs, masterTitles, vistamarTitles, resolveOrg, sinceMs }) {
  const buckets = Object.fromEntries(orgSlugs.map((o) => [o, []]));
  let unclassified = 0;
  for (const t of list || []) {
    const ms = toMs(t.date);
    if (!ms || ms < sinceMs) continue;
    const title = norm(t.title);
    const row = { ...t, _ms: ms };
    if (masterTitles.has(title)) {
      orgSlugs.forEach((o) => buckets[o].push({ ...row, scope: "cross-org" }));
      continue;
    }
    const org = resolveOrg(t.meeting_attendees) || (vistamarTitles.has(title) ? "vistamar" : null);
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
export const LEDGER_EPOCH_MS = Date.parse("2026-10-27T12:00:00Z");

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
  const context = [];
  for (const t of sorted) {
    if (!NEW_SCOPES.has(t.scope)) context.push(t);
    else if (isSyncedFor(t, org, ctx)) context.push({ ...t, scope: "already-synced" });
    else fresh.push(t);
  }
  return {
    fresh: fresh.slice(0, maxNew),
    context: context.slice(0, maxContext),
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

// [{ id, org }] → { [id]: [org, …] } so each ledger doc is written once per tx.
export function groupStamps(stamps) {
  const out = {};
  for (const { id, org } of stamps || []) {
    if (!out[id]) out[id] = [];
    if (!out[id].includes(org)) out[id].push(org);
  }
  return out;
}

// Page the Fireflies list (newest first) until it passes sinceMs. Fails loudly
// rather than returning a silently truncated window.
export async function fetchTranscriptsSince(queryFn, listQuery, sinceMs, { pageSize = 50, maxPages = 10 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await queryFn(listQuery, { limit: pageSize, skip: page * pageSize });
    const rows = data?.transcripts || [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
    const dates = rows.map((r) => toMs(r.date)).filter(Boolean);
    if (dates.length && Math.min(...dates) < sinceMs) return all;
  }
  throw new Error(`Fireflies list did not reach ${new Date(sinceMs).toISOString().slice(0, 10)} within ${maxPages} pages`);
}

const statusLabel = (id) => STATUS_OPTIONS.find((s) => s.id === id)?.name || "?";

// One org's board inputs — same shapes as assembleGenInputs' per-org output.
export function boardContextForOrg(items, org, sinceMs) {
  const own = (items || []).filter((it) => it.organizationId === org);
  const nameById = new Map((items || []).map((it) => [it.id, it.name]));
  const projectBoard = own
    .filter((it) => toMs(it.createdAt) >= sinceMs || toMs(it.updatedAt) >= sinceMs)
    .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
    .slice(0, MAX_BOARD_ITEMS)
    .map((it) => ({
      name: it.name || "",
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
    } else if (norm(raw) && !newTags.includes(String(raw).trim())) {
      newTags.push(String(raw).trim());
    }
  }
  const assigneeIds = inferAssigneeIds(create.note, users || []);
  return { statusId: AI_GEN_STATUS, categoryId, tagIds, newTags, ...(assigneeIds.length ? { assigneeIds } : {}) };
}
