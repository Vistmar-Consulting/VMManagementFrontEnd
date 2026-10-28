import { describe, it, expect, vi, afterEach } from "vitest";
import { openLinkOnClick } from "../linkHelper.js";

function setup({ editable = true } = {}) {
  const dom = document.createElement("div");
  dom.innerHTML = '<p>see <a href="https://example.com/doc"><strong>doc</strong></a> here</p>';
  document.body.appendChild(dom);
  const view = { editable, dom };
  const inner = dom.querySelector("strong");
  const text = dom.querySelector("p");
  return { view, inner, text, dom };
}

function click(target, extra = {}) {
  return { button: 0, target, preventDefault: vi.fn(), ...extra };
}

describe("openLinkOnClick", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("opens the link in a new tab without opener access", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, inner } = setup();
    const event = click(inner);
    expect(openLinkOnClick(view, 0, event)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/doc", "_blank", "noopener,noreferrer");
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("ignores clicks outside a link", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, text } = setup();
    expect(openLinkOnClick(view, 0, click(text))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores non-left clicks so the context menu still works", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, inner } = setup();
    expect(openLinkOnClick(view, 0, click(inner, { button: 2 }))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves read-only bodies to the native anchor", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, inner } = setup({ editable: false });
    expect(openLinkOnClick(view, 0, click(inner))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
