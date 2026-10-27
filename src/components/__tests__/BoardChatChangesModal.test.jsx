import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import BoardChatChangesModal from "../BoardChatChangesModal.jsx";

const L = { userName: (id) => id, orgName: (id) => id, categoryName: (id) => id, tagName: (id) => id };
const itemLabel = (id) => ({ p1: "I-4 Appt data", s2: "SI-2 Schema", p9: "I-9 Old" }[id] || id);
const rows = [
  { index: 0, op: "update", ok: true, stale: false, itemId: "p1", reason: "finished", patch: { statusId: 5 }, diffs: [{ field: "statusId", before: 2, after: 5 }] },
  { index: 1, op: "update", ok: true, stale: true, itemId: "s2", reason: "rename", patch: { title: "B" }, diffs: [{ field: "title", before: "A", after: "B" }] },
  { index: 2, op: "delete", ok: false, error: "Item x not found", itemId: "x", reason: "r" },
];

function renderModal(props) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <BoardChatChangesModal open summary="s" rows={rows} lookups={L} itemLabel={itemLabel} onApply={vi.fn()} onCancel={vi.fn()} {...props} />
    </ThemeProvider>,
  );
}

describe("BoardChatChangesModal", () => {
  it("shows diffs, unticks stale and invalid rows, applies the ticked ones", () => {
    const onApply = vi.fn();
    renderModal({ summary: "Close out appt data", onApply });
    expect(screen.getByText("In Progress → Done")).toBeTruthy();
    expect(screen.getByText(/changed since Claude last read it/i)).toBeTruthy();
    expect(screen.getByText("Item x not found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(new Set([0]));
  });

  it("re-ticking a stale row includes it", () => {
    const onApply = vi.fn();
    renderModal({ onApply });
    fireEvent.click(screen.getByRole("checkbox", { name: "SI-2 Schema" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply 2 changes" }));
    expect(onApply).toHaveBeenCalledWith(new Set([0, 1]));
  });

  it("disables rejected rows and leaves them unchecked", () => {
    renderModal();
    const box = screen.getByRole("checkbox", { name: "x" });
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  it("disables Apply when nothing is ticked", () => {
    renderModal();
    fireEvent.click(screen.getByRole("checkbox", { name: "I-4 Appt data" }));
    expect(screen.getByRole("button", { name: "Apply 0 changes" }).disabled).toBe(true);
  });

  it("Cancel calls onCancel; Escape does not discard", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders create and delete rows with distinct checkbox names", () => {
    const more = [
      { index: 0, op: "create", ok: true, stale: false, tempId: "t1", orgId: "unio", parentId: null, parentTempId: null, reason: "new", fields: { title: "New thing", assigneeIds: ["u1"] } },
      { index: 1, op: "delete", ok: true, stale: false, itemId: "p9", cascadeIds: ["a", "b"], reason: "dupe" },
      { index: 2, op: "create", ok: false, stale: false, error: "A new item needs a title", reason: "bad" },
    ];
    renderModal({ rows: more });
    expect(screen.getByRole("checkbox", { name: "Task: New thing" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "I-9 Old" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Op 3" }).disabled).toBe(true);
    expect(screen.getByText("Also deletes 2 subtasks")).toBeTruthy();
    expect(screen.getByText("A new item needs a title")).toBeTruthy();
  });

  it("shows an apply error", () => {
    renderModal({ error: "Item p1 no longer exists" });
    expect(screen.getByText("Item p1 no longer exists")).toBeTruthy();
  });

  it("shows member names, not uids, in an assignee diff", () => {
    const names = { ...L, userName: (id) => ({ u1: "Andy Deemer", u2: "Scot R" }[id] || id) };
    const assign = [
      { index: 0, op: "update", ok: true, stale: false, itemId: "p1", reason: "r", patch: { assigneeIds: ["u2"] }, diffs: [{ field: "assigneeIds", before: ["u1"], after: ["u2"] }] },
    ];
    renderModal({ rows: assign, lookups: names });
    expect(screen.getByText("Andy Deemer → Scot R")).toBeTruthy();
    expect(screen.queryByText(/u1|u2/)).toBeNull();
  });

  it("disables the checkboxes, Cancel and Apply while applying", () => {
    renderModal({ applying: true });
    for (const box of screen.getAllByRole("checkbox")) expect(box.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Apply 1 change" }).disabled).toBe(true);
  });
});
