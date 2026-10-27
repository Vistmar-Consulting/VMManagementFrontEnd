// src/lib/boardChat/boardFilter.js
//
// Board Chat's set_board_filter → the Task Board state to set. Pure. Every id
// is checked against what the board has loaded, so a bad call errors back to
// the model instead of silently showing nothing; on any error nothing changes.
// Returned fields that are undefined keep their current value.
import { STATUS_OPTIONS } from "../../constants/itemStatuses.js";
import { PRIORITY_LIST } from "../../constants/itemPriorities.js";

const COLUMN_LABEL = {
  statusId: "status",
  assigneeIds: "member",
  priorityId: "priority",
  categoryId: "category",
  tagIds: "tag",
};

function knownIds({ users, categories, tags }) {
  return {
    statusId: new Set(STATUS_OPTIONS.map((s) => s.id)),
    assigneeIds: new Set(users.map((u) => u.id)),
    priorityId: new Set(PRIORITY_LIST.map((p) => p.id)),
    categoryId: new Set(categories.map((c) => c.id)),
    tagIds: new Set(tags.map((t) => t.id)),
  };
}

export function resolveBoardFilter(input, { orgs, items, users, categories, tags }) {
  const { clear, orgId, titleSearch, columnFilters, aiFilter } = input;

  if (orgId !== undefined && orgId !== "all" && !orgs.some((o) => o.id === orgId)) {
    throw new Error(`Unknown organization ${orgId}`);
  }

  let cols;
  if (columnFilters) {
    const known = knownIds({ users, categories, tags });
    cols = {};
    for (const [key, values] of Object.entries(columnFilters)) {
      if (!known[key]) throw new Error(`Unknown column filter ${key}`);
      const bad = values.filter((v) => !known[key].has(v));
      if (bad.length) throw new Error(`Unknown ${COLUMN_LABEL[key]} ${bad.join(", ")} in columnFilters.${key}`);
      if (values.length > 0) cols[key] = values;
    }
  }

  let ai;
  if (aiFilter) {
    if (aiFilter.itemIds.length === 0) throw new Error("aiFilter.itemIds is empty — omit aiFilter or use clear");
    const itemIds = new Set(items.map((i) => i.id));
    const bad = aiFilter.itemIds.filter((id) => !itemIds.has(id));
    if (bad.length) throw new Error(`Unknown item ids ${bad.join(", ")}`);
    ai = { label: aiFilter.label, ids: new Set(aiFilter.itemIds) };
  }

  const base = clear
    ? { orgFilter: "all", titleSearch: "", columnFilters: {}, aiFilter: null, scorecardFilter: null }
    : {};
  return {
    ...base,
    ...(orgId !== undefined ? { orgFilter: orgId } : {}),
    ...(titleSearch !== undefined ? { titleSearch } : {}),
    ...(cols ? { columnFilters: cols } : {}),
    ...(ai ? { aiFilter: ai } : {}),
  };
}

// Resolve first, then set: an unknown id throws before any setter runs.
export function applyBoardFilter(input, ctx, set) {
  const next = resolveBoardFilter(input, ctx);
  if (next.orgFilter !== undefined) set.setOrgFilter(next.orgFilter);
  if (next.titleSearch !== undefined) set.setTitleSearch(next.titleSearch);
  if (next.columnFilters !== undefined) set.setColumnFilters(next.columnFilters);
  if (next.scorecardFilter !== undefined) set.setScorecardFilter(next.scorecardFilter);
  if (next.aiFilter !== undefined) set.setAiFilter(next.aiFilter);
  return { applied: true, aiFilterCount: next.aiFilter ? next.aiFilter.ids.size : null };
}
