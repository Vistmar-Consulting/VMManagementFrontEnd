// Open Floor collapse. Same invariants as Overview topics: collapsing hides the
// collab editor without unmounting it, and a collapsed body stops being the
// shared toolbar's target. The header itself is the toggle.

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
          onFocus={(e) => focus?.setActiveEditor({ isDestroyed: false, view: { dom: e.currentTarget } })}
        />
      );
    },
  };
});

const { OpenFloorSection } = await import("../AgendaDetail.jsx");
const { EditorFocusProvider, useEditorFocus } = await import("../../components/editor/editorFocus.jsx");

function ActiveProbe() {
  const focus = useEditorFocus();
  return <span data-testid="active">{focus.activeEditor ? "set" : "none"}</span>;
}

function Harness({ initialCollapsed }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <EditorFocusProvider>
      <OpenFloorSection
        agendaId="a1"
        agenda={{ openFloorHtml: "<p>AOB</p>" }}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      <ActiveProbe />
    </EditorFocusProvider>
  );
}

describe("OpenFloorSection collapse", () => {
  it("renders collapsed and expands from the header without remounting the editor", () => {
    mounts.count = 0;
    render(<Harness initialCollapsed />);
    const body = screen.getByTestId("body");
    expect(body.parentElement).not.toBeVisible();
    const toggle = screen.getByRole("button", { name: "Expand Open Floor" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "open-floor-body");

    fireEvent.click(toggle);
    expect(body.parentElement).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse Open Floor" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Open Floor" }));
    expect(body.parentElement).not.toBeVisible();
    expect(screen.getByTestId("body")).toBe(body);
    expect(mounts.count).toBe(1);
  }, 60000);

  it("clears the toolbar target when it collapses", () => {
    render(<Harness initialCollapsed={false} />);
    fireEvent.focus(screen.getByTestId("body"));
    expect(screen.getByTestId("active")).toHaveTextContent("set");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Open Floor" }));
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  }, 60000);

  it("works outside the shared-toolbar provider (Working view)", () => {
    function Bare() {
      const [collapsed, setCollapsed] = useState(true);
      return (
        <OpenFloorSection agendaId="a1" agenda={{}} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      );
    }
    render(<Bare />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Open Floor" }));
    expect(screen.getByTestId("body").parentElement).toBeVisible();
  }, 60000);
});
