// src/lib/boardChat/__tests__/boardFilter.test.js
import { describe, it, expect } from "vitest";
import { planBoardFilter, resolveBoardFilter } from "../boardFilter.js";

const ctx = {
  orgs: [{ id: "unio" }, { id: "vistamar" }],
  items: [{ id: "p1" }, { id: "s1" }],
  users: [{ id: "u1" }, { id: "u2" }],
  categories: [{ id: "c1" }],
  tags: [{ id: "t1" }],
};

describe("resolveBoardFilter", () => {
  it("returns only the fields the call sets", () => {
    const out = resolveBoardFilter({
      orgId: "unio",
      titleSearch: "appt",
      columnFilters: { statusId: [2, 9], assigneeIds: ["u1"], priorityId: [1], categoryId: ["c1"], tagIds: ["t1"] },
      aiFilter: { itemIds: ["p1", "s1"] },
    }, ctx);
    expect(out).toEqual({
      orgFilter: "unio",
      titleSearch: "appt",
      columnFilters: { statusId: [2, 9], assigneeIds: ["u1"], priorityId: [1], categoryId: ["c1"], tagIds: ["t1"] },
      aiFilter: { itemIds: ["p1", "s1"] },
    });
    expect(resolveBoardFilter({ titleSearch: "x" }, ctx)).toEqual({ titleSearch: "x" });
  });

  it("accepts \"all\" and drops empty column arrays", () => {
    expect(resolveBoardFilter({ orgId: "all", columnFilters: { statusId: [], tagIds: ["t1"] } }, ctx))
      .toEqual({ orgFilter: "all", columnFilters: { tagIds: ["t1"] } });
  });

  it("rejects an unknown organization", () => {
    expect(() => resolveBoardFilter({ orgId: "acme" }, ctx)).toThrow("Unknown organization acme");
  });

  it.each([
    ["statusId", [2, 3], "Unknown status 3 in columnFilters.statusId"],
    ["priorityId", [5], "Unknown priority 5 in columnFilters.priorityId"],
    ["assigneeIds", ["u1", "u9"], "Unknown member u9 in columnFilters.assigneeIds"],
    ["categoryId", ["c9"], "Unknown category c9 in columnFilters.categoryId"],
    ["tagIds", ["t9"], "Unknown tag t9 in columnFilters.tagIds"],
  ])("rejects an unknown %s value", (key, values, message) => {
    expect(() => resolveBoardFilter({ columnFilters: { [key]: values } }, ctx)).toThrow(message);
  });

  it("rejects an unknown column filter key", () => {
    expect(() => resolveBoardFilter({ columnFilters: { dueDate: ["x"] } }, ctx)).toThrow("Unknown column filter dueDate");
  });

  it("rejects unknown aiFilter item ids", () => {
    expect(() => resolveBoardFilter({ aiFilter: { itemIds: ["p1", "nope"] } }, ctx)).toThrow("Unknown item ids nope");
  });

  it("rejects an aiFilter with no item ids", () => {
    expect(() => resolveBoardFilter({ aiFilter: { itemIds: [] } }, ctx))
      .toThrow("aiFilter.itemIds is empty — omit aiFilter or use clear");
  });

  it("clear resets every filter, including the scorecard", () => {
    expect(resolveBoardFilter({ clear: true }, ctx)).toEqual({
      orgFilter: "all", titleSearch: "", columnFilters: {}, aiFilter: null, scorecardFilter: null,
    });
  });

  it("clear then sets the fields the same call passes", () => {
    expect(resolveBoardFilter({ clear: true, orgId: "vistamar", columnFilters: { statusId: [5] } }, ctx)).toEqual({
      orgFilter: "vistamar", titleSearch: "", columnFilters: { statusId: [5] }, aiFilter: null, scorecardFilter: null,
    });
  });
});

describe("planBoardFilter", () => {
  const current = { orgFilter: "vistamar", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: null };

  it("makes a view of the merged filters, named by the call's label", () => {
    expect(planBoardFilter({ label: "Appt work", aiFilter: { itemIds: ["p1"] } }, ctx, current)).toEqual({
      kind: "view",
      label: "Appt work",
      filters: { ...current, aiFilter: { itemIds: ["p1"] } },
    });
  });

  it("names an unlabelled view \"Board filter\"", () => {
    expect(planBoardFilter({ titleSearch: "x" }, ctx, current).label).toBe("Board filter");
  });

  it("a clear that sets nothing else is a plain clear", () => {
    expect(planBoardFilter({ clear: true }, ctx, { ...current, titleSearch: "x" })).toEqual({
      kind: "clear",
      filters: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: null },
    });
  });

  it("a clear that also sets a filter is a view", () => {
    const out = planBoardFilter({ clear: true, label: "Done", columnFilters: { statusId: [5] } }, ctx, current);
    expect(out.kind).toBe("view");
    expect(out.filters.columnFilters).toEqual({ statusId: [5] });
    expect(out.filters.orgFilter).toBe("all");
  });

  it("throws on an unknown value", () => {
    expect(() => planBoardFilter({ columnFilters: { statusId: [3] } }, ctx, current)).toThrow("Unknown status 3");
  });
});
