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
  useCollection: (path) => ({ data: path === "organizations" ? [{ id: "unio", name: "Unio" }] : [], loading: false, error: null }),
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


const VIEWS_KEY = "vm-board-chat-views";
const viewA = {
  id: "va", label: "Parent one work",
  filters: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["p1"] } },
};
const viewB = {
  id: "vb", label: "Parent two work",
  filters: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["p2"] } },
};
const seed = (store) => {
  localStorage.clear();
  localStorage.setItem(VIEWS_KEY, JSON.stringify(store));
};
const chip = (label) => screen.getByRole("button", { name: new RegExp(label) });
const stored = () => JSON.parse(localStorage.getItem(VIEWS_KEY));

describe("TaskBoard Board Chat views and Reset", () => {
  it("re-applies the active view on load and switches between views", () => {
    seed({ views: [viewA, viewB], activeId: "va", before: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null } });
    renderBoard();
    expect(screen.queryByText("Parent One")).toBeTruthy();
    expect(screen.queryByText("Parent Two")).toBeNull();
    expect(chip("AI: Parent one work \\(1\\)").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("AI: Parent two work"));
    expect(screen.queryByText("Parent One")).toBeNull();
    expect(screen.queryByText("Parent Two")).toBeTruthy();
    expect(stored().activeId).toBe("vb");

    fireEvent.click(chip("AI: Parent two work"));
    expect(screen.queryByText("Parent One")).toBeTruthy();
    expect(screen.queryByText("Parent Two")).toBeTruthy();
    expect(stored().activeId).toBeNull();
  }, 60000);

  it("turning a view off restores the search the user had before", () => {
    seed({ views: [viewA], activeId: null, before: null });
    renderBoard();
    fireEvent.change(screen.getByPlaceholderText("Search items and subtasks…"), { target: { value: "Three" } });
    fireEvent.click(chip("AI: Parent one work"));
    expect(screen.getByPlaceholderText("Search items and subtasks…").value).toBe("");
    fireEvent.click(chip("AI: Parent one work"));
    expect(screen.getByPlaceholderText("Search items and subtasks…").value).toBe("Three");
  }, 60000);

  it("Reset turns views off and clears search without deleting views", () => {
    seed({ views: [viewA, viewB], activeId: "va", before: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null } });
    renderBoard();
    fireEvent.change(screen.getByPlaceholderText("Search items and subtasks…"), { target: { value: "Parent" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(stored()).toMatchObject({ activeId: null, before: null });
    expect(stored().views).toHaveLength(2);
    expect(screen.getByPlaceholderText("Search items and subtasks…").value).toBe("");
    expect(screen.queryByText("Parent Two")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" }).disabled).toBe(true);
  }, 60000);

  it("x deletes a view", () => {
    seed({ views: [viewA, viewB], activeId: null, before: null });
    renderBoard();
    const del = within(chip("AI: Parent two work")).getByTestId("CancelIcon");
    fireEvent.click(del);
    expect(stored().views.map((v) => v.id)).toEqual(["va"]);
    expect(screen.queryByText(/AI: Parent two work/)).toBeNull();
  }, 60000);
});
