import { describe, expect, it } from "vitest";
import { buildItemMatcher } from "../boardFilters.js";

const items = [
  { id: "1", statusId: 1, priorityId: 1, assigneeIds: ["a"], tagIds: ["t1"], categoryId: "c1", title: "Alpha" },
  { id: "2", statusId: 1, priorityId: 2, assigneeIds: ["b"], tagIds: ["t2"], categoryId: "c1", title: "Beta" },
  { id: "3", statusId: 2, priorityId: 1, assigneeIds: ["a", "b"], tagIds: [], categoryId: "c2", title: "Gamma" },
  { id: "4", statusId: 2, priorityId: 2, assigneeIds: [], tagIds: ["t1", "t2"], categoryId: "c2", title: "Delta" },
];
const matching = (opts) => items.filter(buildItemMatcher(opts)).map((i) => i.id);

describe("buildItemMatcher", () => {
  it("matches everything with no filters", () => {
    expect(matching({})).toEqual(["1", "2", "3", "4"]);
  });

  it("ORs values within one column", () => {
    expect(matching({ columnFilters: { priorityId: [1, 2] } })).toEqual(["1", "2", "3", "4"]);
  });

  it("ANDs across columns", () => {
    expect(matching({ columnFilters: { statusId: [1], priorityId: [1] } })).toEqual(["1"]);
  });

  it("ANDs array columns with scalar columns", () => {
    expect(matching({ columnFilters: { assigneeIds: ["a"], categoryId: ["c2"], tagIds: ["t1", "t2"] } })).toEqual([]);
    expect(matching({ columnFilters: { assigneeIds: ["b"], tagIds: ["t2"] } })).toEqual(["2"]);
  });

  it("ignores empty column filters", () => {
    expect(matching({ columnFilters: { statusId: [], priorityId: [2] } })).toEqual(["2", "4"]);
  });

  it("ANDs column filters with the title search", () => {
    expect(matching({ titleSearch: "ta", columnFilters: { statusId: [2] } })).toEqual(["4"]);
  });
});
