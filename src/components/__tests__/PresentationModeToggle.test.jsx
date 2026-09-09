// The "Meeting in Progress" header toggle. Pins the two things that matter:
// the button reports its state to assistive tech via aria-pressed, and a click
// reaches the parent exactly once.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PresentationModeToggle from "../PresentationModeToggle.jsx";

const getButton = () => screen.getByRole("button", { name: /meeting in progress/i });

describe("PresentationModeToggle", () => {
  it("reports the off state via aria-pressed", () => {
    render(<PresentationModeToggle active={false} onToggle={() => {}} />);
    expect(getButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the on state via aria-pressed", () => {
    render(<PresentationModeToggle active onToggle={() => {}} />);
    expect(getButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onToggle once per click", () => {
    const onToggle = vi.fn();
    render(<PresentationModeToggle active={false} onToggle={onToggle} />);
    fireEvent.click(getButton());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
