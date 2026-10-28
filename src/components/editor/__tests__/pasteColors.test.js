import { describe, it, expect } from "vitest";
import { stripPastedColors } from "../pasteColors.js";

describe("stripPastedColors", () => {
  it("removes color and background from external HTML, keeps other styles", () => {
    const out = stripPastedColors('<p><span style="color: rgb(0, 0, 0); background-color: transparent; font-weight: 700">x</span></p>');
    expect(out).not.toMatch(/color|background/);
    expect(out).toMatch(/font-weight: 700/);
  });

  it("drops a style attribute left empty", () => {
    expect(stripPastedColors('<p><span style="color: #000">x</span></p>')).toBe("<p><span>x</span></p>");
  });

  it("removes the background shorthand too", () => {
    expect(stripPastedColors('<p><span style="background: yellow">x</span></p>')).toBe("<p><span>x</span></p>");
  });

  it("keeps colors on a paste from another agenda editor (ProseMirror slice)", () => {
    const html = '<p data-pm-slice="1 1 []"><span style="color: #c62828">x</span></p>';
    expect(stripPastedColors(html)).toBe(html);
  });

  it("passes empty input through", () => {
    expect(stripPastedColors("")).toBe("");
  });
});
