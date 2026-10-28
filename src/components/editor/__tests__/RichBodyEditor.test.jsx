// RichBodyEditor: editable lock (input + toolbar) and accessible name.

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import RichBodyEditor from "../RichBodyEditor.jsx";

const prose = (container) => container.querySelector(".ProseMirror");

async function mount(props) {
  const onChangeHtml = vi.fn();
  const utils = render(<RichBodyEditor valueHtml="<p>hello</p>" onChangeHtml={onChangeHtml} debounceMs={0} {...props} />);
  await waitFor(() => expect(prose(utils.container)).not.toBeNull());
  return { ...utils, onChangeHtml };
}

describe("RichBodyEditor", () => {
  it("is editable with an enabled toolbar by default", async () => {
    const { container } = await mount();
    expect(prose(container)).toHaveAttribute("contenteditable", "true");
    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeEnabled();
  });

  it("editable=false locks input and disables the toolbar", async () => {
    const { container } = await mount({ editable: false });
    expect(prose(container)).toHaveAttribute("contenteditable", "false");
    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeDisabled();
    expect(screen.getByTitle("Table")).toBeDisabled();
  });

  it("toggling editable follows the prop and writes nothing", async () => {
    const { container, rerender, onChangeHtml } = await mount();
    rerender(<RichBodyEditor valueHtml="<p>hello</p>" onChangeHtml={onChangeHtml} debounceMs={0} editable={false} />);
    await waitFor(() => expect(prose(container)).toHaveAttribute("contenteditable", "false"));
    rerender(<RichBodyEditor valueHtml="<p>hello</p>" onChangeHtml={onChangeHtml} debounceMs={0} editable />);
    await waitFor(() => expect(prose(container)).toHaveAttribute("contenteditable", "true"));
    await new Promise((r) => setTimeout(r, 20));
    expect(onChangeHtml).not.toHaveBeenCalled();
  });

  it("ariaLabel names the editable region; absent by default", async () => {
    const { container } = await mount({ ariaLabel: "Google Ads body" });
    expect(prose(container)).toHaveAttribute("aria-label", "Google Ads body");
    const other = await mount();
    expect(prose(other.container)).not.toHaveAttribute("aria-label");
  });

  it("keeps text color and highlight from valueHtml", async () => {
    const { container } = await mount({ valueHtml: '<p><span style="color: #c62828; background-color: #fff3a3">hot</span></p>' });
    const span = prose(container).querySelector("span[style]");
    expect(span).not.toBeNull();
    expect(span.textContent).toBe("hot");
    // jsdom normalizes hex to rgb when the style is applied to the DOM.
    expect(span.getAttribute("style")).toContain("color: rgb(198, 40, 40)");
    expect(span.getAttribute("style")).toContain("background-color: rgb(255, 243, 163)");
  });
});
