import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

const postChat = vi.fn();
const runReadTool = vi.fn();
const applyChangeSet = vi.fn();
vi.mock("../../lib/boardChat/api.js", () => ({ postChat: (...a) => postChat(...a) }));
vi.mock("../../lib/boardChat/tools.js", () => ({ runReadTool: (...a) => runReadTool(...a) }));
vi.mock("../../lib/itemWrites.js", () => ({ applyChangeSet: (...a) => applyChangeSet(...a) }));

const { default: BoardChatPanel } = await import("../BoardChatPanel.jsx");

const items = [{ id: "p1", itemNumber: 4, title: "Appt data", organizationId: "unio", parentId: null, statusId: 2, updatedAt: new Date(1000) }];
const toolUse = (id, name, input) => ({ content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use", costUsd: 0.001, model: "m" });
const reply = (text) => ({ content: [{ type: "text", text }], stopReason: "end_turn", costUsd: 0.001, model: "m" });
const propose = (id) => toolUse(id, "propose_changes", { summary: "Rename", ops: [{ op: "update", itemId: "p1", fields: { title: `T${id}` } }] });

function renderPanel() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <BoardChatPanel
        open
        onClose={vi.fn()}
        items={items}
        users={[{ id: "u1", displayName: "Andy" }]}
        orgs={[{ id: "unio", name: "Unio" }]}
        categories={[]}
        tags={[]}
        user={{ uid: "u1", email: "a@x.com" }}
        onApplyFilter={vi.fn()}
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
  postChat.mockReset();
  runReadTool.mockReset();
  applyChangeSet.mockReset();
});

describe("BoardChatPanel", { timeout: 60000 }, () => {
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
});
