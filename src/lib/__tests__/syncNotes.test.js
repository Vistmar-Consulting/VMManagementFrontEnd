import { describe, it, expect } from "vitest";
import { IN_MEETING_TAG, IN_MEETING_TAG_FIELDS, SYNC_NOTE_SOURCES, attendeeNames, syncNoteBody, withInMeetingTag } from "../syncNotes.js";

const meeting = { title: "Unio Biweekly", date: "2026-10-28", people: ["Bill", "Dana Lee"] };

describe("syncNoteBody", () => {
  it("create: why, then meeting and people", () => {
    expect(syncNoteBody("create", { why: "The hero still shows last year's offer.", meeting })).toBe(
      "The hero still shows last year's offer.\nMeeting: Unio Biweekly · 2026-10-28\nDiscussed by: Bill, Dana Lee",
    );
  });
  it("move: leads with the new status and reason", () => {
    expect(syncNoteBody("move", { toStatus: "Done", reason: "Bill said it shipped.", meeting })).toBe(
      "Moved to Done: Bill said it shipped.\nMeeting: Unio Biweekly · 2026-10-28\nDiscussed by: Bill, Dana Lee",
    );
  });
  it("note: the note text", () => {
    expect(syncNoteBody("note", { note: "Client wants two options.", meeting: { title: "", date: "", people: [] } })).toBe("Client wants two options.");
  });
  it("omits lines it doesn't know and tolerates a missing meeting", () => {
    expect(syncNoteBody("create", { why: "W", meeting: { title: "", date: "2026-10-28", people: [" ", "Bill"] } })).toBe(
      "W\nMeeting: 2026-10-28\nDiscussed by: Bill",
    );
    expect(syncNoteBody("move", { toStatus: "Review", reason: "" })).toBe("Moved to Review");
    expect(syncNoteBody("create", { why: "" })).toBe("");
  });
});

describe("attendeeNames", () => {
  it("prefers display names, adds unnamed participants, drops the notetaker and duplicates", () => {
    const row = {
      meeting_attendees: [
        { email: "bill@unio.com", displayName: "Bill" },
        { email: "fred@fireflies.ai", displayName: "Fireflies Notetaker" },
        { email: "dana@unio.com", displayName: "" },
      ],
      participants: ["bill@unio.com", "Scot@vistamarconsulting.com", "fred@fireflies.ai", "bill@unio.com"],
    };
    expect(attendeeNames(row)).toEqual(["Bill", "dana@unio.com", "scot@vistamarconsulting.com"]);
  });
  it("handles a row with no attendee data", () => {
    expect(attendeeNames({})).toEqual([]);
    expect(attendeeNames(undefined)).toEqual([]);
  });
});

describe("in-meeting tag", () => {
  it("adds the tag once, keeping the reviewer's picks", () => {
    expect(withInMeetingTag(["website"])).toEqual(["website", IN_MEETING_TAG]);
    expect(withInMeetingTag([IN_MEETING_TAG, "website"])).toEqual([IN_MEETING_TAG, "website"]);
    expect(withInMeetingTag(undefined)).toEqual([IN_MEETING_TAG]);
  });
  it("is a shared tag whose id is its name", () => {
    expect(IN_MEETING_TAG).toBe("in-meeting");
    expect(IN_MEETING_TAG_FIELDS).toMatchObject({ name: IN_MEETING_TAG, organizationId: null });
  });
  it("labels both sync sources", () => {
    expect(SYNC_NOTE_SOURCES["sync-meeting"]).toBe("Sync Meeting");
    expect(SYNC_NOTE_SOURCES["board-sync"]).toBe("Board Sync");
  });
});
