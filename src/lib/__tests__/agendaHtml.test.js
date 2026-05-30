import { describe, it, expect } from "vitest";
import { bulletsToHtml, sanitizeHtml, composeAgendaHtml } from "../agendaHtml.js";

describe("bulletsToHtml", () => {
  it("renders ordered plain-text items as a <ul>", () => {
    const html = bulletsToHtml([{ text: "First" }, { text: "Second" }]);
    expect(html).toBe("<ul><li>First</li><li>Second</li></ul>");
  });
  it("escapes HTML-special characters in item text", () => {
    expect(bulletsToHtml([{ text: "a < b & c" }])).toBe("<ul><li>a &lt; b &amp; c</li></ul>");
  });
  it("returns empty string for no items", () => {
    expect(bulletsToHtml([])).toBe("");
  });
});

describe("sanitizeHtml", () => {
  it("keeps allowed formatting tags", () => {
    const out = sanitizeHtml("<ul><li><strong>x</strong> <u>y</u> <a href=\"https://a.com\">l</a></li></ul>");
    expect(out).toContain("<strong>x</strong>");
    expect(out).toContain("<u>y</u>");
    expect(out).toContain("href=\"https://a.com\"");
  });
  it("strips scripts and event handlers", () => {
    const out = sanitizeHtml('<p onclick="evil()">hi</p><script>steal()</script>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });
});

describe("composeAgendaHtml", () => {
  const agenda = { title: "Weekly", openFloorHtml: "<ul><li>OF item</li></ul>" };
  const topics = [
    { id: "t1", title: "Topic A", bodyHtml: "<ul><li>a1</li></ul>", sortOrder: 1 },
    { id: "t2", title: "Topic B", bodyHtml: "<p>b body</p>", sortOrder: 2 },
  ];
  it("composes topics (title + body, in order) then open floor; excludes boards", () => {
    const html = composeAgendaHtml(agenda, topics);
    const idxA = html.indexOf("Topic A");
    const idxB = html.indexOf("Topic B");
    const idxOF = html.indexOf("Open Floor");
    expect(idxA).toBeGreaterThan(-1);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxOF);
    expect(html).toContain("a1");
    expect(html).toContain("b body");
    expect(html).toContain("OF item");
    expect(html).not.toMatch(/project board/i);
  });
  it("omits the Open Floor section when there is no open-floor content", () => {
    expect(composeAgendaHtml({ title: "x" }, [])).not.toContain("Open Floor");
  });
  it("inlineStyles variant emits style attributes for email/export", () => {
    const html = composeAgendaHtml(agenda, topics, { inlineStyles: true });
    expect(html).toContain("style=");
  });
  it("places the Pre-Brief section at the very top, before topics", () => {
    const html = composeAgendaHtml(
      { ...agenda, preBriefHtml: "<p>pb body</p>" },
      topics,
    );
    const idxPB = html.indexOf("Pre-Brief");
    const idxA = html.indexOf("Topic A");
    expect(idxPB).toBeGreaterThan(-1);
    expect(idxPB).toBeLessThan(idxA); // pre-brief precedes the first topic
    expect(html).toContain("pb body");
  });
  it("omits the Pre-Brief section when there is no pre-brief content", () => {
    expect(composeAgendaHtml({ title: "x" }, [])).not.toContain("Pre-Brief");
  });
});

import { mergeBodyHtml } from "../agendaHtml.js";

describe("mergeBodyHtml", () => {
  it("merges talking points then notes into one body", () => {
    expect(mergeBodyHtml([{ text: "tp1" }], [{ text: "note1" }])).toBe("<ul><li>tp1</li></ul><ul><li>note1</li></ul>");
  });
  it("returns just talking points when no notes", () => {
    expect(mergeBodyHtml([{ text: "tp1" }], [])).toBe("<ul><li>tp1</li></ul>");
  });
  it("returns empty string when both empty", () => {
    expect(mergeBodyHtml([], [])).toBe("");
  });
});
