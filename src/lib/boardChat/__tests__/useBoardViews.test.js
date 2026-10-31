import { describe, expect, it } from "vitest";
import { applyViewChange, viewsFromDocs } from "../useBoardViews.js";

describe("viewsFromDocs", () => {
  it("orders views as they were added (pending timestamps included) and decodes filters", () => {
    const filters = { orgFilter: "all", columnFilters: { statusId: [5] }, aiFilter: { itemIds: ["p1"] } };
    const out = viewsFromDocs([
      { id: "third", label: "C", filtersJson: "{}", chatId: "c2", order: 3, createdAt: null },
      { id: "second", label: "B", filtersJson: "{}", order: 2, createdAt: null },
      { id: "first", label: "A", filtersJson: JSON.stringify(filters), chatId: "c1", order: 1, createdAt: { toMillis: () => 5 }, request: "A tasks" },
    ]);
    expect(out.map((v) => v.id)).toEqual(["first", "second", "third"]);
    expect(out[0]).toEqual({ id: "first", label: "A", request: "A tasks", filters, chatId: "c1", createdAtMs: 5, refreshedAtMs: null });
    expect(out[1].chatId).toBeNull();
  });
});

describe("applyViewChange", () => {
  const v = (id) => ({ id });

  it("adds and removes what the board changed", () => {
    const out = applyViewChange([v("a"), v("b")], [v("a"), v("b")], [v("a"), v("c")]);
    expect(out.views.map((x) => x.id)).toEqual(["a", "c"]);
    expect([...out.removed]).toEqual(["b"]);
    expect(out.added.map((x) => x.id)).toEqual(["c"]);
  });

  it("keeps a view another tab added after the board last rendered", () => {
    const out = applyViewChange([v("a"), v("other")], [v("a")], []);
    expect(out.views.map((x) => x.id)).toEqual(["other"]);
    expect([...out.removed]).toEqual(["a"]);
  });
});
