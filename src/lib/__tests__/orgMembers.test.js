import { describe, it, expect } from "vitest";
import { memberIdFromEmail, isClientEmail, deliverablesSummary } from "../orgMembers.js";

describe("memberIdFromEmail", () => {
  it("lowercases and trims a valid email", () => {
    expect(memberIdFromEmail("  David@UnioHP.com ")).toBe("david@uniohp.com");
  });
  it("returns null for malformed input (no @, no dot after @, whitespace)", () => {
    expect(memberIdFromEmail("notanemail")).toBeNull();
    expect(memberIdFromEmail("a@b")).toBeNull();
    expect(memberIdFromEmail("a b@x.com")).toBeNull();
    expect(memberIdFromEmail("")).toBeNull();
    expect(memberIdFromEmail(null)).toBeNull();
  });
});

describe("isClientEmail", () => {
  it("true for non-vistamar domains", () => {
    expect(isClientEmail("david@uniohp.com")).toBe(true);
  });
  it("false for vistamar (any case)", () => {
    expect(isClientEmail("adeemer@VistamarConsulting.com")).toBe(false);
  });
  it("false for malformed", () => {
    expect(isClientEmail("nope")).toBe(false);
  });
  it("false for the Fireflies notetaker and scheduling proxies", () => {
    expect(isClientEmail("fred@fireflies.ai")).toBe(false);
    expect(isClientEmail("anything@fireflies.ai")).toBe(false);
    expect(isClientEmail("meetings@vistamarconsulting.com")).toBe(false);
    expect(isClientEmail("seo@vistamarconsulting.com")).toBe(false);
  });
});

describe("deliverablesSummary", () => {
  it("joins the labels of set deliverables with a middot", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Social posts", quantity: 8, cadence: "month" },
    ])).toBe("Blog posts · Social posts");
  });
  it("omits rows with no positive quantity", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Empty", quantity: 0, cadence: "month" },
      { label: "Nullq", cadence: "month" },
    ])).toBe("Blog posts");
  });
  it("returns an em dash for empty/no deliverables", () => {
    expect(deliverablesSummary([])).toBe("—");
    expect(deliverablesSummary(null)).toBe("—");
  });
});
