// src/lib/boardChat/__tests__/refreshView.test.js
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../firebase.js", () => ({ db: {} }));
vi.mock("../../meetingsApi.js", () => ({ listMeetings: vi.fn() }));
const { refreshView, requestFromChat } = await import("../refreshView.js");

const board = {
  items: [{ id: "p1", title: "One", statusId: 2, organizationId: "unio" }, { id: "p2", title: "Two", statusId: 2, organizationId: "unio" }],
  users: [{ id: "u1", displayName: "Andy" }],
  orgs: [{ id: "unio", name: "Unio" }],
  categories: [],
  tags: [],
};
const user = { uid: "u1", email: "a@x.com" };
const toolUse = (name, input) => ({ content: [{ type: "tool_use", id: "t", name, input }], stopReason: "tool_use", costUsd: 0.01, model: "m" });
const text = (t) => ({ content: [{ type: "text", text: t }], stopReason: "end_turn", costUsd: 0.01, model: "m" });

describe("requestFromChat", () => {
  it("finds the last message that made the view", () => {
    const entries = [
      { user: "show unio", steps: ["Filtered board: Unio"] },
      { user: "only in progress", steps: ["Read I-1", "Filtered board: Unio"] },
      { user: "thanks", steps: [] },
    ];
    expect(requestFromChat(entries, "Unio")).toBe("only in progress");
    expect(requestFromChat(entries, "Other")).toBeNull();
    expect(requestFromChat(undefined, "Unio")).toBeNull();
  });
});

describe("refreshView", () => {
  it("returns the filters of the one set_board_filter call, from a clean board state", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(toolUse("set_board_filter", { label: "Mine", aiFilter: { itemIds: ["p2"] } }))
      .mockResolvedValueOnce(text("Now just Two."));
    const out = await refreshView({ label: "Mine", request: "my open tasks", board, user, post });
    expect(out.filters).toEqual({ orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["p2"] } });
    expect(out.reply).toBe("Now just Two.");
    expect(out.costUsd).toBeCloseTo(0.02);
    expect(post.mock.calls[0][0][0].content[0].text).toMatch(/^BOARD CONTEXT/);
  });

  it("refuses changes and fails when no filter was set", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce(toolUse("propose_changes", { summary: "s", ops: [] }))
      .mockResolvedValueOnce(text("I can't."));
    await expect(refreshView({ label: "Mine", request: "x", board, user, post })).rejects.toThrow("didn't set a filter");
    const result = post.mock.calls[1][0].at(-1).content[0];
    expect(result).toMatchObject({ is_error: true, content: "Not available while refreshing a view." });
  });
});
