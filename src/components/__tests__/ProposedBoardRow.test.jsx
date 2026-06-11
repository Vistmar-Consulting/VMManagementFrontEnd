import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import ProposedBoardRow from "../ProposedBoardRow.jsx";

const theme = createTheme();

const CAT_WEB = { id: "cat-web", name: "web-dev", color: "#2e7d32", slug: "web-dev" };
const CAT_SEO = { id: "cat-seo", name: "seo", color: "#1565c0", slug: "seo" };
const TAG_GBP  = { id: "tag-gbp",  name: "gbp",  color: "#e65100" };
const TAG_Q3   = { id: "tag-q3",   name: "q3",   color: "#9c27b0" };
const USER_A   = { id: "uid-a", displayName: "Andy",  active: true };
const USER_S   = { id: "uid-s", displayName: "Scot",  active: true };

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const baseCreate = {
  title: "Draft GBP post schedule",
  topicId: "t0",
  note: "Discussed in client call 2026-06-06",
  parentRef: null,
};

const basePromotion = {
  statusId: 8, // AI Gen
  assigneeIds: [],
  categoryId: "cat-web",
  tagIds: ["tag-gbp"],
};

function makeProps(overrides = {}) {
  return {
    create: baseCreate,
    idx: 0,
    isChecked: true,
    onToggle: vi.fn(),
    promotion: basePromotion,
    onUpdateCreate: vi.fn(),
    onUpdatePromotion: vi.fn(),
    itemsById: new Map(),
    creates: [baseCreate],
    users: [USER_A, USER_S],
    categories: [CAT_WEB, CAT_SEO],
    tags: [TAG_GBP, TAG_Q3],
    ...overrides,
  };
}

describe("ProposedBoardRow", () => {
  it("renders the create title", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("Draft GBP post schedule")).toBeInTheDocument();
  });

  it("renders the AI note as italic dimmed text", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    const note = screen.getByText("Discussed in client call 2026-06-06");
    expect(note).toBeInTheDocument();
    expect(note).toHaveStyle({ fontStyle: "italic" });
  });

  it("renders the category pill text", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("web-dev")).toBeInTheDocument();
  });

  it("renders tag dots and names", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("gbp")).toBeInTheDocument();
  });

  it("shows separator dot when category and tags are both present", () => {
    wrap(<ProposedBoardRow {...makeProps()} />);
    expect(screen.getByText("·")).toBeInTheDocument();
  });

  it("hides separator dot when category is absent", () => {
    const p = makeProps({ promotion: { ...basePromotion, categoryId: null } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("hides separator dot when tags are empty", () => {
    const p = makeProps({ promotion: { ...basePromotion, tagIds: [] } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  it("row is semi-transparent when unchecked", () => {
    const { container } = wrap(<ProposedBoardRow {...makeProps({ isChecked: false })} />);
    const row = container.firstChild;
    expect(row).toHaveStyle({ opacity: "0.5" });
  });

  it("calls onToggle when checkbox changes", () => {
    const onToggle = vi.fn();
    wrap(<ProposedBoardRow {...makeProps({ onToggle })} />);
    const cb = screen.getByRole("checkbox");
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows parent badge when parentRef is set to an existing item", () => {
    const itemsById = new Map([["item-1", { id: "item-1", title: "Parent Task" }]]);
    const p = makeProps({
      create: { ...baseCreate, parentRef: "item-1" },
      itemsById,
    });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText(/Parent Task/)).toBeInTheDocument();
  });

  it("shows parent badge for new: ref resolving to another create", () => {
    const creates = [
      baseCreate,
      { title: "Sub task", topicId: "t0", note: "", parentRef: "new:0" },
    ];
    const p = makeProps({
      create: creates[1],
      idx: 1,
      creates,
    });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText(/Draft GBP post schedule/)).toBeInTheDocument();
  });

  it("renders '+ category' placeholder when categoryId is null", () => {
    const p = makeProps({ promotion: { ...basePromotion, categoryId: null } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText("+ category")).toBeInTheDocument();
  });

  it("renders '+ tags' placeholder when tagIds is empty", () => {
    const p = makeProps({ promotion: { ...basePromotion, tagIds: [] } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText("+ tags")).toBeInTheDocument();
  });

  it("does not render AI note when create.note is empty", () => {
    const p = makeProps({ create: { ...baseCreate, note: "" } });
    wrap(<ProposedBoardRow {...p} />);
    expect(screen.queryByText("Discussed in client call 2026-06-06")).not.toBeInTheDocument();
  });

  it("syncs title display when create.title changes externally (not editing)", () => {
    const p = makeProps();
    const { rerender } = wrap(<ProposedBoardRow {...p} />);
    expect(screen.getByText("Draft GBP post schedule")).toBeInTheDocument();
    const updatedCreate = { ...baseCreate, title: "Updated by Refine" };
    rerender(
      <ThemeProvider theme={theme}>
        <ProposedBoardRow {...makeProps({ create: updatedCreate })} />
      </ThemeProvider>
    );
    expect(screen.getByText("Updated by Refine")).toBeInTheDocument();
  });
});
