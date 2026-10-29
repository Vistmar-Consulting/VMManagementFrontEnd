// src/lib/boardChat/__tests__/persist.test.js
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_TTL_MS, INTERRUPTED_NOTICE, clearChat, entriesToStore, loadChat, purgeExpiredChats, saveChat } from "../persist.js";

// jsdom's localStorage is not usable under this Node version.
const store = new Map();
const storage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
vi.stubGlobal("localStorage", storage);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("chat persistence", () => {
  it("round-trips a conversation", () => {
    saveChat("k", { entries: [{ user: "hi" }], draft: "x" }, 1000);
    expect(loadChat("k", 2000)).toEqual({ entries: [{ user: "hi" }], draft: "x" });
  });

  it("expires after the TTL and removes the record", () => {
    saveChat("k", { draft: "x" }, 0);
    expect(loadChat("k", CHAT_TTL_MS)).toEqual({ draft: "x" });
    expect(loadChat("k", CHAT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("discards a corrupt record instead of throwing", () => {
    localStorage.setItem("k", "{not json");
    expect(loadChat("k")).toBeNull();
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("purges expired records under a prefix, leaving live ones and other keys", () => {
    saveChat("vm-meeting-chat:u:a1", { draft: "old" }, 0);
    saveChat("vm-meeting-chat:u:a2", { draft: "new" }, CHAT_TTL_MS);
    localStorage.setItem("vm-meeting-chat:u:a3", "garbage");
    saveChat("other", { draft: "x" }, 0);
    purgeExpiredChats("vm-meeting-chat:", CHAT_TTL_MS + 1);
    expect([...store.keys()].sort()).toEqual(["other", "vm-meeting-chat:u:a2"]);
  });

  it("clears", () => {
    saveChat("k", { draft: "x" });
    clearChat("k");
    expect(loadChat("k")).toBeNull();
  });

  it("drops the record when the quota is exceeded, and rethrows anything else", () => {
    saveChat("k", { draft: "old" });
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    vi.spyOn(storage, "setItem").mockImplementationOnce(() => { throw quota; });
    expect(saveChat("k", { draft: "new" })).toBe(false);
    expect(loadChat("k")).toBeNull();
    vi.spyOn(storage, "setItem").mockImplementationOnce(() => { throw new Error("boom"); });
    expect(() => saveChat("k", {})).toThrow("boom");
  });
});

describe("entriesToStore", () => {
  const entries = [{ user: "a", reply: "b" }, { user: "c", reply: "" }];

  it("stores entries as-is when no turn is running", () => {
    expect(entriesToStore(entries, false)).toBe(entries);
  });

  it("marks the in-flight entry interrupted", () => {
    const out = entriesToStore(entries, true);
    expect(out[0]).toBe(entries[0]);
    expect(out[1]).toEqual({ user: "c", reply: "", notice: INTERRUPTED_NOTICE });
  });
});
