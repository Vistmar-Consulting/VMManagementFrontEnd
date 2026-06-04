import { describe, it, expect } from "vitest";
import { buildTocEntries } from "../agendaToc.js";

describe("buildTocEntries", () => {
  it("returns [] for an empty agenda (TOC hides)", () => {
    expect(buildTocEntries([], { hasOpenFloor: true })).toEqual([]);
    expect(buildTocEntries(undefined, { hasOpenFloor: true })).toEqual([]);
  });

  it("numbers topics sequentially and appends Open Floor (non-master)", () => {
    const topics = [
      { id: "a", name: "Blog" },
      { id: "b", name: "Reporting" },
    ];
    const out = buildTocEntries(topics, { hasOpenFloor: true });
    expect(out).toEqual([
      { type: "topic", label: "Blog", anchorId: "topic-a", number: 1 },
      { type: "topic", label: "Reporting", anchorId: "topic-b", number: 2 },
      { type: "openfloor", label: "Open Floor", anchorId: "open-floor" },
    ]);
  });

  it("omits Open Floor when hasOpenFloor is false", () => {
    const out = buildTocEntries([{ id: "a", name: "X" }], { hasOpenFloor: false });
    expect(out.some((e) => e.type === "openfloor")).toBe(false);
  });

  it("falls back to 'Untitled' for blank/whitespace titles", () => {
    const out = buildTocEntries([{ id: "a", name: "  " }, { id: "b" }], {});
    expect(out[0].label).toBe("Untitled");
    expect(out[1].label).toBe("Untitled");
  });

  it("emits an org header only when org changes (master), numbering global", () => {
    const topics = [
      { id: "a", name: "A", organizationId: "o1" },
      { id: "b", name: "B", organizationId: "o1" },
      { id: "c", name: "C", organizationId: "o2" },
    ];
    const orgById = { o1: { id: "o1", name: "Unio", accentColor: "#111" }, o2: { id: "o2", name: "BMD", accentColor: "#222" } };
    const out = buildTocEntries(topics, { isMaster: true, orgById, hasOpenFloor: true });
    expect(out).toEqual([
      { type: "org", label: "Unio", anchorId: "org-o1", accentColor: "#111" },
      { type: "topic", label: "A", anchorId: "topic-a", number: 1 },
      { type: "topic", label: "B", anchorId: "topic-b", number: 2 },
      { type: "org", label: "BMD", anchorId: "org-o2", accentColor: "#222" },
      { type: "topic", label: "C", anchorId: "topic-c", number: 3 },
      { type: "openfloor", label: "Open Floor", anchorId: "open-floor" },
    ]);
  });

  it("uses a fallback org label when the org is missing from orgById", () => {
    const out = buildTocEntries([{ id: "a", name: "A", organizationId: "ghost" }], { isMaster: true, orgById: {}, hasOpenFloor: false });
    expect(out[0]).toEqual({ type: "org", label: "Unassigned", anchorId: "org-ghost", accentColor: undefined });
  });

  it("does NOT group by org when not master", () => {
    const topics = [{ id: "a", name: "A", organizationId: "o1" }, { id: "b", name: "B", organizationId: "o2" }];
    const out = buildTocEntries(topics, { isMaster: false, orgById: { o1: { id: "o1", name: "Unio" } }, hasOpenFloor: false });
    expect(out.every((e) => e.type === "topic")).toBe(true);
  });

  it("normalizes missing organizationId to 'unassigned' anchor in master mode", () => {
    const topics = [
      { id: "a", name: "A", organizationId: "o1" },
      { id: "b", name: "B" },          // no organizationId
      { id: "c", name: "C" },          // also no organizationId — same group, no second header
    ];
    const orgById = { o1: { id: "o1", name: "Unio", accentColor: "#111" } };
    const out = buildTocEntries(topics, { isMaster: true, orgById, hasOpenFloor: false });
    expect(out).toEqual([
      { type: "org", label: "Unio", anchorId: "org-o1", accentColor: "#111" },
      { type: "topic", label: "A", anchorId: "topic-a", number: 1 },
      { type: "org", label: "Unassigned", anchorId: "org-unassigned", accentColor: undefined },
      { type: "topic", label: "B", anchorId: "topic-b", number: 2 },
      { type: "topic", label: "C", anchorId: "topic-c", number: 3 },
    ]);
  });
});
