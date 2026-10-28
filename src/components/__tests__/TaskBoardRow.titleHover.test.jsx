import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import TaskBoardRow from "../TaskBoardRow.jsx";

const LONG = "Migrate every legacy location page onto the new template and redirect the old URLs";

function renderRow(props) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <table>
          <tbody>
            <TaskBoardRow
              item={{ id: "p-1", title: LONG, itemNumber: 1 }}
              onUpdate={vi.fn()}
              compact
              {...props}
            />
          </tbody>
        </table>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

// jsdom has no layout, so stub the widths the truncation check reads.
function setWidths(el, { scrollWidth, clientWidth }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

describe("TaskBoardRow compact title hover", () => {
  it("shows the full title in a popup when the title is truncated", async () => {
    renderRow();
    const title = screen.getByText(LONG);
    setWidths(title, { scrollWidth: 600, clientWidth: 320 });

    fireEvent.mouseOver(title);

    expect(await screen.findByRole("tooltip", {}, { timeout: 5000 })).toHaveTextContent(LONG);
  }, 60000);

  it("does not reopen the popup after the title is edited", async () => {
    renderRow({ canUpdate: true });
    const title = screen.getByText(LONG);
    setWidths(title, { scrollWidth: 600, clientWidth: 320 });
    fireEvent.mouseOver(title);
    await screen.findByRole("tooltip", {}, { timeout: 5000 });

    fireEvent.click(title);
    fireEvent.blur(screen.getByDisplayValue(LONG));

    expect(await screen.findByText(LONG)).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  }, 60000);

  it("shows no popup when the title fits", async () => {
    renderRow();
    const title = screen.getByText(LONG);
    setWidths(title, { scrollWidth: 200, clientWidth: 320 });

    fireEvent.mouseOver(title);
    await new Promise((r) => setTimeout(r, 700));

    expect(screen.queryByRole("tooltip")).toBeNull();
  }, 60000);
});
