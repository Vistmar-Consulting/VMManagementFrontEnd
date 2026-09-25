import { describe, it, expect } from "vitest";
import { STATUS_OPTIONS, STATUS_SORT_RANK } from "../itemStatuses.js";
import { PRIORITY_LIST, PRIORITY_SORT_RANK } from "../itemPriorities.js";

const byRank = (rank) => (a, b) => rank[a] - rank[b];

describe("STATUS_SORT_RANK", () => {
  it("orders statuses the same as the status dropdown, not by raw id", () => {
    const ids = STATUS_OPTIONS.map((s) => s.id);
    expect([...ids].sort((a, b) => a - b).sort(byRank(STATUS_SORT_RANK))).toEqual(ids);
  });
});

describe("PRIORITY_SORT_RANK", () => {
  it("orders priorities the same as the priority dropdown", () => {
    const ids = PRIORITY_LIST.map((p) => p.id);
    expect([...ids].reverse().sort(byRank(PRIORITY_SORT_RANK))).toEqual(ids);
  });
});
