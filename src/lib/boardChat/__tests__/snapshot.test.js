// src/lib/boardChat/__tests__/snapshot.test.js
import { describe, it, expect } from "vitest";
import { buildBoardSnapshot, itemRef, memberName, priorityName, statusName, toMillis, ymd } from "../snapshot.js";

const users = [{ id: "u1", displayName: "Andy Deemer", email: "a@vistamarconsulting.com" }, { id: "u2", firstName: "Scot", lastName: "R", email: "s@x.com" }];
const orgs = [{ id: "unio", name: "Unio" }];
const categories = [{ id: "c1", name: "Data" }];
const tags = [{ id: "t1", name: "hipaa" }];
const items = [
  { id: "p1", itemNumber: 4, title: "Appointment data", organizationId: "unio", parentId: null, statusId: 2, assigneeIds: ["u1"], priorityId: 2, categoryId: "c1", tagIds: ["t1"], dueDate: new Date(2026, 9, 24), updatedAt: new Date(1000) },
  { id: "s1", itemNumber: 1, title: "Import script", organizationId: "unio", parentId: "p1", statusId: 5, assigneeIds: ["u2"], updatedAt: new Date(2000) },
  { id: "z1", itemNumber: 9, title: "Old thing", organizationId: "unio", parentId: null, statusId: 7, updatedAt: new Date(3000) },
];

describe("snapshot helpers", () => {
  it("formats refs, names, dates", () => {
    expect(itemRef(items[0])).toBe("I-4");
    expect(itemRef(items[1])).toBe("SI-1");
    expect(memberName(users[1])).toBe("Scot R");
    expect(ymd(new Date(2026, 9, 24))).toBe("2026-10-24");
    expect(toMillis({ toMillis: () => 5 })).toBe(5);
    expect(toMillis(null)).toBeNull();
  });
});

describe("status and priority names", () => {
  it("names known ids and returns the raw id for unknown ones", () => {
    expect(statusName(2)).toBe("In Progress");
    expect(statusName(42)).toBe("42");
    expect(priorityName(2)).toBe("High");
    expect(priorityName(42)).toBe("42");
    expect(priorityName(null)).toBe("");
  });
});

describe("buildBoardSnapshot", () => {
  const snap = buildBoardSnapshot({ items, users, orgs, categories, tags });
  it("lists live items with readable values and excludes archived", () => {
    expect(snap.text).toContain("p1 | I-4 | Unio | - | In Progress | Andy Deemer | High | Data | hipaa | 2026-10-24 |");
    expect(snap.text).toContain("s1 | SI-1 | Unio | p1 | Done | Scot R |");
    expect(snap.text).not.toContain("Old thing");
  });
  it("lists members with ids for writes", () => {
    expect(snap.text).toContain("u1 | Andy Deemer | a@vistamarconsulting.com");
  });
  it("records what the model saw", () => {
    expect(snap.seen).toEqual({ p1: 1000, s1: 2000 });
  });
});
