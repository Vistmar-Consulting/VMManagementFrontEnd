import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import TaskBoardRow from "../TaskBoardRow.jsx";

const theme = createTheme();

const CAT_WEB = { id: "cat-web", name: "Web Dev", color: "#2e7d32" };

function renderRow(props) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <table>
          <tbody>
            <TaskBoardRow categories={[CAT_WEB]} onUpdate={vi.fn()} {...props} />
          </tbody>
        </table>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

describe("TaskBoardRow subitem category", () => {
  const parent = { id: "p-1", title: "Parent", itemNumber: 1, categoryId: "cat-web" };
  const sub = { id: "sub-1", title: "Subtask", parentId: "p-1", itemNumber: 3, categoryId: null };

  it("shows the parent's category on the subitem row, read-only", () => {
    renderRow({ item: parent, subitems: [sub], expanded: true });

    const labels = screen.getAllByText("Web Dev");
    expect(labels).toHaveLength(2);

    fireEvent.click(labels[1]);
    expect(screen.queryByRole("menu")).toBeNull();
  }, 30000);
});
