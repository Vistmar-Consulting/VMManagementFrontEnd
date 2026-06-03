import { describe, it, expect } from "vitest";
import { ySyncPluginKey } from "y-prosemirror";
import { isLocalEditTransaction } from "../collabSync.js";

// y-prosemirror tags transactions it applies from a REMOTE Yjs update with
// { isChangeOrigin: true } under ySyncPluginKey. A local user edit has no such tag.
const tr = (syncMeta) => ({ getMeta: (k) => (k === ySyncPluginKey ? syncMeta : undefined) });

describe("isLocalEditTransaction", () => {
  it("local edit (no y-sync meta) → true", () => {
    expect(isLocalEditTransaction(tr(undefined))).toBe(true);
  });
  it("remote edit (isChangeOrigin true) → false", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: true }))).toBe(false);
  });
  it("y-sync meta present but not a change-origin → true", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: false }))).toBe(true);
  });
  it("malformed transaction (no getMeta) → true (treat as local, fail safe to mirror)", () => {
    expect(isLocalEditTransaction({})).toBe(true);
  });
});
