import { describe, expect, it } from "vitest";
import { boardItemPath, planBoardFocus } from "../boardFocus.js";
import { STATUS } from "../../constants/itemStatuses.js";

const items = [
  { id: "p1", organizationId: "unio", statusId: STATUS.DONE },
  { id: "s1", parentId: "p1", organizationId: "unio", statusId: 2 },
  { id: "s2", parentId: "p1", organizationId: "unio", statusId: STATUS.DONE },
  { id: "p2", organizationId: "bmd", statusId: STATUS.ARCHIVE },
];

describe("planBoardFocus", () => {
  it("returns null for an item that no longer exists", () => {
    expect(planBoardFocus(items, "gone", "all")).toBeNull();
  });

  it("leaves the org filter alone on All or the item's org, and switches it otherwise", () => {
    expect(planBoardFocus(items, "p2", "all").orgFilter).toBeNull();
    expect(planBoardFocus(items, "p2", "bmd").orgFilter).toBeNull();
    expect(planBoardFocus(items, "p2", "unio").orgFilter).toBe("bmd");
  });

  it("opens a top-level item's own group", () => {
    expect(planBoardFocus(items, "p2", "all")).toEqual({ orgFilter: null, groupKey: "archive", parentRow: null });
  });

  it("expands a subtask's parent: the ghost copy when the subtask is in another group", () => {
    expect(planBoardFocus(items, "s1", "all")).toMatchObject({ groupKey: "active", parentRow: { id: "p1", ghost: true } });
    expect(planBoardFocus(items, "s2", "all")).toMatchObject({ groupKey: "completed", parentRow: { id: "p1", ghost: false } });
  });

  it("uses the parent's org for a subtask", () => {
    expect(planBoardFocus(items, "s1", "bmd").orgFilter).toBe("unio");
  });

  it("builds the board link", () => {
    expect(boardItemPath("a b")).toBe("/board?item=a%20b");
  });
});
