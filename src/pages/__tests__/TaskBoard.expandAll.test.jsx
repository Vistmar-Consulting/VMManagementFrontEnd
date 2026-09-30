import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { MemoryRouter } from "react-router-dom";

const ITEMS = [
  { id: "p1", title: "Parent One", itemNumber: 1, statusId: 2, order: "a0", organizationId: "unio" },
  { id: "s1", title: "Sub One", itemNumber: 1, statusId: 2, order: "a0", parentId: "p1", organizationId: "unio" },
  { id: "p2", title: "Parent Two", itemNumber: 2, statusId: 2, order: "a1", organizationId: "unio" },
  { id: "s2", title: "Sub Two", itemNumber: 2, statusId: 1, order: "a0", parentId: "p2", organizationId: "unio" },
  { id: "p3", title: "Parent Three", itemNumber: 3, statusId: 5, order: "a2", organizationId: "unio" },
  { id: "s3", title: "Sub Three", itemNumber: 3, statusId: 2, order: "a0", parentId: "p3", organizationId: "unio" },
  { id: "s4", title: "Sub Four", itemNumber: 4, statusId: 5, order: "a1", parentId: "p3", organizationId: "unio" },
];

// jsdom's localStorage is not usable under this Node version; the board's
// useLocalStorage filters need a working Storage.
const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../hooks/useItems.js", () => ({
  useItems: () => ({ data: ITEMS, loading: false, error: null }),
}));
vi.mock("../../hooks/useCollection.js", () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../../hooks/useCollectionGroup.js", () => ({
  useCollectionGroup: () => ({ data: [], loading: false, error: null }),
}));

const { default: TaskBoard } = await import("../TaskBoard.jsx");

function renderBoard() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <TaskBoard />
        </LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const activeGroup = () => screen.getByText("Parent One").closest("table");
const toggleAll = () =>
  within(activeGroup()).getByRole("button", { name: /expand all|collapse all/i });

describe("TaskBoard expand all / collapse all", () => {
  it("expands every parent, then collapses every parent", () => {
    renderBoard();

    fireEvent.click(toggleAll());
    expect(screen.queryByText("Sub One")).toBeTruthy();
    expect(screen.queryByText("Sub Two")).toBeTruthy();
    expect(toggleAll().getAttribute("aria-label")).toBe("Collapse all");

    fireEvent.click(toggleAll());
    expect(screen.queryByText("Sub One")).toBeNull();
    expect(screen.queryByText("Sub Two")).toBeNull();
    expect(screen.queryByText("Sub Three")).toBeNull();
    expect(toggleAll().getAttribute("aria-label")).toBe("Expand all");
  }, 20000);

  it("collapses and re-expands everything while a scorecard is selected", () => {
    renderBoard();
    fireEvent.click(screen.getAllByText("In Progress")[0]);

    // Every visible parent has a matching subitem, so all open by default.
    expect(screen.queryByText("Sub One")).toBeTruthy();
    expect(toggleAll().getAttribute("aria-label")).toBe("Collapse all");

    fireEvent.click(toggleAll());
    expect(toggleAll().getAttribute("aria-label")).toBe("Expand all");
    expect(screen.queryByText("Sub One")).toBeNull();
    expect(screen.queryByText("Sub Three")).toBeNull();

    fireEvent.click(toggleAll());
    expect(screen.queryByText("Sub One")).toBeTruthy();
    expect(toggleAll().getAttribute("aria-label")).toBe("Collapse all");
  }, 20000);

  it("collapses a ghost row without touching its real row", () => {
    renderBoard();
    const ghostRow = within(activeGroup()).getByText("Parent Three").closest("tr");
    expect(screen.queryByText("Sub Three")).toBeTruthy();

    fireEvent.click(within(ghostRow).getAllByRole("button")[0]);
    expect(screen.queryByText("Sub Three")).toBeNull();

    fireEvent.click(screen.getByText("Completed"));
    const realRow = screen.getAllByText("Parent Three")
      .map((el) => el.closest("tr"))
      .find((tr) => tr !== ghostRow);
    fireEvent.click(within(realRow).getAllByRole("button")[0]);
    expect(screen.queryByText("Sub Four")).toBeTruthy();
    expect(screen.queryByText("Sub Three")).toBeNull();
  }, 20000);

  it("clears collapses when the filters change", () => {
    renderBoard();
    const card = () => screen.getAllByText("In Progress")[0];

    fireEvent.click(card());
    fireEvent.click(toggleAll());
    expect(screen.queryByText("Sub One")).toBeNull();
    expect(screen.queryByText("Sub Three")).toBeNull();

    fireEvent.click(card());
    expect(screen.queryByText("Sub Three")).toBeTruthy();

    fireEvent.click(card());
    expect(screen.queryByText("Sub One")).toBeTruthy();
  }, 20000);
});
