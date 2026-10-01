// Overview topic collapse. Pins the two invariants the design rests on:
// collapsing hides the collab editor without unmounting it, and a collapsed
// body stops being the shared toolbar's target.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect, useState } from "react";

const mounts = { count: 0 };

vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../components/editor/CollabBodyEditor.jsx", async () => {
  const { useEditorFocus } = await import("../../components/editor/editorFocus.jsx");
  return {
    default: function FakeCollabBodyEditor() {
      const focus = useEditorFocus();
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return (
        <div
          data-testid="body"
          tabIndex={0}
          onFocus={(e) => focus.setActiveEditor({ isDestroyed: false, view: { dom: e.currentTarget } })}
        />
      );
    },
  };
});

const { OverviewTopic } = await import("../AgendaDetail.jsx");
const { EditorFocusProvider, useEditorFocus } = await import("../../components/editor/editorFocus.jsx");

function ActiveProbe() {
  const focus = useEditorFocus();
  return <span data-testid="active">{focus.activeEditor ? "set" : "none"}</span>;
}

function Harness() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <EditorFocusProvider>
      <OverviewTopic
        topic={{ id: "t1", name: "Blog" }}
        agendaId="a1"
        dragHandleProps={{}}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      <ActiveProbe />
    </EditorFocusProvider>
  );
}

describe("OverviewTopic collapse", () => {
  it("hides the body without unmounting the editor", () => {
    mounts.count = 0;
    render(<Harness />);
    const body = screen.getByTestId("body");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Blog" }));
    expect(body.parentElement).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Expand Blog" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Expand Blog" }));
    expect(body.parentElement).toBeVisible();
    expect(screen.getByTestId("body")).toBe(body);
    expect(mounts.count).toBe(1);
  });

  it("clears the toolbar target when its topic collapses", () => {
    render(<Harness />);
    fireEvent.focus(screen.getByTestId("body"));
    expect(screen.getByTestId("active")).toHaveTextContent("set");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Blog" }));
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });
});
