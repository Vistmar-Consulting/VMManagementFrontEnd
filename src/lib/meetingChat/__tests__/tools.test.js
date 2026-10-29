// src/lib/meetingChat/__tests__/tools.test.js
import { describe, expect, it, vi } from "vitest";
import { runMeetingReadTool, topicTasks, transcriptText } from "../tools.js";

const items = [
  { id: "p1", itemNumber: 1, organizationId: "bmd", categoryId: "web", statusId: 2, title: "Site", assigneeIds: ["u1"] },
  { id: "s1", itemNumber: 1, organizationId: "bmd", parentId: "p1", statusId: 1, title: "Copy" },
  { id: "p2", itemNumber: 2, organizationId: "bmd", tagIds: ["seo"], statusId: 7, title: "Archived" },
  { id: "p3", itemNumber: 3, organizationId: "unio", categoryId: "web", statusId: 2, title: "Other org" },
];
const topic = { id: "t1", name: "Website", categoryIds: ["web"], tagIds: ["seo"] };

describe("topicTasks", () => {
  it("matches the topic's categories/tags in its org, with subtasks, without archived items", () => {
    expect(topicTasks(topic, items, "bmd").map((i) => i.id)).toEqual(["p1", "s1"]);
    expect(topicTasks({ ...topic, categoryIds: [], tagIds: [] }, items, "bmd")).toEqual([]);
  });
});

describe("transcriptText", () => {
  const sentences = ["a", "b", "budget talk", "c", "d", "e", "f", "g", "budget again"].map((text, i) => ({ text, speaker_name: "S", start_time: i * 60 }));
  it("returns every line without a query", () => {
    expect(transcriptText(sentences, "").lines).toHaveLength(9);
    expect(transcriptText(sentences, "").lines[2]).toBe("[2:00] S: budget talk");
  });
  it("returns only the lines around matches, gaps marked", () => {
    const out = transcriptText(sentences, "Budget");
    expect(out.matches).toBe(2);
    expect(out.lines.map((l) => l.split(": ")[1] ?? l)).toEqual(["a", "b", "budget talk", "c", "d", "…", "f", "g", "budget again"]);
  });
});

describe("runMeetingReadTool", () => {
  const source = {
    list: vi.fn().mockResolvedValue({ transcripts: [
      { id: "m1", title: "BMD - Biweekly", date: Date.UTC(2026, 9, 1), duration: 30 },
      { id: "m2", title: "bmd - biweekly ", date: Date.UTC(2026, 9, 15), duration: 31 },
      { id: "m3", title: "Other", date: Date.UTC(2026, 9, 20), duration: 5 },
    ] }),
    detail: vi.fn().mockResolvedValue({ transcript: { summary: { overview: "We decided X" } } }),
    sentences: vi.fn().mockResolvedValue({ transcript: { sentences: [{ text: "hello", speaker_name: "A", start_time: 0 }] } }),
  };
  const ctx = {
    agenda: { firefliesTitles: ["BMD - Biweekly"], openFloorHtml: "" },
    topics: [topic], orgs: [], isMaster: false, items, organizationId: "bmd",
    lookups: { userName: (id) => (id === "u1" ? "Andy" : id) }, source,
  };

  it("lists only linked meetings, newest first", async () => {
    const { result } = await runMeetingReadTool("list_past_meetings", {}, ctx);
    expect(result.meetings.map((m) => m.meetingId)).toEqual(["m2", "m1"]);
  });

  it("reads a linked meeting's summary and refuses an unlinked one", async () => {
    const { result } = await runMeetingReadTool("get_meeting_summary", { meetingId: "m1" }, ctx);
    expect(result.summary.overview).toBe("We decided X");
    await expect(runMeetingReadTool("get_meeting_summary", { meetingId: "m3" }, ctx)).rejects.toThrow("not one of this agenda's linked meetings");
  });

  it("lists a topic's tasks with owners", async () => {
    const { result } = await runMeetingReadTool("list_topic_tasks", { topicId: "t1" }, ctx);
    expect(result.tasks).toEqual([
      { ref: "I-1", title: "Site", status: "In Progress", owners: ["Andy"], due: null },
      { ref: "I-1/SI-1", title: "Copy", status: "Assigned", owners: [], due: null },
    ]);
  });

  it("get_agenda returns the live topics", async () => {
    const { result } = await runMeetingReadTool("get_agenda", {}, ctx);
    expect(result.topics).toEqual([{ topicId: "t1", title: "Website", bodyHtml: "" }]);
  });
});
