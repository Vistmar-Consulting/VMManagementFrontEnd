import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";

vi.mock("../editor/RichBodyEditor.jsx", () => ({
  default: ({ valueHtml, onChangeHtml }) => (
    <textarea data-testid="body-editor" defaultValue={valueHtml} onChange={(e) => onChangeHtml(e.target.value)} />
  ),
}));

const { default: ProposalReview } = await import("../ProposalReview.jsx");

const prevTopics = [
  { id: "A", name: "Google Ads", bodyHtml: "<ul><li>Budget raised to 2k</li><li>Pause brand campaign</li></ul>" },
  { id: "B", name: "GBP", bodyHtml: "<p>Posts weekly</p>" },
];
const proposal = {
  topics: [
    { topicId: "t0", ref: "A", name: "Google Ads", bodyHtml: "<ul><li>Budget raised to 3k</li><li>Launch PMax test</li></ul>" },
    { topicId: "t1", ref: "", name: "Website", bodyHtml: "<p>Homepage hero copy</p>" },
  ],
  openFloorHtml: "<p>Any other business</p>",
};

function setup(overrides = {}) {
  const onTopicChange = vi.fn();
  const onOpenFloorChange = vi.fn();
  const utils = render(
    <ThemeProvider theme={createTheme()}>
      <ProposalReview
        prevTopics={prevTopics}
        prevOpenFloorHtml=""
        topics={prevTopics}
        proposal={proposal}
        statuses={["retained", "new"]}
        rev={1}
        onTopicChange={onTopicChange}
        onOpenFloorChange={onOpenFloorChange}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { ...utils, onTopicChange, onOpenFloorChange };
}

const texts = (container, tag) => [...container.querySelectorAll(tag)].map((n) => n.textContent.trim());

describe("ProposalReview", () => {
  it("opens on Changes, showing deletions and insertions against the pre-sync agenda", () => {
    const { container } = setup();
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(texts(container, "del")).toEqual(expect.arrayContaining(["Pause brand campaign", "GBP", "Posts weekly"]));
    expect(texts(container, "ins")).toEqual(expect.arrayContaining(["Launch PMax test", "Website", "Homepage hero copy", "Any other business"]));
  });

  it("Edit tab: retained title is locked text, new title is a field", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    const fields = screen.getAllByLabelText("New topic title");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveValue("Website");
    expect(screen.getByText("Google Ads")).toBeInTheDocument();
  });

  it("Edit tab: title and body edits report the right topic index", () => {
    const { onTopicChange, onOpenFloorChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("New topic title"), { target: { value: "Site" } });
    expect(onTopicChange).toHaveBeenCalledWith(1, { name: "Site" });
    const editors = screen.getAllByTestId("body-editor");
    expect(editors).toHaveLength(3); // two topics + Open Floor
    fireEvent.change(editors[0], { target: { value: "<p>edited</p>" } });
    expect(onTopicChange).toHaveBeenCalledWith(0, { bodyHtml: "<p>edited</p>" });
    fireEvent.change(editors[2], { target: { value: "<p>of</p>" } });
    expect(onOpenFloorChange).toHaveBeenCalledWith("<p>of</p>");
  });

  it("an edit fed back into the proposal shows as an insertion on Changes", () => {
    function Stateful() {
      const [prop, setProp] = useState(proposal);
      return (
        <ProposalReview
          prevTopics={prevTopics}
          prevOpenFloorHtml=""
          topics={prevTopics}
          proposal={prop}
          statuses={["retained", "new"]}
          rev={1}
          onTopicChange={(i, patch) => setProp((p) => ({ ...p, topics: p.topics.map((tp, j) => (j === i ? { ...tp, ...patch } : tp)) }))}
          onOpenFloorChange={(html) => setProp((p) => ({ ...p, openFloorHtml: html }))}
        />
      );
    }
    const { container } = render(<ThemeProvider theme={createTheme()}><Stateful /></ThemeProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getAllByTestId("body-editor")[0], {
      target: { value: "<ul><li>Budget raised to 3k</li><li>Launch PMax test</li><li>Zebra phrase added</li></ul>" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(texts(container, "ins")).toContain("Zebra phrase added");
  });

  it("flags a blank new-topic title", () => {
    const blank = { ...proposal, topics: [proposal.topics[0], { ...proposal.topics[1], name: "  " }] };
    setup({ proposal: blank });
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByText("A new topic needs a title")).toBeInTheDocument();
  });
});
