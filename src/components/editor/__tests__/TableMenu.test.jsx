// Toolbar Table button: size grid inserts a table; inside a table the same
// button opens the row/column menu.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import EditorToolbar from "../EditorToolbar.jsx";
import { sanitizeHtml } from "../../../lib/agendaHtml.js";

let editor;
afterEach(() => editor?.destroy());

const makeEditor = (content = "<p>x</p>") => {
  editor = new Editor({
    extensions: [StarterKit, TableKit.configure({ table: { resizable: false } })],
    content,
  });
  return editor;
};

const rowCount = () => (editor.getHTML().match(/<tr>/g) || []).length;
const headerCells = () => (editor.getHTML().match(/<th /g) || []).length;

describe("TableMenu", () => {
  it("is disabled when no editor is focused", () => {
    render(<EditorToolbar editor={null} onLink={() => {}} />);
    expect(screen.getByTitle("Table")).toBeDisabled();
  });

  it("inserts a table of the size picked in the grid, header row on", () => {
    render(<EditorToolbar editor={makeEditor()} onLink={() => {}} />);
    fireEvent.click(screen.getByTitle("Table"));
    const grid = screen.getByRole("grid", { name: "Table size" });
    fireEvent.mouseEnter(within(grid).getByLabelText("3 by 4"));
    expect(screen.getByText("4 × 3")).toBeInTheDocument();
    fireEvent.click(within(grid).getByLabelText("3 by 4"));

    expect(rowCount()).toBe(3);
    expect(headerCells()).toBe(4);
    // What the editor saves survives the sanitizer every reader goes through.
    expect(sanitizeHtml(editor.getHTML())).toBe(editor.getHTML());
  });

  it("inside a table, opens the row/column menu instead of the grid", () => {
    makeEditor();
    editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    render(<EditorToolbar editor={editor} onLink={() => {}} />);

    fireEvent.click(screen.getByTitle("Table"));
    expect(screen.queryByRole("grid")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert row below" }));
    expect(rowCount()).toBe(3);

    fireEvent.click(screen.getByTitle("Table"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Insert column right" }));
    expect(headerCells()).toBe(3);

    fireEvent.click(screen.getByTitle("Table"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete table" }));
    expect(editor.getHTML()).not.toContain("<table");
  });

  it("closes when the focused editor goes away or changes while open", () => {
    makeEditor();
    editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    const first = editor;
    const { rerender } = render(<EditorToolbar editor={first} onLink={() => {}} />);
    fireEvent.click(screen.getByTitle("Table"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    rerender(<EditorToolbar editor={null} onLink={() => {}} />);
    expect(screen.queryByRole("menu")).toBeNull();

    rerender(<EditorToolbar editor={first} onLink={() => {}} />);
    fireEvent.click(screen.getByTitle("Table"));
    const second = new Editor({ extensions: [StarterKit, TableKit], content: "<p>y</p>" });
    rerender(<EditorToolbar editor={second} onLink={() => {}} />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
    second.destroy();
  });
});
