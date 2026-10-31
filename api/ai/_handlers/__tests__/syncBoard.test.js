import { describe, it, expect, vi } from "vitest";
import { BOARD_SYNC_EMAIL as FE_EMAIL } from "../../../../src/lib/boardSyncCore.js";
import { IN_MEETING_TAG as FE_IN_MEETING_TAG } from "../../../../src/lib/syncNotes.js";
import { IN_MEETING_TAG } from "../../_lib/boardRules.js";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const { BOARD_SYNC_EMAIL, isBoardSyncAllowed, buildSystem, buildUserMessage, normalizeBoardChanges } = await import("../syncBoard.js");

describe("access gate", () => {
  it("server and FE constants match", () => expect(BOARD_SYNC_EMAIL).toBe(FE_EMAIL));
  it("server and FE in-meeting tag ids match", () => expect(IN_MEETING_TAG).toBe(FE_IN_MEETING_TAG));
  it("allows only Andy", () => {
    expect(isBoardSyncAllowed("adeemer@vistamarconsulting.com")).toBe(true);
    expect(isBoardSyncAllowed("scot@vistamarconsulting.com")).toBe(false);
    expect(isBoardSyncAllowed(undefined)).toBe(false);
  });
});

describe("handler", () => {
  it("returns 403 for a signed-in non-Andy account before any model call", async () => {
    vi.resetModules();
    vi.doMock("../../../meetings/_lib/auth.js", () => ({
      requireAuth: async (req) => { req.authUser = { email: "hugo@vistamarconsulting.com" }; return true; },
    }));
    vi.doMock("../../../meetings/_lib/cors.js", () => ({ applyCors: () => false }));
    const { default: handler } = await import("../syncBoard.js");
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method: "POST", headers: {}, body: { org: { slug: "unio" } } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("buildSystem", () => {
  const base = { orgPrompt: "Org prompt {{meetingStyle}}", categories: [{ slug: "website", name: "Website", description: "", sop: "" }], tagVocab: [{ name: "hipaa" }] };
  it("client: no Vistamar scope block, no agenda output, style filled", () => {
    const s = buildSystem({ ...base, org: { slug: "unio", name: "Unio", type: "client" } });
    expect(s).not.toContain("## SCOPE — what belongs on the Vistamar board");
    expect(s).toContain("You are NOT writing a meeting agenda");
    expect(s).toContain("Org prompt working");
    expect(s).not.toContain("topicIndex");
  });
  it("client: internal Vistamar meetings are new sources, only this org's parts", () => {
    const s = buildSystem({ ...base, org: { slug: "unio", name: "Unio", type: "client" } });
    expect(s).toContain("CONTEXT-ONLY transcripts are meetings already synced for this org.");
    expect(s).toContain("internal Vistamar meetings");
  });
  it("vistamar: includes scope block", () => {
    const s = buildSystem({ ...base, org: { slug: "vistamar", name: "Vistamar", type: "internal" } });
    expect(s).toContain("## SCOPE — what belongs on the Vistamar board");
  });
});

describe("buildUserMessage", () => {
  it("separates NEW and CONTEXT transcripts and flags cross-org", () => {
    const m = buildUserMessage({
      org: { slug: "unio", name: "Unio" },
      transcripts: [
        { title: "Touch Base", date: "2026-10-26", scope: "cross-org", overview: "o", actionItems: "a" },
        { title: "Platform dev", date: "2026-10-20", scope: "vistamar-internal", overview: "x", actionItems: "" },
      ],
      contextTranscripts: [{ title: "Unio weekly", date: "2026-10-01", scope: "already-synced", sharedFrom: "", overview: "y", actionItems: "" }],
      projectBoard: [], existingTasks: [{ id: "i1", title: "Fix hero", status: "Assigned" }], orgAgendas: [], extraContext: "Blog A published",
    });
    const newIdx = m.indexOf("## NEW meeting transcripts");
    const ctxIdx = m.indexOf("## CONTEXT-ONLY transcripts");
    expect(newIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeGreaterThan(newIdx);
    expect(m).toContain("Touch Base (2026-10-26) [cross-org — take only Unio's parts]");
    expect(m).toContain("Platform dev (2026-10-20) [Vistamar internal — take only Unio's parts]");
    expect(m.indexOf("Platform dev")).toBeLessThan(ctxIdx);
    expect(m).toContain("[Already synced] Unio weekly (2026-10-01)");
    expect(m).toContain("[itemId:i1] Fix hero [Assigned]");
    expect(m).toContain("Blog A published");
  });
  it("lists each transcript's attendees", () => {
    const m = buildUserMessage({
      org: { slug: "unio", name: "Unio" },
      transcripts: [{ title: "Unio weekly", date: "2026-10-28", scope: "this-org", attendees: ["Bill", "Dana Lee"], overview: "o", actionItems: "" }],
    });
    expect(m).toContain("### Unio weekly (2026-10-28)\nAttendees: Bill, Dana Lee\nOverview: o");
  });
});

describe("buildSystem — provenance + in-meeting", () => {
  const org = { slug: "unio", name: "Unio", type: "client" };
  it("asks for meeting provenance and never the in-meeting tag", () => {
    const s = buildSystem({ orgPrompt: "", org, categories: [{ slug: "website", name: "Website", description: "", sop: "" }], tagVocab: [{ name: "in-meeting" }, { name: "hipaa" }] });
    expect(s).toContain("Where each change came from");
    expect(s).toContain("Never invent a name.");
    expect(s).toContain('Never use or coin the tag "in-meeting"');
    expect(s).toContain("## Tag vocabulary\nhipaa");
  });
});

describe("buildUserMessage — synced cross-org", () => {
  it("keeps the cross-org suffix on an already-synced Touch Base", () => {
    const m = buildUserMessage({
      org: { slug: "unio", name: "Unio" }, transcripts: [],
      contextTranscripts: [
        { title: "Touch Base", date: "2026-10-26", scope: "already-synced", sharedFrom: "cross-org", overview: "o", actionItems: "" },
        { title: "Platform dev", date: "2026-10-20", scope: "already-synced", sharedFrom: "vistamar-internal", overview: "x", actionItems: "" },
      ],
    });
    expect(m).toContain("[Already synced] Touch Base (2026-10-26) [cross-org — take only Unio's parts]");
    expect(m).toContain("[Already synced] Platform dev (2026-10-20) [Vistamar internal — take only Unio's parts]");
  });
});

describe("buildSystem — categories", () => {
  const org = { slug: "unio", name: "Unio", type: "client" };
  it("omits the categories section when there are none", () => {
    const s = buildSystem({ orgPrompt: "", org, categories: [], tagVocab: [] });
    expect(s).not.toContain("## Categories");
    expect(s).not.toContain("(none)\n\n## Tag");
  });
  it("tells the model to use exactly one slug", () => {
    const s = buildSystem({ orgPrompt: "", org, categories: [{ slug: "website", name: "Website", description: "", sop: "" }], tagVocab: [] });
    expect(s).toContain("an array with exactly ONE category SLUG");
  });
});

describe("normalizeBoardChanges", () => {
  it("coerces and drops incomplete rows", () => {
    const out = normalizeBoardChanges({
      boardChanges: {
        creates: [{ title: "T", note: "n", categories: ["seo", 3], tags: ["x"] }, { title: "", note: "n" }],
        moves: [{ itemId: "i1", title: "a", toStatus: "Done", reason: "r" }, { itemId: "", toStatus: "Done" }],
        notes: [{ itemId: "i1", title: "a", note: "z" }, { itemId: "i1", note: "" }],
      },
    });
    expect(out.creates).toEqual([{ title: "T", note: "n", why: "", meeting: { title: "", date: "", people: [] }, parentRef: "", categories: ["seo", "3"], tags: ["x"] }]);
    expect(out.moves).toHaveLength(1);
    expect(out.notes).toHaveLength(1);
  });
  it("keeps each change's meeting and why, and strips the app's in-meeting tag", () => {
    const meeting = { title: "Unio weekly", date: "2026-10-28", people: [" Bill ", "", "Cedric"] };
    const out = normalizeBoardChanges({
      boardChanges: {
        creates: [{ title: "T", note: "Owner: Bill", why: "Hero is stale", meeting, categories: [], tags: ["In-Meeting", "website"] }],
        moves: [{ itemId: "i1", title: "a", toStatus: "Done", reason: "r", meeting }],
        notes: [{ itemId: "i1", title: "a", note: "z", meeting }],
      },
    });
    const clean = { title: "Unio weekly", date: "2026-10-28", people: ["Bill", "Cedric"] };
    expect(out.creates[0]).toMatchObject({ why: "Hero is stale", meeting: clean, tags: ["website"] });
    expect(out.moves[0].meeting).toEqual(clean);
    expect(out.notes[0].meeting).toEqual(clean);
  });
  it("tolerates a missing boardChanges", () => {
    expect(normalizeBoardChanges({})).toEqual({ creates: [], moves: [], notes: [] });
  });
});
