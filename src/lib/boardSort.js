import { tsToDate } from "../utils/firestoreTime.js";

// Task Board multi-column sort. `sorts` is an ordered array of
// { field, direction }; earlier entries take precedence, later ones break ties.

// Sorting a column that is already in the stack changes its direction in
// place; a new column is appended as the lowest-priority tiebreaker.
export function applySort(sorts, field, direction) {
  if (sorts.some((s) => s.field === field)) {
    return sorts.map((s) => (s.field === field ? { field, direction } : s));
  }
  return [...sorts, { field, direction }];
}

export function removeSort(sorts, field) {
  return sorts.filter((s) => s.field !== field);
}

function sortValue(item, field, categoryNameById) {
  switch (field) {
    case "title": return (item.title || "").toLowerCase();
    case "id": return item.itemNumber ?? Infinity;
    case "statusId":
    case "priorityId": return item[field] ?? 999;
    case "dueDate": return item.dueDate ? tsToDate(item.dueDate).getTime() : Infinity;
    case "updatedAt": return item.updatedAt ? tsToDate(item.updatedAt).getTime() : 0;
    case "createdAt": return item.createdAt ? tsToDate(item.createdAt).getTime() : 0;
    // Sort categories by NAME (the visible label), not by raw id —
    // raw ids are numeric-string sequences and produce nonsense order.
    case "categoryId": return categoryNameById.get(item.categoryId) || "zzz";
    default: return item[field] ?? "";
  }
}

export function sortItems(items, sorts, { categoryNameById = new Map() } = {}) {
  if (sorts.length === 0) return items;
  return [...items].sort((a, b) => {
    for (const { field, direction } of sorts) {
      const av = sortValue(a, field, categoryNameById);
      const bv = sortValue(b, field, categoryNameById);
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
    }
    return 0;
  });
}
