// Presentation Mode's flag→class binding. This is the only logic in the
// feature; the CSS rules themselves are verified in the browser, since no
// jsdom test can prove a rule suppresses a live Liveblocks caret.

import { describe, it, expect } from "vitest";
import { PRESENTATION_MODE_CLASS, presentationClassName } from "../caretVisibility.js";

describe("presentationClassName", () => {
  it("returns the presentation mode class when active", () => {
    expect(presentationClassName(true)).toBe(PRESENTATION_MODE_CLASS);
  });

  it("returns undefined when inactive, so no class attribute is emitted", () => {
    expect(presentationClassName(false)).toBeUndefined();
  });
});
