import { describe, it, expect, vi, afterEach } from "vitest";
import { openLinkOnClick } from "../linkHelper.js";

function setup({ editable = true } = {}) {
  const dom = document.createElement("div");
  dom.innerHTML = '<p>see <a href="https://example.com/doc"><strong>doc</strong></a> here</p>';
  document.body.appendChild(dom);
  const view = { editable, dom };
  const inner = dom.querySelector("strong");
  const text = dom.querySelector("p");
  return { view, inner, text };
}

function click(target, extra = {}) {
  return { button: 0, target, preventDefault: vi.fn(), ...extra };
}

function setPlatform(value) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(value);
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

  it("opens on cmd+click, and on ctrl+click off macOS", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, inner } = setup();
    expect(openLinkOnClick(view, 0, click(inner, { metaKey: true }))).toBe(true);
    setPlatform("Win32");
    expect(openLinkOnClick(view, 0, click(inner, { ctrlKey: true }))).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a click outside a link", (t) => click(t.text)],
    ["a right click", (t) => click(t.inner, { button: 2 })],
    ["a shift click (extends the selection)", (t) => click(t.inner, { shiftKey: true })],
    ["an alt click", (t) => click(t.inner, { altKey: true })],
  ])("ignores %s", (_label, makeEvent) => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const t = setup();
    const event = makeEvent(t);
    expect(openLinkOnClick(t.view, 0, event)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores ctrl+click on macOS, where it opens the context menu", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    setPlatform("MacIntel");
    const { view, inner } = setup();
    expect(openLinkOnClick(view, 0, click(inner, { ctrlKey: true }))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("ignores a link outside the editor", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view } = setup();
    const outside = document.createElement("a");
    outside.href = "https://example.com/elsewhere";
    document.body.appendChild(outside);
    expect(openLinkOnClick(view, 0, click(outside))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves read-only bodies to the native anchor", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { view, inner } = setup({ editable: false });
    expect(openLinkOnClick(view, 0, click(inner))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
