import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import TaskBoardRow from "../TaskBoardRow.jsx";

const wrap = (props) => (
  <ThemeProvider theme={createTheme()}>
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <table>
        <tbody>
          <TaskBoardRow onUpdate={vi.fn()} {...props} />
        </tbody>
      </table>
    </LocalizationProvider>
  </ThemeProvider>
);

const renderRow = (props) => {
  const utils = render(wrap(props));
  return { ...utils, rerenderRow: (next) => utils.rerender(wrap(next)) };
};

const parent = { id: "p-1", title: "Parent", itemNumber: 1, statusId: 2 };
const blankSub = { id: "sub-blank", title: "", parentId: "p-1", itemNumber: 2, statusId: 1 };

// The subitem's title cell (second column); holds an input only while editing.
const titleInput = () =>
  screen.getByText("SI-2").closest("tr").querySelectorAll("td")[1].querySelector("input");

describe("TaskBoardRow new subitem", () => {
  it("does not open title edit for an existing untitled subitem", () => {
    renderRow({ item: parent, subitems: [blankSub], expanded: true });
    expect(titleInput()).toBeNull();
  }, 60000);

  it("opens title edit for the subitem just created", () => {
    renderRow({ item: parent, subitems: [blankSub], expanded: true, newItemId: "sub-blank" });
    expect(titleInput()).toBeTruthy();
  }, 20000);

  it("discards a just-created subitem left empty on blur", () => {
    const onDiscardNew = vi.fn();
    const onUpdate = vi.fn();
    renderRow({ item: parent, subitems: [blankSub], expanded: true, newItemId: "sub-blank", onDiscardNew, onUpdate });
    fireEvent.blur(titleInput());
    expect(onDiscardNew).toHaveBeenCalledWith(blankSub);
    expect(onUpdate).not.toHaveBeenCalled();
  }, 20000);

  it("discards a just-created subitem on Escape", () => {
    const onDiscardNew = vi.fn();
    renderRow({ item: parent, subitems: [blankSub], expanded: true, newItemId: "sub-blank", onDiscardNew });
    fireEvent.keyDown(titleInput(), { key: "Escape" });
    expect(onDiscardNew).toHaveBeenCalledWith(blankSub);
  }, 20000);

  it("saves a just-created subitem once it has a title", () => {
    const onDiscardNew = vi.fn();
    const onUpdate = vi.fn();
    renderRow({ item: parent, subitems: [blankSub], expanded: true, newItemId: "sub-blank", onDiscardNew, onUpdate });
    const input = titleInput();
    fireEvent.change(input, { target: { value: "Real task" } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith("sub-blank", { title: "Real task" });
    expect(onDiscardNew).not.toHaveBeenCalled();
  }, 20000);

  it("never discards a kept subitem whose title is cleared later", () => {
    const onDiscardNew = vi.fn();
    const onNewSettled = vi.fn();
    const onUpdate = vi.fn();
    const props = { item: parent, expanded: true, newItemId: "sub-blank", onDiscardNew, onNewSettled, onUpdate };
    const { rerenderRow } = renderRow({ ...props, subitems: [blankSub] });
    fireEvent.change(titleInput(), { target: { value: "Real task" } });
    fireEvent.blur(titleInput());
    expect(onNewSettled).toHaveBeenCalledTimes(1);

    rerenderRow({ ...props, subitems: [{ ...blankSub, title: "Real task" }] });
    fireEvent.click(screen.getByText("Real task"));
    fireEvent.change(titleInput(), { target: { value: "" } });
    fireEvent.blur(titleInput());
    rerenderRow({ ...props, subitems: [blankSub] });

    expect(onDiscardNew).not.toHaveBeenCalled();
    expect(titleInput()).toBeNull();
  }, 20000);

  it("keeps a just-created subitem when the window loses focus", () => {
    const onDiscardNew = vi.fn();
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderRow({ item: parent, subitems: [blankSub], expanded: true, newItemId: "sub-blank", onDiscardNew });
    fireEvent.blur(titleInput());
    hasFocus.mockRestore();
    expect(onDiscardNew).not.toHaveBeenCalled();
    expect(titleInput()).toBeTruthy();
  }, 20000);
});
