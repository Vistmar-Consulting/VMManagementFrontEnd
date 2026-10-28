import { describe, it, expect } from "vitest";
import { bulletsToHtml, sanitizeHtml, sanitizeRedlineHtml, escapeText, composeAgendaHtml, htmlToLines } from "../agendaHtml.js";

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
  it("keeps tables as the editor emits them", () => {
    const table =
      '<table style="min-width: 50px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
      '<tbody><tr><th colspan="1" rowspan="1"><p>Head</p></th><th colspan="2" rowspan="1" colwidth="120"><p>Wide</p></th></tr>' +
      '<tr><td colspan="1" rowspan="1"><p>a</p></td><td colspan="1" rowspan="1"><p>b</p></td></tr></tbody></table>';
    const out = sanitizeHtml(table);
    expect(out).toContain("<table");
    expect(out).toContain("<colgroup><col");
    expect(out).toContain('<th colspan="2" rowspan="1" colwidth="120"><p>Wide</p></th>');
    expect(out).toContain('<td colspan="1" rowspan="1"><p>a</p></td>');
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

});

describe("htmlToLines", () => {
  it("returns one line per list item", () => {
    expect(htmlToLines("<ul><li>First</li><li>Second</li></ul>")).toEqual(["First", "Second"]);
  });
  it("returns one line per paragraph", () => {
    expect(htmlToLines("<p>Alpha</p><p>Beta</p>")).toEqual(["Alpha", "Beta"]);
  });
  it("collapses whitespace and drops empty blocks", () => {
    expect(htmlToLines("<p>  a\n  b  </p><p></p><li>  </li><p>c</p>")).toEqual(["a b", "c"]);
  });
  it("strips inline formatting tags, keeping their text", () => {
    expect(htmlToLines("<ul><li><strong>bold</strong> and <em>italic</em></li></ul>")).toEqual([
      "bold and italic",
    ]);
  });
  it("returns one line per table row, cells joined with ' | '", () => {
    const html =
      "<p>Before</p><table><tbody><tr><th><p>Name</p></th><th><p>Due</p></th></tr>" +
      "<tr><td><p>Logo</p></td><td><p></p></td></tr></tbody></table><ul><li>After</li></ul>";
    expect(htmlToLines(html)).toEqual(["Before", "Name | Due", "Logo |", "After"]);
  });
  it("emits a nested table's text once, inside its outer row", () => {
    const html =
      "<table><tbody><tr><td><p>Outer</p></td><td><table><tbody><tr><td><p>Inner</p></td></tr></tbody></table></td></tr></tbody></table>";
    expect(htmlToLines(html)).toEqual(["Outer | Inner"]);
  });
  it("falls back to whole-body text when there are no block wrappers", () => {
    expect(htmlToLines("bare text")).toEqual(["bare text"]);
  });
  it("returns [] for empty, null, or whitespace-only input", () => {
    expect(htmlToLines("")).toEqual([]);
    expect(htmlToLines(null)).toEqual([]);
    expect(htmlToLines("<p>   </p>")).toEqual([]);
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

describe("sanitizeRedlineHtml", () => {
  it("keeps del and ins", () => {
    expect(sanitizeRedlineHtml("<p>a <del>b</del> <ins>c</ins></p>")).toBe("<p>a <del>b</del> <ins>c</ins></p>");
  });

  it("still strips what sanitizeHtml strips", () => {
    expect(sanitizeRedlineHtml('<p>x</p><script>alert(1)</script><h2>t</h2>')).toBe("<p>x</p>t");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeRedlineHtml("")).toBe("");
  });
});

describe("sanitizeHtml and redline marks", () => {
  it("strips del and ins from saved bodies, keeping their text", () => {
    expect(sanitizeHtml("<p>a <del>b</del> <ins>c</ins></p>")).toBe("<p>a b c</p>");
  });
});

describe("escapeText", () => {
  it("escapes &, < and >", () => {
    expect(escapeText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("sanitizeHtml and table sections", () => {
  it("keeps a thead header row instead of dropping it", () => {
    const html = "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>";
    expect(sanitizeHtml(html)).toBe(html);
  });
});
