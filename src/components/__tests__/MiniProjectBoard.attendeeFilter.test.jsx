import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";

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
          topic={{ id: "t1", categoryIds: ["c1"], tagIds: [] }}
          agendaId="a1"
          organizationId={ORG}
          items={ITEMS}
          users={[]}
          categories={[]}
          tags={[]}
          assigneeFilterId={id}
        />
      </LocalizationProvider>
    </ThemeProvider>
  );
  const result = render(ui(assigneeFilterId));
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
