// src/lib/boardChat/snapshot.js
//
// Board → the compact BOARD CONTEXT text Board Chat sends once per
// conversation, plus `seen`: the updatedAt (ms) of every item the model was
// shown — the staleness baseline for the change modal.
import { STATUS, STATUS_OPTIONS } from "../../constants/itemStatuses.js";
import { PRIORITY_LIST } from "../../constants/itemPriorities.js";
import { tsToDate } from "../../utils/firestoreTime.js";

const STATUS_NAME = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.id, s.name]));
const PRIORITY_NAME = Object.fromEntries(PRIORITY_LIST.map((p) => [p.id, p.label]));

export function toMillis(ts) {
  if (!ts) return null;
  if (ts.toMillis) return ts.toMillis();
  const d = tsToDate(ts);
  return d ? d.getTime() : null;
}

export function ymd(ts) {
  const d = tsToDate(ts);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// SI-N restarts under every parent, so a subtask's ref carries its parent's
// ("I-4/SI-1") whenever `items` is given; without it the bare SI-N is ambiguous.
export function itemRef(item, items = []) {
  const own = `${item.parentId ? "SI" : "I"}-${item.itemNumber ?? "?"}`;
  const parent = item.parentId && items.find((i) => i.id === item.parentId);
  return parent ? `${itemRef(parent)}/${own}` : own;
}

export function memberName(u) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return (u.displayName || full || u.email || u.id || "").trim();
}

export function statusName(id) {
  return STATUS_NAME[id] || String(id ?? "");
}

export function priorityName(id) {
  return PRIORITY_NAME[id] || String(id ?? "");
}

export function makeLookups({ users, orgs, categories, tags }) {
  const by = (list, label) => new Map(list.map((x) => [x.id, label(x)]));
  const userName = by(users, memberName);
  const orgName = by(orgs, (o) => o.name || o.id);
  const categoryName = by(categories, (c) => c.name || c.id);
  const tagName = by(tags, (t) => t.name || t.id);
  return {
    userName: (id) => userName.get(id) || id,
    orgName: (id) => orgName.get(id) || id,
    categoryName: (id) => categoryName.get(id) || id,
    tagName: (id) => tagName.get(id) || id,
  };
}

export function itemRow(item, L, items) {
  return [
    item.id,
    itemRef(item, items),
    L.orgName(item.organizationId),
    item.parentId || "-",
    statusName(item.statusId),
    (item.assigneeIds || []).map(L.userName).join(", "),
    priorityName(item.priorityId),
    item.categoryId ? L.categoryName(item.categoryId) : "",
    (item.tagIds || []).map(L.tagName).join(", "),
    ymd(item.dueDate),
    ymd(item.updatedAt),
    item.title || "(untitled)",
  ].join(" | ");
}

// People come from lib/people.js: Vistamar team, a client's contact, or an
// account that can't be assigned (seo@ and other bots).
function memberRole(u, L) {
  if (u.assignable === false) return "not assignable";
  if (u.kind === "client") return `client contact, ${u.orgIds.map(L.orgName).join(" / ")}`;
  return "Vistamar team";
}

export function buildBoardSnapshot({ items, users, orgs, categories, tags }) {
  const L = makeLookups({ users, orgs, categories, tags });
  const live = items.filter((i) => i.statusId !== STATUS.ARCHIVE);
  const text = [
    "MEMBERS (id | name | email | who)",
    ...users.map((u) => `${u.id} | ${memberName(u)} | ${u.email || ""} | ${memberRole(u, L)}`),
    "",
    "ORGANIZATIONS (id | name)",
    ...orgs.map((o) => `${o.id} | ${o.name || o.id}`),
    "",
    "CATEGORIES (id | name)",
    ...categories.map((c) => `${c.id} | ${c.name || c.id}`),
    "",
    "TAGS (id | name | used by)",
    ...tags.map((t) => `${t.id} | ${t.name || t.id} | ${t.organizationId ? `${L.orgName(t.organizationId)} only` : "shared"}`),
    "",
    `STATUSES: ${STATUS_OPTIONS.filter((s) => s.id !== 8).map((s) => `${s.id} ${s.name}`).join(", ")}`,
    `PRIORITIES: ${PRIORITY_LIST.map((p) => `${p.id} ${p.label}`).join(", ")}`,
    "",
    "ITEMS, not archived (id | ref | org | parentId | status | assignees | priority | category | tags | due | updated | title)",
    ...live.map((i) => itemRow(i, L, items)),
  ].join("\n");
  const seen = Object.fromEntries(live.map((i) => [i.id, toMillis(i.updatedAt)]));
  return { text, seen };
}
