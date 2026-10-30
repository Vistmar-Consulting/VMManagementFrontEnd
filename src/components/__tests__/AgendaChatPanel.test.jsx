import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

const postChat = vi.fn();
const applyAgendaPlan = vi.fn();
const writeTopicBodies = vi.fn();
const flushAll = vi.fn();
const provider = { synced: true, getYDoc: () => "ydoc" };
vi.mock("../../lib/boardChat/api.js", () => ({ postChat: (...a) => postChat(...a) }));
vi.mock("../../lib/agendaChat/apply.js", () => ({ applyAgendaPlan: (...a) => applyAgendaPlan(...a) }));
vi.mock("../editor/topicBodyYjs.js", () => ({ writeTopicBodies: (...a) => writeTopicBodies(...a) }));
vi.mock("../editor/CollabFlushRegistry.jsx", () => ({ useCollabFlushRegistry: () => ({ flushAll }) }));
vi.mock("../../lib/liveblocks.js", () => ({ useRoom: () => ({}), useOthers: () => [] }));
vi.mock("@liveblocks/yjs", () => ({ getYjsProviderForRoom: () => provider }));

// jsdom's localStorage is not usable under this Node version.
const store = new Map();
vi.stubGlobal("localStorage", {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

const { default: AgendaChatPanel } = await import("../AgendaChatPanel.jsx");

const topics = [
  { id: "t1", name: "Website", bodyHtml: "<p>old</p>", sortOrder: 1, updatedAt: new Date(100) },
  { id: "t2", name: "Tools", bodyHtml: "<p>tools</p>", sortOrder: 2, updatedAt: new Date(100) },
];
const agenda = { title: "BMD - Biweekly", openFloorHtml: "", firefliesTitles: [], updatedAt: new Date(100) };
const toolUse = (input) => ({ content: [{ type: "tool_use", id: "x1", name: "propose_agenda_changes", input }], stopReason: "tool_use", costUsd: 0.001, model: "m" });
const reply = (text) => ({ content: [{ type: "text", text }], stopReason: "end_turn", costUsd: 0.001, model: "m" });
const toolResult = (n) => JSON.parse(postChat.mock.calls[n][0].at(-1).content[0].content);

function renderPanel() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <AgendaChatPanel
        open onClose={vi.fn()} agendaId="ag1" agenda={agenda} topics={topics} isMaster={false}
        orgs={[{ id: "bmd", name: "Bryn Mawr" }]} orgName="Bryn Mawr" organizationId="bmd"
        items={[]} users={[{ id: "u1", displayName: "Andy" }]} user={{ uid: "u1", email: "a@x.com" }}
      />
    </ThemeProvider>,
  );
}

function ask(text) {
  const box = screen.getByPlaceholderText("Ask Agenda Chat…");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

beforeEach(() => {
  store.clear();
  [postChat, applyAgendaPlan, writeTopicBodies, flushAll].forEach((f) => f.mockReset());
  provider.synced = true;
});

describe("AgendaChatPanel", { timeout: 60000 }, () => {
  it("sends the agenda as context on the first message, to the agenda-chat route", async () => {
    postChat.mockResolvedValueOnce(reply("hi"));
    renderPanel();
    ask("what's on?");
    expect(await screen.findByText("hi")).toBeTruthy();
    const [messages, route] = postChat.mock.calls[0];
    expect(route).toBe("agenda-chat");
    expect(messages[0].content[0].text).toContain("--- TOPIC 1 | id t1 | Website\n<p>old</p>");
    expect(messages[0].content[1].text).toBe("what's on?");
  });

  it("applies the ticked changes, writes live bodies, and reports them to the model", async () => {
    postChat
      .mockResolvedValueOnce(toolUse({ summary: "Update Website", ops: [
        { op: "update_topic", topicId: "t1", bodyHtml: "<p>new body</p>", reason: "pasted" },
        { op: "delete_topic", topicId: "t2", reason: "asked" },
      ] }))
      .mockResolvedValueOnce(reply("Done."));
    applyAgendaPlan.mockResolvedValue([]);
    renderPanel();
    ask("Update Website with: new body; drop Tools");
    expect(await screen.findByText("Review agenda changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Delete topic “Tools”" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(flushAll).toHaveBeenCalled();
    const [agendaId, plan, uid] = applyAgendaPlan.mock.calls[0];
    expect(agendaId).toBe("ag1");
    expect(uid).toBe("u1");
    expect(plan.updates).toEqual([{ id: "t1", patch: { bodyHtml: "<p>new body</p>" } }]);
    expect(plan.deletes).toEqual([]);
    expect(writeTopicBodies).toHaveBeenCalledWith("ydoc", { t1: "<p>new body</p>" });
    const result = toolResult(1);
    expect(result.applied).toEqual([{ index: 0, op: "update_topic", topic: "Website" }]);
    expect(result.declined).toEqual([{ index: 1, op: "delete_topic", why: "unticked by the user" }]);
  });

  it("returns a created topic's id to the model", async () => {
    postChat
      .mockResolvedValueOnce(toolUse({ summary: "Add", ops: [{ op: "create_topic", name: "Budget", reason: "asked" }] }))
      .mockResolvedValueOnce(reply("Added."));
    applyAgendaPlan.mockResolvedValue(["newTopic1"]);
    renderPanel();
    ask("add a Budget topic");
    expect(await screen.findByText("Review agenda changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("Added.")).toBeTruthy();
    expect(toolResult(1).applied).toEqual([{ index: 0, op: "create_topic", topic: "Budget", topicId: "newTopic1" }]);
  });

  it("re-shows the review when a ticked topic changed while it was open", async () => {
    postChat.mockResolvedValueOnce(toolUse({ summary: "s", ops: [{ op: "update_topic", topicId: "t1", name: "Site", reason: "r" }] }));
    const view = renderPanel();
    ask("rename");
    expect(await screen.findByText("Review agenda changes")).toBeTruthy();
    const edited = topics.map((tp) => (tp.id === "t1" ? { ...tp, updatedAt: new Date(999) } : tp));
    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <AgendaChatPanel
          open onClose={vi.fn()} agendaId="ag1" agenda={agenda} topics={edited} isMaster={false}
          orgs={[{ id: "bmd", name: "Bryn Mawr" }]} orgName="Bryn Mawr" organizationId="bmd"
          items={[]} users={[{ id: "u1", displayName: "Andy" }]} user={{ uid: "u1", email: "a@x.com" }}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText(/Changed by someone else while you were reviewing: Website/)).toBeTruthy();
    expect(applyAgendaPlan).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Rename “Website” to “Site”" }).checked).toBe(false);
  });

  it("refuses to apply while the live editor is disconnected, writing nothing", async () => {
    provider.synced = false;
    postChat.mockResolvedValueOnce(toolUse({ summary: "s", ops: [{ op: "update_topic", topicId: "t1", name: "Site", reason: "r" }] }));
    renderPanel();
    ask("rename");
    expect(await screen.findByText("Review agenda changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(await screen.findByText("Live editor not connected — reload the agenda and retry.")).toBeTruthy();
    expect(applyAgendaPlan).not.toHaveBeenCalled();
  });

  it("Cancel reports every op as declined", async () => {
    postChat
      .mockResolvedValueOnce(toolUse({ summary: "s", ops: [{ op: "update_topic", topicId: "t1", name: "Site", reason: "r" }] }))
      .mockResolvedValueOnce(reply("ok, left it"));
    renderPanel();
    ask("rename");
    expect(await screen.findByText("Review agenda changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("ok, left it")).toBeTruthy();
    expect(toolResult(1)).toEqual({ applied: [], declined: "all — the user cancelled the review" });
  });
});
