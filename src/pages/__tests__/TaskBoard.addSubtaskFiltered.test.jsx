import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSyncExternalStore } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { MemoryRouter } from "react-router-dom";

const SEED = [
  { id: "p1", title: "Parent One", itemNumber: 1, statusId: 2, order: "a0", organizationId: "unio", nextSubitemNumber: 2 },
  { id: "s1", title: "Sub One", itemNumber: 1, statusId: 2, order: "a0", parentId: "p1", organizationId: "unio" },
];

// A tiny in-memory items collection: transaction writes land here and the
// board re-renders, standing in for the onSnapshot listener.
let items = [];
const listeners = new Set();
const setItems = (next) => {
  items = next;
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const store = new Map();
vi.stubGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

let nextId = 0;
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal()),
  addDoc: vi.fn(),
  collection: (_db, path) => ({ path }),
  deleteDoc: vi.fn(async (ref) => setItems(items.filter((i) => i.id !== ref.id))),
  doc: (parent, path, id) => (typeof parent?.path === "string" && path === undefined
    ? { path: parent.path, id: `new${++nextId}` }
    : { path, id }),
  runTransaction: async (_db, fn) => {
    const writes = [];
    await fn({
      get: async (ref) => ({ data: () => items.find((i) => i.id === ref.id) }),
      set: (ref, data) => writes.push({ id: ref.id, ...data }),
      update: () => {},
    });
    setItems([...items, ...writes]);
  },
  serverTimestamp: () => null,
  updateDoc: vi.fn(async (ref, patch) =>
    setItems(items.map((i) => (i.id === ref.id ? { ...i, ...patch } : i)))),
  writeBatch: vi.fn(),
}));
vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../hooks/useItems.js", () => ({
  useItems: () => ({ data: useSyncExternalStore(subscribe, () => items), loading: false, error: null }),
}));
const ORGS = [{ id: "unio", name: "Unio" }];
vi.mock("../../hooks/useCollection.js", () => ({
  useCollection: (name) => ({ data: name === "organizations" ? ORGS : [], loading: false, error: null }),
}));
vi.mock("../../hooks/useCollectionGroup.js", () => ({
  useCollectionGroup: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../../lib/boardChat/useBoardViews.js", () => ({ useBoardViews: () => [[], () => {}, null] }));

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

describe("TaskBoard + Add subtask under an active filter", () => {
  beforeEach(() => {
    items = [...SEED];
    nextId = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the new subtask in title edit even though it doesn't match the filter", async () => {
    renderBoard();
    // In Progress card: Sub One matches, so Parent One is open by default.
    fireEvent.click(screen.getAllByText("In Progress")[0]);
    expect(screen.queryByText("Sub One")).toBeTruthy();

    fireEvent.click(screen.getByText("+ Add subtask"));

    // The new subtask is Not Started with no title, so the card doesn't match it.
    await waitFor(() => expect(items.some((i) => i.id === "new1")).toBe(true), { timeout: 30000 });
    const row = screen.getByText("Sub One").closest("tr").nextElementSibling;
    expect(within(row).getAllByRole("textbox")[0]).toBeTruthy();
    expect(within(row).getByText("SI-2")).toBeTruthy();
  }, 120000);

  it("keeps the subtask in view after it is titled, until the filter changes", async () => {
    renderBoard();
    const card = () => screen.getAllByText("In Progress")[0];
    fireEvent.click(card());
    fireEvent.click(screen.getByText("+ Add subtask"));
    await waitFor(() => expect(screen.getByText("SI-2")).toBeTruthy(), { timeout: 30000 });

    const input = within(screen.getByText("SI-2").closest("tr")).getAllByRole("textbox")[0];
    fireEvent.change(input, { target: { value: "Brand new" } });
    // jsdom reports the window as unfocused, which the row treats as a window switch.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fireEvent.blur(input);
    await waitFor(() => expect(items.find((i) => i.id === "new1")?.title).toBe("Brand new"), { timeout: 30000 });
    expect(screen.getByText("Brand new")).toBeTruthy();

    // Turning the card off and on again re-applies the filter for real.
    fireEvent.click(card());
    fireEvent.click(card());
    expect(screen.queryByText("Brand new")).toBeNull();
  }, 120000);

  it("discards the new subtask when left untitled", async () => {
    renderBoard();
    fireEvent.click(screen.getAllByText("In Progress")[0]);
    fireEvent.click(screen.getByText("+ Add subtask"));
    await waitFor(() => expect(screen.getByText("SI-2")).toBeTruthy(), { timeout: 30000 });

    const input = within(screen.getByText("SI-2").closest("tr")).getAllByRole("textbox")[0];
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fireEvent.blur(input);
    await waitFor(() => expect(items.some((i) => i.id === "new1")).toBe(false), { timeout: 30000 });
    expect(screen.queryByText("SI-2")).toBeNull();
  }, 120000);
});

describe("TaskBoard + Add subtask on a Done parent", () => {
  beforeEach(() => {
    items = [
      { id: "p2", title: "Done Parent", itemNumber: 2, statusId: 5, order: "a0", organizationId: "unio", nextSubitemNumber: 2 },
      { id: "s2", title: "Done Sub", itemNumber: 1, statusId: 5, order: "a0", parentId: "p2", organizationId: "unio" },
    ];
    nextId = 0;
  });

  const activeCollapse = () =>
    screen.getByText("Active").closest(".MuiPaper-root").querySelector(".MuiCollapse-root");
  const collapseActive = async () => {
    fireEvent.click(screen.getByText("Active"));
    await waitFor(() => expect(activeCollapse().classList.contains("MuiCollapse-hidden")).toBe(true), { timeout: 30000 });
  };

  it("opens the collapsed Active group, where the new subtask lands", async () => {
    renderBoard();
    await collapseActive();
    fireEvent.click(screen.getByText("Completed"));
    const parentRow = screen.getByText("Done Parent").closest("tr");
    fireEvent.click(within(parentRow).getAllByRole("button")[0]);
    fireEvent.click(screen.getByText("+ Add subtask"));

    await waitFor(() => expect(screen.getByText("SI-2")).toBeTruthy(), { timeout: 30000 });
    await waitFor(() => expect(activeCollapse().classList.contains("MuiCollapse-hidden")).toBe(false), { timeout: 30000 });
    expect(within(screen.getByText("SI-2").closest("tr")).getAllByRole("textbox")[0]).toBeTruthy();
  }, 120000);

  it("opens the collapsed Active group for + New item", async () => {
    renderBoard();
    await collapseActive();
    fireEvent.click(screen.getByRole("button", { name: /new item/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unio" }));

    await waitFor(() => expect(items.some((i) => i.id === "new1")).toBe(true), { timeout: 30000 });
    await waitFor(() => expect(activeCollapse().classList.contains("MuiCollapse-hidden")).toBe(false), { timeout: 30000 });
  }, 120000);
});
