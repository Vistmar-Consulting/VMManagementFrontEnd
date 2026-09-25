// Task Board search + column-filter predicate. Values within one column are
// ORed; every active column and the title search are ANDed together.
export function buildItemMatcher({ titleSearch = "", columnFilters = {} }) {
  const q = titleSearch.trim().toLowerCase();
  const activeCols = Object.entries(columnFilters).filter(([, v]) => v && v.length > 0);
  return (item) => {
    if (q) {
      const title = (item.title || "").toLowerCase();
      const desc = (item.description || "").toLowerCase();
      if (!title.includes(q) && !desc.includes(q)) return false;
    }
    for (const [field, values] of activeCols) {
      if (field === "assigneeIds") {
        if (!(item.assigneeIds || []).some((id) => values.includes(id))) return false;
      } else if (field === "tagIds") {
        if (!(item.tagIds || []).some((id) => values.includes(id))) return false;
      } else if (!values.includes(item[field])) {
        return false;
      }
    }
    return true;
  };
}
