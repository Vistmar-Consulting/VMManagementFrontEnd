import { describe, it, expect } from "vitest";
import { diffAgendaHtml } from "../agendaDiff.js";

const body = (html) => new DOMParser().parseFromString(html, "text/html").body;
const marks = (html, tag) => [...body(html).querySelectorAll(tag)].map((n) => n.textContent.trim());

describe("diffAgendaHtml", () => {
  it("returns equal input unchanged, markup included", () => {
    const html = "<p>Hi <strong>there</strong></p>";
    expect(diffAgendaHtml(html, html)).toBe(html);
  });

  it("word-diffs a changed bullet, leaving shared words unmarked", () => {
    const out = diffAgendaHtml("<ul><li>Budget raised to 2k</li></ul>", "<ul><li>Budget raised to 3k</li></ul>");
    expect(marks(out, "del").join(" ")).toMatch(/2k/);
    expect(marks(out, "ins").join(" ")).toMatch(/3k/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Budget/);
    expect(body(out).querySelectorAll("li")).toHaveLength(1);
  });

  it("marks an added bullet as inserted", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li></ul>", "<ul><li>Alpha item</li><li>Beta item</li></ul>");
    expect(marks(out, "ins")).toEqual(["Beta item"]);
    expect(marks(out, "del")).toEqual([]);
    expect(body(out).querySelectorAll("li")).toHaveLength(2);
  });

  it("marks a removed bullet as deleted", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li><li>Beta item</li></ul>", "<ul><li>Alpha item</li></ul>");
    expect(marks(out, "del")).toEqual(["Beta item"]);
    expect(marks(out, "ins")).toEqual([]);
  });

  it("shows an unrelated rewrite as whole delete + whole insert", () => {
    const out = diffAgendaHtml("<ul><li>Pause brand campaign</li></ul>", "<ul><li>Launch PMax test</li></ul>");
    expect(marks(out, "del")).toEqual(["Pause brand campaign"]);
    expect(marks(out, "ins")).toEqual(["Launch PMax test"]);
  });

  it("shows a reordered bullet as one delete and one insert of the same text", () => {
    const out = diffAgendaHtml("<ul><li>Alpha item</li><li>Beta item</li></ul>", "<ul><li>Beta item</li><li>Alpha item</li></ul>");
    expect(marks(out, "del")).toHaveLength(1);
    expect(marks(out, "ins")).toHaveLength(1);
    expect(marks(out, "del")[0]).toBe(marks(out, "ins")[0]);
  });

  it("keeps nested lists nested", () => {
    const before = "<ul><li><p>Parent</p><ul><li><p>Child old words</p></li></ul></li></ul>";
    const after = "<ul><li><p>Parent</p><ul><li><p>Child new words</p></li></ul></li></ul>";
    const out = diffAgendaHtml(before, after);
    const child = body(out).querySelector("ul ul li");
    expect(child).not.toBeNull();
    expect(child.querySelector("del").textContent).toMatch(/old/);
    expect(child.querySelector("ins").textContent).toMatch(/new/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Parent/);
  });

  it("diffs a same-shape table cell by cell", () => {
    const t = (b) => `<table><tbody><tr><td><p>Owner</p></td><td><p>${b}</p></td></tr></tbody></table>`;
    const out = diffAgendaHtml(t("Andy old"), t("Andy new"));
    expect(body(out).querySelectorAll("table")).toHaveLength(1);
    expect(body(out).querySelectorAll("td")).toHaveLength(2);
    expect(marks(out, "del").join(" ")).toMatch(/old/);
    expect(marks(out, "ins").join(" ")).toMatch(/new/);
    expect(marks(out, "del").join(" ")).not.toMatch(/Owner/);
  });

  it("shows a reshaped table as old table deleted + new table inserted", () => {
    const before = "<table><tbody><tr><td><p>A</p></td></tr></tbody></table>";
    const after = "<table><tbody><tr><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></tbody></table>";
    const out = diffAgendaHtml(before, after);
    const tables = body(out).querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect([...tables[0].querySelectorAll("td")].every((td) => td.querySelector("del"))).toBe(true);
    expect([...tables[1].querySelectorAll("td")].every((td) => td.querySelector("ins"))).toBe(true);
  });

  it("marks everything inserted when before is empty", () => {
    const out = diffAgendaHtml("", "<p>Homepage hero copy</p>");
    expect(marks(out, "ins")).toEqual(["Homepage hero copy"]);
  });

  it("marks everything deleted when after is empty", () => {
    const out = diffAgendaHtml("<p>Posts weekly</p>", "");
    expect(marks(out, "del")).toEqual(["Posts weekly"]);
  });

  it("returns empty string when both sides are empty", () => {
    expect(diffAgendaHtml("", "")).toBe("");
  });

  it("keeps inline markup on unchanged blocks", () => {
    const out = diffAgendaHtml("<p><strong>Keep</strong></p><p>Old words here</p>", "<p><strong>Keep</strong></p><p>New words here</p>");
    expect(out).toContain("<strong>Keep</strong>");
  });

  it("escapes text in changed blocks", () => {
    const out = diffAgendaHtml("<p>a &lt;b&gt; one</p>", "<p>a &lt;b&gt; two</p>");
    expect(body(out).querySelector("b")).toBeNull();
    expect(body(out).textContent).toContain("<b>");
  });

  it("renders a list of a different type at the same depth as its own list", () => {
    const out = diffAgendaHtml(
      "<ul><li>Alpha item</li></ul><ol><li>Beta item</li></ol>",
      "<ul><li>Alpha item</li></ul><ol><li>Beta item changed</li></ol>",
    );
    expect(body(out).querySelectorAll("ul")).toHaveLength(1);
    expect(body(out).querySelectorAll("ul li")).toHaveLength(1);
    expect(body(out).querySelectorAll("ol")).toHaveLength(1);
    expect(body(out).querySelector("ol li").textContent).toContain("Beta");
  });
});
