// "Open in Task Board" from an agenda mini board: /board?item=<id>.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { MemoryRouter, useLocation } from "react-router-dom";

const ITEMS = [
  { id: "p1", title: "Parent One", itemNumber: 1, statusId: 2, order: "a0", organizationId: "unio" },
  { id: "s1", title: "Sub One", itemNumber: 1, statusId: 2, order: "a0", parentId: "p1", organizationId: "unio" },
  { id: "p3", title: "Parent Three", itemNumber: 3, statusId: 5, order: "a2", organizationId: "unio" },
  { id: "s4", title: "Sub Four", itemNumber: 4, statusId: 5, order: "a1", parentId: "p3", organizationId: "unio" },
];

const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});
Element.prototype.scrollIntoView = vi.fn();

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
vi.mock("../../lib/boardChat/useBoardViews.js", () => ({ useBoardViews: () => [[], () => {}, null] }));

const { default: TaskBoard } = await import("../TaskBoard.jsx");

let location;
function LocationProbe() {
  location = useLocation();
  return null;
}

function renderBoard(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider theme={createTheme()}>
        <LocalizationProvider dateAdapter={AdapterDateFns}>
          <TaskBoard />
          <LocationProbe />
        </LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("TaskBoard ?item= focus", () => {
  it("opens the Completed group and the subtask's parent, scrolls to the row, and drops the param", async () => {
    store.clear();
    renderBoard("/board?item=s4");
    const row = await waitFor(() => {
      const r = document.querySelector('[data-board-row="s4"]');
      expect(r).toBeTruthy();
      return r;
    });
    expect(row.textContent).toContain("Sub Four");
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(location.search).toBe("");
  }, 60000);

  it("switches the org filter to the item's org", async () => {
    store.clear();
    store.set("vm-board-org-filter", JSON.stringify("bmd"));
    renderBoard("/board?item=p1");
    expect(await screen.findByText("Parent One")).toBeTruthy();
    expect(JSON.parse(store.get("vm-board-org-filter"))).toBe("unio");
  }, 60000);

  it("says so when the item no longer exists", async () => {
    store.clear();
    renderBoard("/board?item=gone");
    expect(await screen.findByText(/That item no longer exists/)).toBeTruthy();
  }, 60000);
});
