import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

const resolvePrompt = vi.fn();
const assembleGenInputs = vi.fn();
const prepareMeeting = vi.fn();
const refineProposal = vi.fn();
const applyUnified = vi.fn();
const setAgendaStyle = vi.fn();
const snapshotAgenda = vi.fn();
const writeTopicBodies = vi.fn();

vi.mock("../../lib/aiAgenda.js", () => ({
  resolvePrompt, assembleGenInputs, prepareMeeting, refineProposal, applyUnified, setAgendaStyle,
}));
vi.mock("../../lib/agendaVersions.js", () => ({ snapshotAgenda }));
vi.mock("../../lib/liveblocks.js", () => ({ useOthers: () => [], useRoom: () => ({}) }));
vi.mock("@liveblocks/yjs", () => ({ getYjsProviderForRoom: () => ({ synced: true, getYDoc: () => ({}) }) }));
vi.mock("../editor/topicBodyYjs.js", () => ({ writeTopicBodies }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../editor/RichBodyEditor.jsx", () => ({
  default: ({ valueHtml, onChangeHtml, editable = true, ariaLabel }) => (
    <textarea
      data-testid="body-editor"
      aria-label={ariaLabel}
      readOnly={!editable}
      defaultValue={valueHtml}
      onChange={(e) => onChangeHtml(e.target.value)}
    />
  ),
}));

const { default: SyncMeetingDialog } = await import("../SyncMeetingDialog.jsx");

const TOPICS = [{ id: "A", name: "Google Ads", bodyHtml: "<p>Budget 2k</p>" }];
const AGENDA = { title: "Weekly", meetingStyle: "working", openFloorHtml: "" };

function proposalWith(newTitle) {
  return {
    topics: [
      { topicId: "t0", ref: "A", name: "Google Ads", bodyHtml: "<p>Budget 3k</p>" },
      { topicId: "t1", ref: "", name: newTitle, bodyHtml: "<p>Hero copy</p>" },
    ],
    openFloorHtml: "<p>AOB</p>",
    boardChanges: { creates: [], moves: [], notes: [] },
  };
}

async function openReview(prop = proposalWith("Website")) {
  const onClose = vi.fn();
  prepareMeeting.mockResolvedValue(prop);
  render(
    <ThemeProvider theme={createTheme()}>
      <SyncMeetingDialog agendaId="ag1" agenda={AGENDA} topics={TOPICS} items={[]} orgSlug="acme" users={[]} onClose={onClose} />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("tab", { name: "Changes" });
  return onClose;
}

// Full-dialog renders take seconds in jsdom under load (see SyncBoardDialog.test).
describe("SyncMeetingDialog review", { timeout: 20000 }, () => {
  beforeEach(() => {
    resolvePrompt.mockReset().mockResolvedValue("prompt");
    assembleGenInputs.mockReset().mockResolvedValue({
      transcripts: [], projectBoard: [], existingTasks: [], orgAgendas: [],
      categories: [], tagVocab: [], internal: false, orgMeta: [], summary: null,
    });
    prepareMeeting.mockReset();
    refineProposal.mockReset();
    applyUnified.mockReset().mockResolvedValue({ updatedBodies: [] });
    setAgendaStyle.mockReset();
    snapshotAgenda.mockReset().mockResolvedValue(undefined);
    writeTopicBodies.mockReset();
  });

  it("shows the Changes tab after prepare", async () => {
    await openReview();
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Proposed agenda — review and edit before applying")).toBeInTheDocument();
  });

  it("Apply carries a body edited on the Edit tab", async () => {
    await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Google Ads body"), { target: { value: "<p>Edited by hand</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applyUnified).toHaveBeenCalledTimes(1));
    const sent = applyUnified.mock.calls[0][2];
    expect(sent.topics[0].bodyHtml).toBe("<p>Edited by hand</p>");
  });

  it("locks the Edit tab while Refine is in flight", async () => {
    refineProposal.mockReturnValue(new Promise(() => {}));
    await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByLabelText("New topic title")).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText(/Tell the AI how to refine/), { target: { value: "Tighten it" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    await waitFor(() => expect(screen.getByLabelText("New topic title")).toBeDisabled());
    screen.getAllByTestId("body-editor").forEach((ed) => expect(ed).toHaveAttribute("readonly"));
  });

  it("Refine receives a hand edit, and the Edit tab then shows the refined body", async () => {
    let resolveRefine;
    refineProposal.mockReturnValue(new Promise((r) => { resolveRefine = r; }));
    await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Google Ads body"), { target: { value: "<p>Edited by hand</p>" } });
    fireEvent.change(screen.getByPlaceholderText(/Tell the AI how to refine/), { target: { value: "Tighten it" } });
    fireEvent.click(screen.getByRole("button", { name: "Refine" }));
    expect(refineProposal.mock.calls[0][0].proposal.topics[0].bodyHtml).toBe("<p>Edited by hand</p>");
    const refined = proposalWith("Website");
    refined.topics[0].bodyHtml = "<p>Refined body</p>";
    resolveRefine(refined);
    await waitFor(() => expect(screen.getByLabelText("Google Ads body")).toHaveValue("<p>Refined body</p>"));
  });

  it("Apply carries an Open Floor edit", async () => {
    await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Open Floor body"), { target: { value: "<p>New AOB</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applyUnified).toHaveBeenCalledTimes(1));
    expect(applyUnified.mock.calls[0][2].openFloorHtml).toBe("<p>New AOB</p>");
  });

  it("Discard closes without asking when nothing was edited", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const onClose = await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("Discard asks after an edit, and Cancel in the confirm keeps the dialog open", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Google Ads body"), { target: { value: "<p>Edited by hand</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirm).toHaveBeenCalledWith("Discard your edits to the proposed agenda?");
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("Discard does not ask once the edits are saved (live-editor write failed after commit)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    writeTopicBodies.mockImplementation(() => { throw new Error("offline"); });
    const onClose = await openReview();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Google Ads body"), { target: { value: "<p>Edited by hand</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/Applied and saved, but the live editor update failed/);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("a blank new-topic title disables Apply with a caption", async () => {
    await openReview(proposalWith("   "));
    expect(screen.getByText("A new topic needs a title (Edit tab)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("New topic title"), { target: { value: "Website" } });
    expect(screen.queryByText("A new topic needs a title (Edit tab)")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });
});
