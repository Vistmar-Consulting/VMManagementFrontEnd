// Working view topic card under a sidebar filter: a filter change opens or
// closes the card, but an item edited out of the filter must not collapse it.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../contexts/AuthContext.jsx", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../components/editor/CollabBodyEditor.jsx", () => ({ default: () => <div /> }));
vi.mock("../../components/MiniProjectBoard.jsx", () => ({ default: () => <div data-testid="board" /> }));

const { AgendaTopicCard } = await import("../AgendaDetail.jsx");

const ORG = "unio";
const TOPIC = { id: "t1", name: "PPC", categoryIds: ["c1"], tagIds: [] };
const item = (statusId) => ({ id: "p1", title: "One", statusId, order: "a0", organizationId: ORG, categoryId: "c1", assigneeIds: [] });

function renderCard(focusFilter, items) {
  const ui = (f, list) => (
    <AgendaTopicCard topic={TOPIC} agendaId="a1" organizationId={ORG} items={list} users={[]} userByEmail={{}}
      categories={[]} tags={[]} focusFilter={f} attendeeFilter={null} />
  );
  const result = render(ui(focusFilter, items));
  return { rerender: (f, list) => result.rerender(ui(f, list)) };
}

describe("AgendaTopicCard sidebar filter expansion", () => {
  it("stays open when its only matching item is edited out of the filter", () => {
    const { rerender } = renderCard("status-9", [item(9)]);
    expect(screen.queryByTestId("board")).toBeTruthy();
    rerender("status-9", [item(2)]);
    expect(screen.queryByTestId("board")).toBeTruthy();
  }, 60000);

  it("closes when the filter changes to one it has no items for", () => {
    const { rerender } = renderCard("status-9", [item(9)]);
    rerender("status-5", [item(9)]);
    expect(screen.queryByTestId("board")).toBeNull();
  }, 60000);
});
