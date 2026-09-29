import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import TaskBoardRow from "../TaskBoardRow.jsx";

const theme = createTheme();

function renderRow(props) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <table>
          <tbody>
            <TaskBoardRow onUpdate={vi.fn()} {...props} />
          </tbody>
        </table>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

const parent = { id: "p-1", title: "Done Parent", itemNumber: 1, statusId: 5 };
const sub = { id: "sub-1", title: "Open Subtask", parentId: "p-1", itemNumber: 4, statusId: 2 };

const parentRowOf = () => screen.getByText("Done Parent").closest("tr");

describe("TaskBoardRow ghost + dimmed", () => {
  it("keeps a ghost parent fully editable and undimmed", () => {
    const onOpenComments = vi.fn();
    renderRow({ item: parent, subitems: [sub], ghost: true, expanded: true, onOpenComments });

    const row = parentRowOf();
    expect(getComputedStyle(row).opacity).not.toBe("0.5");

    const notesButton = row.querySelector('[data-testid="DescriptionOutlinedIcon"], [data-testid="DescriptionIcon"]').closest("button");
    fireEvent.click(notesButton);
    expect(onOpenComments).toHaveBeenCalledWith(parent);

    fireEvent.click(screen.getByText("Done Parent"));
    expect(screen.getByDisplayValue("Done Parent")).toBeTruthy();
  }, 30000);

  it("dims a row with opacity only, leaving it editable", () => {
    renderRow({ item: parent, subitems: [sub], expanded: true, dimmed: true });

    expect(getComputedStyle(parentRowOf()).opacity).toBe("0.5");
    const subRow = screen.getByText("Open Subtask").closest("tr");
    expect(getComputedStyle(subRow).opacity).not.toBe("0.5");

    fireEvent.click(screen.getByText("Done Parent"));
    expect(screen.getByDisplayValue("Done Parent")).toBeTruthy();
  }, 30000);
});
