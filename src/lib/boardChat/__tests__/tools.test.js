// src/lib/boardChat/__tests__/tools.test.js
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../firebase.js", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}),
  getDocs: async () => ({ docs: [{ data: () => ({ authorId: "u1", body: "Done with import", createdAt: new Date(2026, 9, 20) }) }] }),
}));
const listMeetings = vi.fn();
vi.mock("../../meetingsApi.js", () => ({ listMeetings: (...a) => listMeetings(...a) }));

const { runReadTool } = await import("../tools.js");

const items = [
  { id: "p1", parentId: null, itemNumber: 4, title: "Appointment data", description: "Load into db", statusId: 2, organizationId: "unio", updatedAt: new Date(1000) },
  { id: "s1", parentId: "p1", itemNumber: 1, title: "Import", statusId: 5, organizationId: "unio", updatedAt: new Date(2000) },
  { id: "z1", parentId: null, itemNumber: 9, title: "Appointment archive", statusId: 7, organizationId: "unio", updatedAt: new Date(3000) },
];
const ctx = {
  items,
  lookups: { userName: (id) => id, orgName: (id) => id, categoryName: (id) => id, tagName: (id) => id },
};

describe("runReadTool", () => {
  it("get_item returns detail, subtasks, comments and seen", async () => {
    const out = await runReadTool("get_item", { itemId: "p1" }, ctx);
    expect(out.result.description).toBe("Load into db");
    expect(out.result.subtasks).toHaveLength(1);
    expect(out.result.subtasks[0].ref).toBe("I-4/SI-1");
    expect(out.result.recentComments[0].body).toBe("Done with import");
    expect(out.seen).toEqual({ p1: 1000, s1: 2000 });
  });

  it("get_item throws for an unknown id", async () => {
    await expect(runReadTool("get_item", { itemId: "x" }, ctx)).rejects.toThrow("No item");
  });

  it("search_items matches every word and respects includeArchived", async () => {
    const live = await runReadTool("search_items", { query: "appointment", includeArchived: false }, ctx);
    expect(live.result.total).toBe(1);
    const all = await runReadTool("search_items", { query: "appointment", includeArchived: true }, ctx);
    expect(all.result.total).toBe(2);
  });

  it("list_meetings trims the API shape", async () => {
    listMeetings.mockResolvedValue({ meetings: [{ title: "BMD sync", date: "2026-10-21T17:00:00Z", end_date: "2026-10-21T17:30:00Z", attendees: [{ email: "a@x.com" }], event_id: "e" }] });
    const out = await runReadTool("list_meetings", { startDate: "2026-10-21", endDate: "2026-10-21" }, ctx);
    expect(out.result.meetings).toEqual([{ title: "BMD sync", start: "2026-10-21T17:00:00Z", end: "2026-10-21T17:30:00Z", attendees: ["a@x.com"] }]);
    const arg = listMeetings.mock.calls[0][0];
    expect(new Date(arg.start).getDate()).toBe(21);
  });
});
