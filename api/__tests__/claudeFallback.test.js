import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { streamMessage } from "../ai/_handlers/claude.js";

const headers = new Headers();
const rateLimit = () => new Anthropic.RateLimitError(429, {}, "rate limited", headers);
const overloaded = () => new Anthropic.InternalServerError(529, {}, "overloaded", headers);
const badRequest = () => new Anthropic.BadRequestError(400, {}, "bad request", headers);

// Fake client: each stream() call takes the next outcome (an Error rejects,
// anything else resolves) and records the body it was sent.
function fakeClient(outcomes) {
  const calls = [];
  const stream = vi.fn((body, opts) => {
    calls.push({ body, opts });
    const o = outcomes.shift();
    return { finalMessage: () => (o instanceof Error ? Promise.reject(o) : Promise.resolve(o)) };
  });
  return { client: { beta: { messages: { stream } } }, calls };
}

const params = { max_tokens: 100, messages: [] };

describe("streamMessage fallback chain", () => {
  it("uses Opus 5.5 fast mode first, with SDK retries off", async () => {
    const { client, calls } = fakeClient([{ id: "ok" }]);
    await expect(streamMessage(client, params)).resolves.toEqual({ id: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", speed: "fast", betas: ["fast-mode-2026-02-01"] });
    expect(calls[0].opts).toEqual({ maxRetries: 0 });
  });

  it("falls back to standard Opus 5.5 on a fast-mode 429", async () => {
    const { client, calls } = fakeClient([rateLimit(), { id: "ok" }]);
    await expect(streamMessage(client, params)).resolves.toEqual({ id: "ok" });
    expect(calls[1].body.model).toBe("claude-opus-5-5");
    expect(calls[1].body.speed).toBeUndefined();
  });

  it("falls back to Sonnet 5.5 when both Opus attempts are overloaded", async () => {
    const { client, calls } = fakeClient([overloaded(), overloaded(), { id: "ok" }]);
    await expect(streamMessage(client, params)).resolves.toEqual({ id: "ok" });
    expect(calls.map((c) => c.body.model)).toEqual(["claude-opus-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  it("throws the last error when every model fails", async () => {
    const last = overloaded();
    const { client } = fakeClient([rateLimit(), overloaded(), last]);
    await expect(streamMessage(client, params)).rejects.toBe(last);
  });

  it("does not fall back on a 400 — it would fail the same way on every model", async () => {
    const err = badRequest();
    const { client, calls } = fakeClient([err]);
    await expect(streamMessage(client, params)).rejects.toBe(err);
    expect(calls).toHaveLength(1);
  });
});
