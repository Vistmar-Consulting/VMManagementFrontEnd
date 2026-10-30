import { describe, expect, it } from "vitest";
import { coinedTagOrg, isSharedTag, tagGroupsForItem, tagsForOrg } from "../tagScope.js";

const tags = [
  { id: "email" },
  { id: "urgent", organizationId: null },
  { id: "careers", organizationId: "id-care" },
  { id: "hipaa", organizationId: "vistamar" },
];
const ids = (list) => list.map((t) => t.id);

describe("tag scope", () => {
  it("a tag with no organization is shared", () => {
    expect(isSharedTag(tags[0])).toBe(true);
    expect(isSharedTag(tags[1])).toBe(true);
    expect(isSharedTag(tags[2])).toBe(false);
  });

  it("a client sees shared tags and its own; All sees every tag", () => {
    expect(ids(tagsForOrg(tags, "id-care"))).toEqual(["email", "urgent", "careers"]);
    expect(ids(tagsForOrg(tags, "unio"))).toEqual(["email", "urgent"]);
    expect(ids(tagsForOrg(tags, "all"))).toEqual(ids(tags));
    expect(ids(tagsForOrg(tags, null))).toEqual(ids(tags));
  });

  it("an item's picker groups shared, own, and other tags it already has", () => {
    expect(tagGroupsForItem(tags, "id-care", []).map((g) => [g.label, ids(g.tags)])).toEqual([
      ["Shared tags", ["email", "urgent"]],
      ["Client tags", ["careers"]],
    ]);
    expect(tagGroupsForItem(tags, "unio", ["hipaa"]).map((g) => g.label)).toEqual(["Shared tags", "Other tags on this item"]);
  });

  it("a coined tag belongs to the one org that coined it, else it is shared", () => {
    expect(coinedTagOrg(new Set(["unio"]))).toBe("unio");
    expect(coinedTagOrg(new Set(["unio", "id-care"]))).toBeNull();
    expect(coinedTagOrg(new Set([null]))).toBeNull();
  });
});
