import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

const TWO_FRESH = {
  ...GATHERED,
  orgs: [
    GATHERED.orgs[0],
    { slug: "beta", name: "Beta Vision", type: "client", accentColor: null, fresh: [{ id: "t3" }], context: [], droppedNew: 0 },
  ],
  ambiguousTitles: [],
};

const ACME_RESULT = {
  boardChanges: {
    creates: [{ title: "Draft GBP posts", note: "", parentRef: null }, { title: "Fix footer link", note: "", parentRef: null }],
    moves: [],
    notes: [],
  },
  usage: null,
  existingTasks: [],
  transcriptIds: ["t1"],
  failedTranscripts: [],
};

describe("SyncBoardDialog review + apply", () => {
  let onClose;
  beforeEach(() => {
    onClose = vi.fn();
    gatherBoardSyncInputs.mockReset().mockResolvedValue(TWO_FRESH);
    runOrgSync.mockReset();
    applyBoardSync.mockReset();
  });

  // betaResult is a factory: a rejection created before the mock is called would be unhandled.
  async function runBoth(betaResult) {
    runOrgSync.mockImplementation((org) => (org.slug === "acme" ? Promise.resolve(ACME_RESULT) : betaResult()));
    wrap(<SyncBoardDialog items={[]} users={[]} categories={[]} tags={[]} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Run (2 orgs)" }));
    await screen.findByText("Draft GBP posts");
  }

  it("offers Retry on a failed org and applies only the done org's checked creates", async () => {
    await runBoth(() => Promise.reject(new Error("model timeout")));
    expect(await screen.findByText("model timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]); // untick "Fix footer link"
    applyBoardSync.mockResolvedValue({ counts: { acme: { created: 1, moved: 0, noted: 0 } }, dropped: [] });
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 org" }));

    await screen.findByText("Board Sync applied.");
    expect(applyBoardSync).toHaveBeenCalledTimes(1);
    const [runs, selections, uid] = applyBoardSync.mock.calls[0];
    expect(Object.keys(runs)).toEqual(["acme"]);
    expect(runs.acme.transcriptIds).toEqual(["t1"]);
    expect(selections.acme.createIdxs).toEqual([0]);
    expect(selections.acme.moveIdxs).toEqual([]);
    expect(selections.acme.noteIdxs).toEqual([]);
    expect(Object.keys(selections.acme.promotions)).toEqual(["0"]);
    expect(selections.acme.promotions[0].statusId).toBe(8);
    expect(uid).toBe("u1");
  });

  it("returns to review with selections intact when apply fails", async () => {
    await runBoth(() => Promise.reject(new Error("model timeout")));
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    applyBoardSync.mockRejectedValue(new Error("Board Sync would write 600 docs"));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 org" }));

    expect(await screen.findByText("Board Sync would write 600 docs")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Apply 1 org" })).toBeEnabled();
  });

  it("enables Apply while another org is still running and says it is excluded", async () => {
    await runBoth(() => new Promise(() => {}));
    expect(screen.getByText(/1 still running — not included in this apply\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply 1 org" })).toBeEnabled();
  });

  it("leaves out an org that finishes after Apply was clicked", async () => {
    let finishBeta;
    let finishApply;
    await runBoth(() => new Promise((resolve) => { finishBeta = resolve; }));
    applyBoardSync.mockImplementation(() => new Promise((resolve) => { finishApply = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 org" }));

    await act(async () => { finishBeta({ ...ACME_RESULT, transcriptIds: ["t3"] }); });
    await act(async () => { finishApply({ counts: { acme: { created: 2, moved: 0, noted: 0 } }, dropped: [] }); });

    await screen.findByText("Board Sync applied.");
    expect(applyBoardSync).toHaveBeenCalledTimes(1);
    expect(Object.keys(applyBoardSync.mock.calls[0][0])).toEqual(["acme"]);
    expect(Object.keys(applyBoardSync.mock.calls[0][1])).toEqual(["acme"]);
    expect(screen.getByText("Acme Dental")).toBeInTheDocument();
    expect(screen.queryByText("Beta Vision")).not.toBeInTheDocument();
  });

  it("asks twice before discarding paid proposals; another action disarms it", async () => {
    await runBoth(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard paid proposals?" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard paid proposals?" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel in pre-flight closes immediately", async () => {
    wrap(<SyncBoardDialog items={[]} users={[]} categories={[]} tags={[]} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
