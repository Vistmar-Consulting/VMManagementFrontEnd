// Contents box wiring for Overview topic collapse: the Collapse all / Expand all
// label follows state, and jumping to a topic expands it before scrolling.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgendaTOC from "../AgendaTOC.jsx";

const topics = [
  { id: "a", name: "Blog" },
  { id: "b", name: "Reporting" },
];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("AgendaTOC collapse controls", () => {
  it("labels the toggle from allCollapsed and calls onToggleAll", () => {
    const onToggleAll = vi.fn();
    const { rerender } = render(<AgendaTOC topics={topics} allCollapsed={false} onToggleAll={onToggleAll} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onToggleAll).toHaveBeenCalledTimes(1);

    rerender(<AgendaTOC topics={topics} allCollapsed onToggleAll={onToggleAll} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
  });

  it("expands a topic when its entry is clicked", () => {
    const onExpandTopic = vi.fn();
    render(<AgendaTOC topics={topics} onToggleAll={() => {}} onExpandTopic={onExpandTopic} />);
    fireEvent.click(screen.getByRole("link", { name: "Jump to Reporting" }));
    expect(onExpandTopic).toHaveBeenCalledWith("b");
  });

  it("does not expand anything when Open Floor is clicked", () => {
    const onExpandTopic = vi.fn();
    render(<AgendaTOC topics={topics} onToggleAll={() => {}} onExpandTopic={onExpandTopic} />);
    fireEvent.click(screen.getByRole("link", { name: "Jump to Open Floor" }));
    expect(onExpandTopic).not.toHaveBeenCalled();
  });
});

describe("AgendaTOC jump-to-collapsed ordering", () => {
  it("commits the expand before scrolling", async () => {
    const { useState } = await import("react");
    let bodyDisplayAtScroll;
    Element.prototype.scrollIntoView = vi.fn(() => {
      bodyDisplayAtScroll = document.getElementById("body-b").style.display;
    });
    function Harness() {
      const [collapsed, setCollapsed] = useState(true);
      return (
        <>
          <AgendaTOC topics={topics} onToggleAll={() => {}} onExpandTopic={() => setCollapsed(false)} />
          <div id="topic-b" />
          <div id="body-b" style={{ display: collapsed ? "none" : "block" }} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("link", { name: "Jump to Reporting" }));
    expect(bodyDisplayAtScroll).toBe("block");
  });
});
