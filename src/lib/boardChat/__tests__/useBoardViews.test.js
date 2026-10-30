import { describe, expect, it } from "vitest";
import { viewsFromDocs } from "../useBoardViews.js";

describe("viewsFromDocs", () => {
  it("orders views oldest first, a view still saving last, and decodes filters", () => {
    const at = (ms) => ({ toMillis: () => ms });
    const filters = { orgFilter: "all", columnFilters: { statusId: [5] }, aiFilter: { itemIds: ["p1"] } };
    const out = viewsFromDocs([
      { id: "saving", label: "C", filtersJson: "{}", chatId: "c2", createdAt: null },
      { id: "second", label: "B", filtersJson: "{}", createdAt: at(2) },
      { id: "first", label: "A", filtersJson: JSON.stringify(filters), chatId: "c1", createdAt: at(1) },
    ]);
    expect(out.map((v) => v.id)).toEqual(["first", "second", "saving"]);
    expect(out[0]).toEqual({ id: "first", label: "A", filters, chatId: "c1" });
    expect(out[1].chatId).toBeNull();
  });
});
