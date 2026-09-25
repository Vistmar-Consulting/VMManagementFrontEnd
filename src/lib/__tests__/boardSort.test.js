import { describe, expect, it } from "vitest";
import { applySort, removeSort, sortItems } from "../boardSort.js";

const ids = (items) => items.map((i) => i.id);

describe("applySort", () => {
  it("appends a new column as the lowest-priority sort", () => {
    const sorts = applySort([{ field: "statusId", direction: "asc" }], "priorityId", "desc");
    expect(sorts).toEqual([
      { field: "statusId", direction: "asc" },
      { field: "priorityId", direction: "desc" },
    ]);
  });

  it("changes direction of an already-sorted column without moving it", () => {
    const sorts = applySort(
      [{ field: "statusId", direction: "asc" }, { field: "priorityId", direction: "asc" }],
      "statusId",
      "desc",
    );
    expect(sorts).toEqual([
      { field: "statusId", direction: "desc" },
      { field: "priorityId", direction: "asc" },
    ]);
  });
});

describe("removeSort", () => {
  it("drops the column and keeps the others in order", () => {
    const sorts = removeSort(
      [{ field: "a", direction: "asc" }, { field: "b", direction: "asc" }, { field: "c", direction: "desc" }],
      "b",
    );
    expect(sorts).toEqual([{ field: "a", direction: "asc" }, { field: "c", direction: "desc" }]);
  });
});

describe("sortItems", () => {
  const items = [
    { id: "1", statusId: 2, priorityId: 3, title: "b" },
    { id: "2", statusId: 1, priorityId: 2, title: "a" },
    { id: "3", statusId: 2, priorityId: 1, title: "c" },
    { id: "4", statusId: 1, priorityId: 2, title: "d" },
  ];

  it("returns the input order when no sorts are set", () => {
    expect(ids(sortItems(items, []))).toEqual(["1", "2", "3", "4"]);
  });

  it("breaks ties on the first sort with the second", () => {
    const sorts = [{ field: "statusId", direction: "asc" }, { field: "priorityId", direction: "desc" }];
    expect(ids(sortItems(items, sorts))).toEqual(["2", "4", "1", "3"]);
  });

  it("applies a third sort when the first two tie", () => {
    const sorts = [
      { field: "statusId", direction: "asc" },
      { field: "priorityId", direction: "asc" },
      { field: "title", direction: "desc" },
    ];
    expect(ids(sortItems(items, sorts))).toEqual(["4", "2", "3", "1"]);
  });

  it("sorts categories by name, not id", () => {
    const cats = [{ id: "1", categoryId: "c1" }, { id: "2", categoryId: "c2" }];
    const categoryNameById = new Map([["c1", "zeta"], ["c2", "alpha"]]);
    const sorted = sortItems(cats, [{ field: "categoryId", direction: "asc" }], { categoryNameById });
    expect(ids(sorted)).toEqual(["2", "1"]);
  });

  it("does not mutate the input array", () => {
    const input = [...items];
    sortItems(input, [{ field: "title", direction: "desc" }]);
    expect(ids(input)).toEqual(["1", "2", "3", "4"]);
  });
});
