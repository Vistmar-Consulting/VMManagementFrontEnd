import { describe, expect, it } from "vitest";
import { agendaTree, removedFromTopic, topicItems, topicTree } from "../topicItems.js";

const items = [
  { id: "p1", organizationId: "unio", categoryId: "web", tagIds: [], order: "a0" },
  { id: "s1", organizationId: "unio", parentId: "p1", order: "a1" },
  { id: "s2", organizationId: "unio", parentId: "p1", order: "a0" },
  { id: "p2", organizationId: "unio", categoryId: "seo", tagIds: ["launch"], order: "a1" },
  { id: "s3", organizationId: "unio", parentId: "p2", order: "a0" },
  { id: "p3", organizationId: "bmd", categoryId: "web", tagIds: [], order: "a0" },
];
const ids = (list) => list.map((it) => it.id);

describe("topicTree", () => {
  it("shows the organization's tasks matching a category or tag, with their subtasks in order", () => {
    const tree = topicTree({ categoryIds: ["web"], tagIds: ["launch"] }, items, "unio");
    expect(ids(tree.parents)).toEqual(["p1", "p2"]);
    expect(ids(tree.subitemsByParent.p1)).toEqual(["s2", "s1"]);
  });

  it("shows nothing without categories or tags", () => {
    expect(topicTree({ categoryIds: [], tagIds: [] }, items, "unio").parents).toEqual([]);
  });

  it("uses the topic's own organization on the master agenda", () => {
    expect(ids(topicTree({ organizationId: "bmd", categoryIds: ["web"] }, items, "vistamar").parents)).toEqual(["p3"]);
  });

  it("a removed task leaves with its subtasks; a removed subtask leaves alone", () => {
    const topic = { categoryIds: ["web"], tagIds: ["launch"], excludedItemIds: ["p2", "s1"] };
    expect(ids(topicItems(topic, items, "unio"))).toEqual(["p1", "s2"]);
  });
});

describe("agendaTree", () => {
  it("counts an item once, and keeps one removed from one card if another shows it", () => {
    const topics = [
      { categoryIds: ["web"], excludedItemIds: ["s1"] },
      { categoryIds: ["web"], tagIds: ["launch"] },
    ];
    const tree = agendaTree(topics, items, "unio");
    expect(ids(tree.parents)).toEqual(["p1", "p2"]);
    expect(ids(tree.subitemsByParent.p1)).toEqual(["s2", "s1"]);
  });
});

describe("removedFromTopic", () => {
  it("lists removed items the topic would show, not deleted or no-longer-matching ones", () => {
    const topic = { categoryIds: ["web"], excludedItemIds: ["s1", "p2", "gone"] };
    expect(ids(removedFromTopic(topic, items, "unio"))).toEqual(["s1"]);
  });

  it("lists a removed subtask only once its task is back on the card", () => {
    const topic = { categoryIds: ["web"], excludedItemIds: ["p1", "s1"] };
    expect(ids(removedFromTopic(topic, items, "unio"))).toEqual(["p1"]);
    expect(ids(removedFromTopic({ ...topic, excludedItemIds: ["s1"] }, items, "unio"))).toEqual(["s1"]);
  });
});
