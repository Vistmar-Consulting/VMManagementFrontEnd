import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));

const created = [];
vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  deleteDoc: vi.fn(),
  doc: () => ({ id: "new-id" }),
  runTransaction: async (_db, fn) =>
    fn({ get: async () => ({ data: () => ({}) }), set: (_ref, data) => created.push(data), update: vi.fn() }),
  serverTimestamp: () => null,
  updateDoc: vi.fn(),
  writeBatch: () => ({ delete: vi.fn(), commit: vi.fn() }),
}));

const { default: MiniProjectBoard } = await import("../MiniProjectBoard.jsx");
const { topicTree } = await import("../../lib/topicItems.js");
const TOPIC = { id: "t1", categoryIds: ["c1"], tagIds: [] };

const ORG = "unio";
const ITEMS = [
  { id: "p1", title: "Parent One", itemNumber: 1, statusId: 2, order: "a0", organizationId: ORG, categoryId: "c1", assigneeIds: [] },
  { id: "s1", title: "Sub Andy", itemNumber: 1, statusId: 2, order: "a0", parentId: "p1", organizationId: ORG, assigneeIds: ["andy"] },
  { id: "s2", title: "Sub Scot", itemNumber: 2, statusId: 2, order: "a1", parentId: "p1", organizationId: ORG, assigneeIds: ["scot"] },
  { id: "p2", title: "Parent Two", itemNumber: 2, statusId: 2, order: "a1", organizationId: ORG, categoryId: "c1", assigneeIds: ["andy"] },
  { id: "p3", title: "Parent Three", itemNumber: 3, statusId: 2, order: "a2", organizationId: ORG, categoryId: "c1", assigneeIds: ["scot"] },
];

function renderBoard(assigneeFilterId) {
  const ui = (id) => (
    <ThemeProvider theme={createTheme()}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <MiniProjectBoard
          topic={TOPIC}
          agendaId="a1"
          organizationId={ORG}
          items={ITEMS}
          {...topicTree(TOPIC, ITEMS, ORG)}
          users={[]}
          categories={[]}
          tags={[]}
          assigneeFilterIds={id ? [id] : null}
        />
      </LocalizationProvider>
    </ThemeProvider>
  );
  const result = render(ui(assigneeFilterId), { wrapper: MemoryRouter });
  return { ...result, setFilter: (id) => result.rerender(ui(id)) };
}

const rowOf = (title) => screen.getByText(title).closest("tr");

describe("MiniProjectBoard attendee filter", () => {
  it("shows every parent collapsed when no attendee is selected", () => {
    renderBoard(null);
    expect(screen.queryByText("Parent Three")).toBeTruthy();
    expect(screen.queryByText("Sub Andy")).toBeNull();
  }, 60000);

  it("filters, dims and expands like the Task Board Assigned filter", () => {
    renderBoard("andy");
    expect(screen.queryByText("Parent Three")).toBeNull();
    expect(screen.queryByText("Sub Andy")).toBeTruthy();
    expect(screen.queryByText("Sub Scot")).toBeNull();
    expect(getComputedStyle(rowOf("Parent One")).opacity).toBe("0.5");
    expect(getComputedStyle(rowOf("Parent Two")).opacity).not.toBe("0.5");
  }, 60000);

  it("lets a filtered parent be collapsed, and re-opens it on the next filter", () => {
    const { setFilter } = renderBoard("andy");
    fireEvent.click(rowOf("Parent One").querySelector("button"));
    expect(screen.queryByText("Sub Andy")).toBeNull();

    setFilter("scot");
    expect(screen.queryByText("Sub Scot")).toBeTruthy();
    expect(screen.queryByText("Parent Two")).toBeNull();
  }, 60000);

  it("assigns items created under the filter to the selected attendee", async () => {
    created.length = 0;
    renderBoard("andy");
    fireEvent.click(screen.getByText("+ New Item"));
    fireEvent.click(screen.getAllByText(/Add subtask/i)[0]);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created.map((d) => d.assigneeIds)).toEqual([["andy"], ["andy"]]);
  }, 60000);
});

function renderFocus(scorecardKey, items = ITEMS) {
  const ui = (list) => (
    <ThemeProvider theme={createTheme()}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <MiniProjectBoard
          topic={TOPIC}
          agendaId="a1"
          organizationId={ORG}
          items={list}
          {...topicTree(TOPIC, list, ORG)}
          users={[]}
          categories={[]}
          tags={[]}
          scorecardKey={scorecardKey}
        />
      </LocalizationProvider>
    </ThemeProvider>
  );
  const result = render(ui(items), { wrapper: MemoryRouter });
  return { ...result, setItems: (list) => result.rerender(ui(list)) };
}

describe("MiniProjectBoard Meeting Focus filter", () => {
  it("keeps a row edited out of the selected status in view", () => {
    const { setItems } = renderFocus("status-2");
    fireEvent.click(within(rowOf("Parent Two")).getByText("In Progress"));
    fireEvent.click(screen.getAllByText("Done").at(-1));
    setItems(ITEMS.map((it) => (it.id === "p2" ? { ...it, statusId: 5 } : it)));
    expect(screen.queryByText("Parent Two")).toBeTruthy();
  }, 60000);

  it("offers + New Item when no row matches the selected status", () => {
    renderFocus("status-5");
    expect(screen.queryByText("+ New Item")).toBeTruthy();
  }, 60000);
});

describe("MiniProjectBoard Remove from topic", () => {
  const renderRemovable = (topic, handlers) => render(
    <ThemeProvider theme={createTheme()}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <MiniProjectBoard
          topic={topic}
          agendaId="a1"
          organizationId={ORG}
          items={ITEMS}
          {...topicTree(topic, ITEMS, ORG)}
          removedItems={ITEMS.filter((it) => (topic.excludedItemIds || []).includes(it.id))}
          categories={[]}
          tags={[]}
          {...handlers}
        />
      </LocalizationProvider>
    </ThemeProvider>,
    { wrapper: MemoryRouter },
  );

  it("removes a row from the topic through its menu", () => {
    const onRemoveFromTopic = vi.fn();
    renderRemovable(TOPIC, { onRemoveFromTopic, onRestoreToTopic: vi.fn() });
    const buttons = rowOf("Parent Two").querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(screen.getByText("Remove from topic"));
    expect(onRemoveFromTopic).toHaveBeenCalledWith(expect.objectContaining({ id: "p2" }));
  }, 60000);

  it("hides a removed task and lists it with Restore", () => {
    const onRestoreToTopic = vi.fn();
    renderRemovable({ ...TOPIC, excludedItemIds: ["p2"] }, { onRemoveFromTopic: vi.fn(), onRestoreToTopic });
    expect(screen.queryByText("Parent Two")).toBeNull();
    fireEvent.click(screen.getByText("1 removed from this topic · Show"));
    expect(screen.getByText("Parent Two")).toBeTruthy();
    fireEvent.click(screen.getByText("Restore"));
    expect(onRestoreToTopic).toHaveBeenCalledWith(expect.objectContaining({ id: "p2" }));
  }, 60000);
});
