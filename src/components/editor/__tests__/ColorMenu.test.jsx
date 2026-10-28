// Toolbar Text color / Highlight buttons: swatches, hex entry, native picker, Clear.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";
import EditorToolbar from "../EditorToolbar.jsx";
import { t } from "../../../theme/tokens.js";

let editor;
afterEach(() => editor?.destroy());

const makeEditor = () => {
  editor = new Editor({ extensions: [StarterKit, TextStyle, Color, BackgroundColor], content: "<p>hello</p>" });
  editor.commands.selectAll();
  return editor;
};
const attrs = () => editor.getAttributes("textStyle");
const mount = () => render(<EditorToolbar editor={makeEditor()} onLink={() => {}} />);

describe("ColorMenu", () => {
  it("both buttons are disabled when no editor is focused", () => {
    render(<EditorToolbar editor={null} onLink={() => {}} />);
    expect(screen.getByTitle("Text color")).toBeDisabled();
    expect(screen.getByTitle("Highlight")).toBeDisabled();
  });

  it("a text swatch colors the selection", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    fireEvent.click(screen.getByLabelText(`Text color ${t.red}`));
    expect(attrs().color).toBe(t.red);
  });

  it("a highlight swatch sets the background color", () => {
    mount();
    fireEvent.click(screen.getByTitle("Highlight"));
    fireEvent.click(screen.getByLabelText("Highlight #fff3a3"));
    expect(attrs().backgroundColor).toBe("#fff3a3");
  });

  it("a valid hex applies on Enter; an invalid one is ignored", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    const hex = screen.getByLabelText("Hex color");
    fireEvent.change(hex, { target: { value: "#12" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(attrs().color).toBeFalsy();
    fireEvent.change(hex, { target: { value: "#123456" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(attrs().color).toBe("#123456");
  });

  it("dragging the native picker only updates the hex field; commit applies", () => {
    mount();
    fireEvent.click(screen.getByTitle("Text color"));
    const picker = screen.getByLabelText("Pick color");
    fireEvent.input(picker, { target: { value: "#abcdef" } });
    expect(screen.getByLabelText("Hex color")).toHaveValue("#abcdef");
    expect(attrs().color).toBeFalsy();
    fireEvent.change(picker, { target: { value: "#abcdef" } });
    expect(attrs().color).toBe("#abcdef");
  });

  it("Clear removes the color", () => {
    mount();
    editor.chain().setColor(t.red).setBackgroundColor("#fff3a3").run();
    fireEvent.click(screen.getByTitle("Text color"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(attrs().color).toBeFalsy();
    expect(attrs().backgroundColor).toBe("#fff3a3");
  });
});
