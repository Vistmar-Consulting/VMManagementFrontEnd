// src/lib/boardChat/__tests__/api.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ currentUser: null }));
vi.mock("../../../firebase.js", () => ({ auth }));

const { postChat } = await import("../api.js");

function respond(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("postChat", () => {
  beforeEach(() => {
    auth.currentUser = { getIdToken: async () => "tok" };
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the messages with the Firebase ID token", async () => {
    const body = { content: [], stopReason: "end_turn", model: "m", usage: {}, costUsd: 0.01 };
    fetch.mockResolvedValue(respond(200, body));
    const msgs = [{ role: "user", content: "hi" }];
    await expect(postChat(msgs)).resolves.toEqual(body);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("/api/ai/chat");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-User-Token"]).toBe("tok");
    expect(JSON.parse(opts.body)).toEqual({ messages: msgs });
  });

  it("throws when signed out, without calling fetch", async () => {
    auth.currentUser = null;
    await expect(postChat([])).rejects.toThrow("Not signed in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a billed error (refusal) carries costUsd and model", async () => {
    fetch.mockResolvedValue(respond(502, { error: "The model declined this request (cyber).", model: "m", costUsd: 0.003 }));
    await expect(postChat([])).rejects.toMatchObject({ message: "The model declined this request (cyber).", costUsd: 0.003, model: "m" });
  });

  it("an unbilled error (429) has no cost or model", async () => {
    fetch.mockResolvedValue(respond(429, { error: "Rate limited by the Anthropic API — try again in a minute." }));
    const err = await postChat([]).catch((e) => e);
    expect(err.message).toMatch(/Rate limited/);
    expect(err.costUsd).toBeUndefined();
    expect(err.model).toBeUndefined();
  });

  it("a non-JSON error body falls back to the status", async () => {
    fetch.mockResolvedValue({ ok: false, status: 504, json: async () => { throw new SyntaxError("bad"); } });
    await expect(postChat([])).rejects.toThrow("HTTP 504");
  });
});
