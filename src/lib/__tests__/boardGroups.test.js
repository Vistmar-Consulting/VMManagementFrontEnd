import { describe, expect, it } from "vitest";
import { buildBoardGroups } from "../boardGroups.js";

const summarize = (groups) =>
  Object.fromEntries(
    Object.entries(groups).map(([k, rows]) => [
      k,
      rows.map((r) => `${r.ghost ? "ghost:" : ""}${r.item.id}[${r.subitems.map((s) => s.id).join(",")}]`),
    ]),
  );

describe("buildBoardGroups", () => {
  it("keeps a parent and same-group subitems together", () => {
    const groups = buildBoardGroups(
      [{ id: "p", statusId: 1 }],
      { p: [{ id: "s1", statusId: 2 }] },
    );
    expect(summarize(groups)).toEqual({ active: ["p[s1]"], completed: [], archive: [] });
  });

  it("moves an archived subitem under a ghost parent in Archive", () => {
    const groups = buildBoardGroups(
      [{ id: "p", statusId: 1 }],
      { p: [{ id: "s1", statusId: 2 }, { id: "s2", statusId: 7 }] },
    );
    expect(summarize(groups)).toEqual({ active: ["p[s1]"], completed: [], archive: ["ghost:p[s2]"] });
  });

  it("moves a done subitem under a ghost parent in Completed", () => {
    const groups = buildBoardGroups([{ id: "p", statusId: 1 }], { p: [{ id: "s1", statusId: 5 }] });
    expect(summarize(groups)).toEqual({ active: ["p[]"], completed: ["ghost:p[s1]"], archive: [] });
  });

  it("leaves active subitems under a ghost parent in Active when the parent is archived", () => {
    const groups = buildBoardGroups(
      [{ id: "p", statusId: 7 }],
      { p: [{ id: "s1", statusId: 1 }, { id: "s2", statusId: 7 }] },
    );
    expect(summarize(groups)).toEqual({ active: ["ghost:p[s1]"], completed: [], archive: ["p[s2]"] });
  });
});

describe("buildBoardGroups with a filter", () => {
  it("hides a non-matching parent's own row when it has no matching subitems in its group", () => {
    const groups = buildBoardGroups(
      [{ id: "p", statusId: 1 }],
      { p: [{ id: "s1", statusId: 5 }] },
      () => false,
    );
    expect(summarize(groups)).toEqual({ active: [], completed: ["ghost:p[s1]"], archive: [] });
  });
});
