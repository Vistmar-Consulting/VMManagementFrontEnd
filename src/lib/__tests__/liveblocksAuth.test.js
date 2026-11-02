import { describe, it, expect, vi } from "vitest";

vi.mock("../../firebase.js", () => ({
  auth: { currentUser: { uid: "u1", displayName: "A", getIdToken: async () => "tok" } },
  db: {},
}));
vi.mock("firebase/firestore", () => ({ doc: vi.fn(), getDoc: async () => ({ exists: () => false }) }));

const { authEndpoint } = await import("../liveblocks.js");

describe("authEndpoint", () => {
  it("a local build refused with 426 stops Liveblocks retrying instead of looping", async () => {
    expect(__BUILD_ID__).toBe("dev");
    globalThis.fetch = vi.fn(async () => ({ status: 426, ok: false }));
    await expect(authEndpoint("agenda:x")).resolves.toEqual({
      error: "forbidden",
      reason: expect.stringMatching(/local build/i),
    });
  });
});
