// src/lib/boardChat/taxonomy.js
//
// Tag and category ops in a Board Chat / Agenda Chat proposal: create,
// update, delete. Pure. A create carries a tempId that items (and agenda
// topics) in the same proposal may use as a tag or category id; the real id
// is assigned at Apply (lib/itemWrites.js applyChangeSet).
//
// ctx: { tags: [{ id, name, organizationId }], categories: [{ id, name }],
//        orgIds: Set, items }
export const TAXONOMY_OPS = ["create_tag", "update_tag", "delete_tag", "create_category", "update_category", "delete_category"];

const HEX = /^#[0-9a-f]{6}$/i;
const norm = (s) => String(s || "").trim().toLowerCase();

function color(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`Color "${value}" is not a #rrggbb hex color`);
  return value.toLowerCase();
}

function name(value, what) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`A ${what} needs a name`);
  return value.trim();
}

// "shared" (or omitted on create) = a Shared Tag; an organization id = that
// client's own tag (lib/tagScope.js).
function scope(value, ctx) {
  if (value === undefined || value === "shared") return null;
  if (!ctx.orgIds.has(value)) throw new Error(`Organization ${value} not found`);
  return value;
}

// One row per taxonomy op, or null for any other op. `taken` collects the
// names created or renamed so far, so two ops can't both claim one name.
export function buildTaxonomyRow(op, index, ctx, taken) {
  const base = { index, op: op.op, reason: op.reason, ok: true, error: null, stale: false };
  const isTag = op.op.endsWith("_tag");
  const what = isTag ? "tag" : "category";
  const list = isTag ? ctx.tags : ctx.categories;
  const idKey = isTag ? "tagId" : "categoryId";
  // A tag name is unique within its scope; a category name across the board.
  const key = (n, org) => (isTag ? `${org ?? "shared"}:${norm(n)}` : norm(n));
  const nameTaken = (n, org, exceptId) => taken.has(key(n, org))
    || list.some((x) => x.id !== exceptId && key(x.name, isTag ? x.organizationId ?? null : null) === key(n, org));

  if (op.op.startsWith("create_")) {
    const n = name(op.name, what);
    const org = isTag ? scope(op.tagScope, ctx) : null;
    if (!op.tempId) throw new Error(`A new ${what} needs a tempId`);
    if (nameTaken(n, org)) throw new Error(`A ${what} named "${n}" already exists${isTag ? (org ? " for that organization" : " among shared tags") : ""}`);
    taken.add(key(n, org));
    const fields = { name: n, ...(color(op.color) ? { color: color(op.color) } : {}), ...(isTag ? { organizationId: org } : {}) };
    return { ...base, kind: what, tempId: op.tempId, fields };
  }

  const current = list.find((x) => x.id === op[idKey]);
  if (!current) throw new Error(`${isTag ? "Tag" : "Category"} ${op[idKey] || "(none)"} not found`);

  if (op.op.startsWith("delete_")) {
    const used = isTag
      ? ctx.items.filter((i) => (i.tagIds || []).includes(current.id)).length
      : ctx.items.filter((i) => i.categoryId === current.id).length;
    return { ...base, kind: what, [idKey]: current.id, targetId: current.id, name: current.name, usedBy: used };
  }

  // update
  const patch = {};
  if (op.name !== undefined) patch.name = name(op.name, what);
  if (op.color !== undefined) patch.color = color(op.color);
  if (isTag && op.tagScope !== undefined) patch.organizationId = scope(op.tagScope, ctx);
  const curOrg = current.organizationId ?? null;
  const diffs = Object.keys(patch)
    .filter((f) => (f === "organizationId" ? (patch[f] ?? null) !== curOrg : patch[f] !== current[f]))
    .map((f) => ({ field: f, before: f === "organizationId" ? curOrg : current[f] ?? null, after: patch[f] }));
  if (diffs.length === 0) throw new Error("No change from the current values");
  const nextName = patch.name ?? current.name;
  const nextOrg = isTag ? (patch.organizationId !== undefined ? patch.organizationId : curOrg) : null;
  if ((patch.name !== undefined || patch.organizationId !== undefined) && nameTaken(nextName, nextOrg, current.id)) {
    throw new Error(`A ${what} named "${nextName}" already exists${isTag ? " in that scope" : ""}`);
  }
  taken.add(key(nextName, nextOrg));
  return { ...base, kind: what, [idKey]: current.id, targetId: current.id, name: current.name, patch, diffs };
}

// The tags and categories items may use once the valid taxonomy rows apply:
// existing ones (less deletes) plus creates by tempId. `pendingTags` /
// `pendingCategories` map a tempId to its row index, so an item that uses one
// is skipped if that create is left unticked.
export function taxonomyAfter(rows, ctx) {
  const ok = rows.filter((r) => r && r.ok);
  const deletedTags = new Map(ok.filter((r) => r.op === "delete_tag").map((r) => [r.targetId, r.index]));
  const deletedCats = new Map(ok.filter((r) => r.op === "delete_category").map((r) => [r.targetId, r.index]));
  const newTags = ok.filter((r) => r.op === "create_tag");
  const newCats = ok.filter((r) => r.op === "create_category");
  const scopeUpdates = new Map(ok.filter((r) => r.op === "update_tag" && r.patch.organizationId !== undefined).map((r) => [r.targetId, r.patch.organizationId]));
  return {
    tags: [
      ...ctx.tags.filter((t) => !deletedTags.has(t.id)).map((t) => (scopeUpdates.has(t.id) ? { ...t, organizationId: scopeUpdates.get(t.id) } : t)),
      ...newTags.map((r) => ({ id: r.tempId, name: r.fields.name, organizationId: r.fields.organizationId })),
    ],
    categoryIds: new Set([...ctx.categories.filter((c) => !deletedCats.has(c.id)).map((c) => c.id), ...newCats.map((r) => r.tempId)]),
    deletedTags,
    deletedCats,
    pendingTags: new Map(newTags.map((r) => [r.tempId, r.index])),
    pendingCategories: new Map(newCats.map((r) => [r.tempId, r.index])),
  };
}
