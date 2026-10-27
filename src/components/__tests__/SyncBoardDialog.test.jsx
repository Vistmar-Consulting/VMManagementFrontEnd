import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

const GATHERED = {
  sinceMs: 0,
  orgs: [
    { slug: "acme", name: "Acme Dental", type: "client", accentColor: "#123456", fresh: [{ id: "t1" }], context: [], droppedNew: 0 },
    { slug: "vistamar", name: "Vistamar", type: "internal", accentColor: null, fresh: [], context: [{ id: "t2" }], droppedNew: 0 },
  ],
  unclassified: 0,
  ambiguousTitles: [{ title: "weekly sync", orgs: ["acme", "vistamar"] }],
  lastSyncAt: null,
  agendasByOrg: {},
  categories: [],
  tagVocab: [],
};

const gatherBoardSyncInputs = vi.fn();
const runOrgSync = vi.fn();
const applyBoardSync = vi.fn();

vi.mock("../../lib/boardSync.js", () => ({ gatherBoardSyncInputs, runOrgSync, applyBoardSync }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));

const { default: SyncBoardDialog } = await import("../SyncBoardDialog.jsx");

function wrap(ui) {
  return render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);
}

describe("SyncBoardDialog pre-flight", () => {
  beforeEach(() => {
    gatherBoardSyncInputs.mockReset().mockResolvedValue(GATHERED);
    runOrgSync.mockReset().mockReturnValue(new Promise(() => {}));
    applyBoardSync.mockReset();
  });

  it("lists every org, unticks orgs with nothing new, and runs only on click", async () => {
    wrap(<SyncBoardDialog items={[]} users={[]} categories={[]} tags={[]} onClose={vi.fn()} />);

    expect(await screen.findByText("Acme Dental")).toBeInTheDocument();
    expect(screen.getByText("Vistamar")).toBeInTheDocument();
    expect(screen.getByText(/1 new/)).toBeInTheDocument();
    expect(screen.getByText(/nothing new/)).toBeInTheDocument();
    expect(screen.getByText(/weekly sync \(Acme Dental, Vistamar\)/)).toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();

    const run = screen.getByRole("button", { name: "Run (1 org)" });
    expect(runOrgSync).not.toHaveBeenCalled();

    fireEvent.click(run);
    expect(runOrgSync).toHaveBeenCalledTimes(1);
    expect(runOrgSync.mock.calls[0][0].slug).toBe("acme");
  });
});
