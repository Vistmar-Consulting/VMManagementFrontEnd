import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
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

const postChat = vi.fn();
vi.mock("../../lib/boardChat/api.js", () => ({ postChat: (...a) => postChat(...a) }));
vi.mock("../../lib/chatHistory/store.js", async (importOriginal) => ({
  ...(await importOriginal()),
  newChatId: () => "chat-1",
  saveTurn: () => Promise.resolve(),
  loadChat: () => Promise.resolve(null),
  deleteChat: () => Promise.resolve(),
}));
// The views list lives in Firestore (useBoardViews, tested on its own); here
// a stand-in keeps it in localStorage under VIEWS_KEY.
vi.mock("../../lib/boardChat/useBoardViews.js", async () => {
  const { useState } = await import("react");
  return {
    useBoardViews: () => {
      const [views, setViews] = useState(() => JSON.parse(localStorage.getItem("test-board-views") || "[]"));
      const set = (next) => {
        localStorage.setItem("test-board-views", JSON.stringify(next));
        setViews(next);
      };
      return [views, set, null];
    },
  };
});

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


const VIEWS_KEY = "test-board-views";
const viewA = {
  id: "va", label: "Parent one work",
  filters: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["p1"] } },
};
const viewB = {
  id: "vb", label: "Parent two work",
  filters: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: { itemIds: ["p2"] } },
};
const ACTIVE_KEY = "vm-board-chat-active";
// The views list (stand-in above), the active view per tab in sessionStorage.
const seed = ({ views, activeId, before }) => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({ activeId, before }));
};
const chip = (label) => screen.getByRole("button", { name: new RegExp(label) });
const stored = () => ({
  views: JSON.parse(localStorage.getItem(VIEWS_KEY)),
  ...JSON.parse(sessionStorage.getItem(ACTIVE_KEY)),
});

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

  it("editing filters under a view marks it edited; a click puts the view back", () => {
    seed({ views: [viewA], activeId: "va", before: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null } });
    renderBoard();
    fireEvent.change(screen.getByPlaceholderText("Search items and subtasks…"), { target: { value: "Three" } });
    expect(chip("AI: Parent one work \\(1\\) · edited").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("AI: Parent one work"));
    expect(screen.getByPlaceholderText("Search items and subtasks…").value).toBe("");
    expect(screen.queryByText(/· edited/)).toBeNull();
    expect(stored().activeId).toBe("va");
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

  it("which view is on is kept per tab, apart from the shared views list", () => {
    seed({ views: [viewA], activeId: null, before: null });
    renderBoard();
    fireEvent.click(chip("AI: Parent one work"));
    expect(JSON.parse(localStorage.getItem(VIEWS_KEY))).toEqual([viewA]);
    expect(JSON.parse(sessionStorage.getItem(ACTIVE_KEY)).activeId).toBe("va");
  }, 60000);

  it("ignores an active id whose view was deleted in another tab", () => {
    seed({ views: [viewB], activeId: "va", before: { orgFilter: "all", titleSearch: "x", columnFilters: {}, scorecardFilter: null } });
    renderBoard();
    expect(screen.queryByText("Parent One")).toBeTruthy();
    expect(chip("AI: Parent two work").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Reset" }).disabled).toBe(true);
  }, 60000);

  it("on load an active view brings its own org, not the last org picked elsewhere", () => {
    const unioView = { ...viewA, filters: { ...viewA.filters, orgFilter: "unio" } };
    seed({ views: [unioView], activeId: "va", before: { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null } });
    localStorage.setItem("vm-board-org-filter", JSON.stringify("all"));
    renderBoard();
    expect(chip("AI: Parent one work").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/· edited/)).toBeNull();
  }, 60000);

  it("x deletes a view", () => {
    seed({ views: [viewA, viewB], activeId: null, before: null });
    renderBoard();
    const del = within(chip("AI: Parent two work")).getByTestId("CancelIcon");
    fireEvent.click(del);
    expect(stored().views.map((v) => v.id)).toEqual(["va"]);
    expect(screen.queryByText(/AI: Parent two work/)).toBeNull();
  }, 60000);

  it("two filter calls in one Claude reply each build on the one before", async () => {
    seed({ views: [], activeId: null, before: null });
    renderBoard();
    fireEvent.change(screen.getByPlaceholderText("Search items and subtasks…"), { target: { value: "Parent" } });
    postChat
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "a", name: "set_board_filter", input: { clear: true } },
          { type: "tool_use", id: "b", name: "set_board_filter", input: { label: "Two", aiFilter: { itemIds: ["p2"] } } },
          { type: "tool_use", id: "c", name: "set_board_filter", input: { label: "Two done", columnFilters: { statusId: [5] } } },
        ],
        stopReason: "tool_use", costUsd: 0.001, model: "m",
      })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "Filtered." }], stopReason: "end_turn", costUsd: 0.001, model: "m" });

    fireEvent.click(screen.getByRole("button", { name: "Board Chat" }));
    const box = screen.getByPlaceholderText("Ask Board Chat…");
    fireEvent.change(box, { target: { value: "show parent two" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Filtered.")).toBeTruthy();

    await waitFor(() => expect(stored().views.map((v) => v.label)).toEqual(["Two", "Two done"]));
    expect(stored().views.map((v) => v.chatId)).toEqual(["chat-1", "chat-1"]);
    expect(stored().views[0].filters).toMatchObject({ titleSearch: "", aiFilter: { itemIds: ["p2"] } });
    expect(stored().views[1].filters).toMatchObject({ titleSearch: "", aiFilter: { itemIds: ["p2"] }, columnFilters: { statusId: [5] } });
    expect(stored().before).toMatchObject({ titleSearch: "", orgFilter: "all" });
  }, 60000);
});

