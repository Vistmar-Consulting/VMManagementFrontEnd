import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

const postChat = vi.fn();
const runReadTool = vi.fn();
const applyChangeSet = vi.fn();
vi.mock("../../lib/boardChat/api.js", () => ({ postChat: (...a) => postChat(...a) }));
vi.mock("../../lib/boardChat/tools.js", () => ({ runReadTool: (...a) => runReadTool(...a) }));
vi.mock("../../lib/itemWrites.js", () => ({ applyChangeSet: (...a) => applyChangeSet(...a) }));

// jsdom's localStorage is not usable under this Node version; the panel
// persists its conversation there.
const store = new Map();
vi.stubGlobal("localStorage", {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

const { default: BoardChatPanel } = await import("../BoardChatPanel.jsx");
const { planBoardFilter } = await import("../../lib/boardChat/boardFilter.js");

const items = [
  { id: "p1", itemNumber: 4, title: "Appt data", organizationId: "unio", parentId: null, statusId: 2, updatedAt: new Date(1000) },
  { id: "p2", itemNumber: 5, title: "Schema", organizationId: "unio", parentId: null, statusId: 2, updatedAt: new Date(1000) },
];
const users = [{ id: "u1", displayName: "Andy" }];
const orgs = [{ id: "unio", name: "Unio" }];
// The tool_result the model received in postChat call n (0-based).
const toolResultIn = (n) => postChat.mock.calls[n][0].at(-1).content[0];
const toolUse = (id, name, input) => ({ content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", costUsd: 0.001, model: "m" });
const reply = (text) => ({ content: [{ type: "text", text }], stopReason: "end_turn", costUsd: 0.001, model: "m" });
const propose = (id) => toolUse(id, "propose_changes", { summary: "Rename", ops: [{ op: "update", itemId: "p1", fields: { title: `T${id}` } }] });

function renderPanel({ onApplyFilter = vi.fn() } = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <BoardChatPanel
        open
        onClose={vi.fn()}
        items={items}
        users={users}
        orgs={orgs}
        categories={[]}
        tags={[]}
        user={{ uid: "u1", email: "a@x.com" }}
        onApplyFilter={onApplyFilter}
      />
    </ThemeProvider>,
  );
}

function ask(text) {
  const box = screen.getByPlaceholderText("Ask Board Chat…");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

beforeEach(() => {
  store.clear();
  postChat.mockReset();
  runReadTool.mockReset();
  applyChangeSet.mockReset();
});

describe("BoardChatPanel", { timeout: 60000 }, () => {
  it("the ? button opens the hints", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "How to use Board Chat" }));
    expect(await screen.findByText("Filter views")).toBeTruthy();
    expect(screen.getByText(/does not read Fireflies/)).toBeTruthy();
  });

  it("a read tool's null updatedAt does not replace the snapshot baseline", async () => {
    runReadTool.mockResolvedValue({ result: {}, seen: { p1: null } });
    postChat.mockResolvedValueOnce(toolUse("a", "get_item", { itemId: "p1" })).mockResolvedValueOnce(propose("b"));
    renderPanel();
    ask("rename it");
    expect(await screen.findByText("Review changes")).toBeTruthy();
    expect(screen.queryByText(/changed since Claude last read it/i)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "I-4 Appt data" }).checked).toBe(true);
  });

  it("shows the model-call cap notice", async () => {
    runReadTool.mockResolvedValue({ result: {}, seen: {} });
    postChat.mockImplementation(async () => toolUse(`t${postChat.mock.calls.length}`, "get_item", { itemId: "p1" }));
    renderPanel();
    ask("loop");
    expect(await screen.findByText("Stopped after 10 model calls — ask again to continue.")).toBeTruthy();
    expect(postChat).toHaveBeenCalledTimes(10);
  });

  it("a later proposal opens with fresh checkboxes", async () => {
    postChat
      .mockResolvedValueOnce(propose("a"))
      .mockResolvedValueOnce(propose("b"))
      .mockResolvedValueOnce(reply("ok"));
    renderPanel();
    ask("rename it");
    fireEvent.click(await screen.findByRole("checkbox", { name: "I-4 Appt data" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const box = await screen.findByRole("checkbox", { name: "I-4 Appt data" });
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("ok")).toBeTruthy();
    const cancelled = JSON.parse(postChat.mock.calls[1][0].at(-1).content[0].content);
    expect(cancelled.applied).toEqual([]);
  });

  it("reports exactly the ticked rows as applied and the unticked row as declined", async () => {
    applyChangeSet.mockResolvedValue([]);
    postChat
      .mockResolvedValueOnce(toolUse("a", "propose_changes", { summary: "Rename two", ops: [
        { op: "update", itemId: "p1", fields: { title: "One" } },
        { op: "update", itemId: "p2", fields: { title: "Two" } },
      ] }))
      .mockResolvedValueOnce(reply("done"));
    renderPanel();
    ask("rename both");
    fireEvent.click(await screen.findByRole("checkbox", { name: "I-5 Schema" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("done")).toBeTruthy();
    expect(applyChangeSet.mock.calls[0][0]).toEqual([{ kind: "update", itemId: "p1", patch: { title: "One" } }]);
    const result = JSON.parse(toolResultIn(1).content);
    expect(result.applied).toEqual([{ index: 0, op: "update", item: "I-4 Appt data", newValues: { title: "One" } }]);
    expect(result.declined).toEqual([{ index: 1, op: "update", why: "unticked by the user" }]);
  });

  it("reports a created item's new values, with the completedAt sentinel stripped", async () => {
    applyChangeSet.mockResolvedValue([{ tempId: "t1", itemId: "n1", ref: "I-7" }]);
    postChat
      .mockResolvedValueOnce(toolUse("a", "propose_changes", { summary: "Add one", ops: [
        { op: "create", tempId: "t1", orgId: "unio", fields: { title: "New", statusId: 5, assigneeIds: ["u1"] } },
      ] }))
      .mockResolvedValueOnce(reply("done"));
    renderPanel();
    ask("add it");
    fireEvent.click(await screen.findByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("done")).toBeTruthy();
    expect(JSON.parse(toolResultIn(1).content).applied).toEqual([{
      index: 0, op: "create", title: "New", tempId: "t1", itemId: "n1", ref: "I-7",
      newValues: { title: "New", statusId: 5, assigneeIds: ["u1"] }, completedAt: "now",
    }]);
  });

  it("shows an Apply failure; Cancel then returns an is_error result", async () => {
    applyChangeSet.mockRejectedValue(new Error("Item p1 no longer exists"));
    postChat.mockResolvedValueOnce(propose("a")).mockResolvedValueOnce(reply("sorry"));
    renderPanel();
    ask("rename it");
    fireEvent.click(await screen.findByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("Item p1 no longer exists")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("sorry")).toBeTruthy();
    expect(toolResultIn(1)).toMatchObject({ is_error: true, content: "Apply failed: Item p1 no longer exists" });
  });

  it("an unknown status in set_board_filter is an is_error result and sets nothing", async () => {
    const applyPlan = vi.fn();
    const current = { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: null };
    const onApplyFilter = (input) => applyPlan(planBoardFilter(input, { orgs, items, users, categories: [], tags: [] }, current));
    postChat
      .mockResolvedValueOnce(toolUse("a", "set_board_filter", { columnFilters: { statusId: [3] } }))
      .mockResolvedValueOnce(reply("no such status"));
    renderPanel({ onApplyFilter });
    ask("show on hold");
    expect(await screen.findByText("no such status")).toBeTruthy();
    expect(toolResultIn(1)).toMatchObject({ is_error: true, content: "Unknown status 3 in columnFilters.statusId" });
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it("the conversation and draft come back after leaving the page; the model keeps its history", async () => {
    postChat.mockResolvedValueOnce(reply("first answer"));
    const first = renderPanel();
    ask("first question");
    expect(await screen.findByText("first answer")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Ask Board Chat…"), { target: { value: "half-typed" } });
    first.unmount();

    postChat.mockResolvedValueOnce(reply("second answer"));
    renderPanel();
    expect(screen.getByText("first question")).toBeTruthy();
    expect(screen.getByText("first answer")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask Board Chat…").value).toBe("half-typed");
    ask("follow-up");
    expect(await screen.findByText("second answer")).toBeTruthy();
    const sent = postChat.mock.calls[1][0];
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(sent[2].content).toBe("follow-up");
  });

  it("a turn cut off by leaving the page comes back marked interrupted, outside the model history", async () => {
    postChat.mockReturnValueOnce(new Promise(() => {}));
    const first = renderPanel();
    ask("slow question");
    expect(await screen.findByText("Thinking…")).toBeTruthy();
    first.unmount();

    postChat.mockResolvedValueOnce(reply("fresh"));
    renderPanel();
    expect(screen.getByText("Interrupted when you left the page — ask again.")).toBeTruthy();
    ask("again");
    expect(await screen.findByText("fresh")).toBeTruthy();
    // No history was stored, so this is a first message again: snapshot + text.
    expect(postChat.mock.calls[1][0]).toHaveLength(1);
  });

  it("New chat clears the stored conversation", async () => {
    postChat.mockResolvedValueOnce(reply("an answer"));
    const first = renderPanel();
    ask("q");
    expect(await screen.findByText("an answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    first.unmount();
    renderPanel();
    expect(screen.queryByText("an answer")).toBeNull();
    expect(store.size).toBe(0);
  });
});
