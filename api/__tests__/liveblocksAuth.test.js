import { describe, it, expect, vi } from "vitest";

vi.mock("@liveblocks/node", () => ({ Liveblocks: class {} }));

const { isStaleBuild } = await import("../liveblocks-auth.js");

describe("isStaleBuild", () => {
  it("lets the deployed build through", () => {
    expect(isStaleBuild("abc123", "abc123")).toBe(false);
  });
  it("refuses an older build", () => {
    expect(isStaleBuild("old999", "abc123")).toBe(true);
  });
  it("refuses bundles from before the check (no build ID)", () => {
    expect(isStaleBuild(undefined, "abc123")).toBe(true);
  });
  it("refuses local builds against a deployed API (any branch, no table schema guarantee)", () => {
    expect(isStaleBuild("dev", "abc123")).toBe(true);
  });
  it("enforces nothing when the server has no build ID (local API)", () => {
    expect(isStaleBuild(undefined, undefined)).toBe(false);
  });
});
