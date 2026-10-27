// api/__tests__/chat.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const list = vi.fn();
const requireAuth = vi.fn();
const MODELS = [
  { id: "claude-opus-5-5", created_at: "2026-09-01T00:00:00Z" },
  { id: "claude-sonnet-5", created_at: "2026-05-01T00:00:00Z" },
  { id: "claude-sonnet-5-5", created_at: "2026-08-01T00:00:00Z" },
];

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    constructor() {
      this.messages = { create };
      this.models = { list };
    }
  }
  Anthropic.APIError = APIError;
  Anthropic.RateLimitError = RateLimitError;
  Anthropic.BadRequestError = BadRequestError;
  Anthropic.APIConnectionError = APIConnectionError;
  return { default: Anthropic };
});
vi.mock("../meetings/_lib/cors.js", () => ({ applyCors: () => false }));
vi.mock("../meetings/_lib/auth.js", () => ({ requireAuth }));

const { pickLatestSonnet, resetModelCache } = await import("../ai/_handlers/chatModels.js");
const { costUsd } = await import("../ai/_handlers/chatPricing.js");
const { default: chat } = await import("../ai/_handlers/chat.js");
const { TOOLS } = await import("../ai/_handlers/chatTools.js");

function fakeRes() {
  const res = { statusCode: 0, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const req = (body) => ({ method: "POST", headers: {}, body });

beforeEach(() => {
  create.mockReset();
  list.mockReset();
  list.mockImplementation(() => (async function* () { yield* MODELS; })());
  requireAuth.mockReset();
  requireAuth.mockResolvedValue(true);
  resetModelCache();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("pickLatestSonnet", () => {
  it("picks the newest claude-sonnet-* by created_at", () => {
    expect(pickLatestSonnet(MODELS)).toBe("claude-sonnet-5-5");
  });
  it("throws when there is no Sonnet", () => {
    expect(() => pickLatestSonnet([{ id: "claude-opus-5-5", created_at: "2026-01-01" }])).toThrow("no Sonnet");
  });
});

describe("costUsd", () => {
  it("prices a known model", () => {
    const c = costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 });
    expect(c).toBeCloseTo(2 + 1 + 0.2, 6);
  });
  it("returns null for an unknown model", () => {
    expect(costUsd("claude-sonnet-9", { input_tokens: 1 })).toBeNull();
  });
});

describe("TOOLS", () => {
  it("every tool is strict with a closed schema", () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

describe("POST /api/ai/chat", () => {
  it("runs one call on the latest Sonnet and returns content + cost", async () => {
    create.mockResolvedValue({
      model: "claude-sonnet-5-5", stop_reason: "end_turn",
      content: [{ type: "text", text: "Hi" }],
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "hi" }] }), res);
    expect(res.statusCode).toBe(200);
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
    expect(create.mock.calls[0][0].tool_choice).toEqual({ type: "auto" });
    expect(res.body.content).toEqual([{ type: "text", text: "Hi" }]);
    expect(res.body.costUsd).toBeCloseTo(0.003, 6);
  });

  it("400s without messages", async () => {
    const res = fakeRes();
    await chat(req({}), res);
    expect(res.statusCode).toBe(400);
  });

  it("reports a refusal as 502 and still returns its cost", async () => {
    create.mockResolvedValue({
      model: "claude-sonnet-5-5", stop_reason: "refusal", stop_details: { category: "cyber" },
      content: [], usage: { input_tokens: 1000, output_tokens: 0 },
    });
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "x" }] }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/declined/);
    expect(res.body.costUsd).toBeCloseTo(0.002, 6);
  });

  it("passes an API 400 through verbatim", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    create.mockRejectedValue(new Anthropic.BadRequestError(400, "tool_choice not supported"));
    const res = fakeRes();
    await chat(req({ messages: [{ role: "user", content: "x" }] }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("tool_choice not supported");
  });

  const ok = {
    model: "claude-sonnet-5-5", stop_reason: "end_turn",
    content: [{ type: "text", text: "Hi" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const msgs = { messages: [{ role: "user", content: "x" }] };

  it("maps RateLimitError to 429 with a retry hint", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    create.mockRejectedValue(new Anthropic.RateLimitError(429, "slow down"));
    const res = fakeRes();
    await chat(req(msgs), res);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/try again/);
  });

  it("maps a generic APIError to 502", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    create.mockRejectedValue(new Anthropic.APIError(500, "boom"));
    const res = fakeRes();
    await chat(req(msgs), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("Anthropic API error 500: boom");
  });

  it("maps a connection error to 502 without an undefined status", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    create.mockRejectedValue(new Anthropic.APIConnectionError(undefined, "socket hang up"));
    const res = fakeRes();
    await chat(req(msgs), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("Could not reach the Anthropic API: socket hang up");
  });

  it("reports max_tokens as 502 with model and cost", async () => {
    create.mockResolvedValue({
      model: "claude-sonnet-5-5", stop_reason: "max_tokens", content: [],
      usage: { input_tokens: 1000, output_tokens: 0 },
    });
    const res = fakeRes();
    await chat(req(msgs), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.model).toBe("claude-sonnet-5-5");
    expect(res.body.costUsd).toBeCloseTo(0.002, 6);
  });

  it("400s when messages is a string", async () => {
    const res = fakeRes();
    await chat(req({ messages: "hi" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("405s on GET", async () => {
    const res = fakeRes();
    await chat({ method: "GET", headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("memoizes the model until the cache is reset", async () => {
    create.mockResolvedValue(ok);
    await chat(req(msgs), fakeRes());
    await chat(req(msgs), fakeRes());
    expect(list).toHaveBeenCalledTimes(1);
    resetModelCache();
    await chat(req(msgs), fakeRes());
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("502s when the model list fails and does not cache the failure", async () => {
    list.mockImplementationOnce(() => (async function* () { throw new Error("list down"); })());
    create.mockResolvedValue(ok);
    const res = fakeRes();
    await chat(req(msgs), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/list down/);
    const res2 = fakeRes();
    await chat(req(msgs), res2);
    expect(res2.statusCode).toBe(200);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("calls nothing when auth fails", async () => {
    requireAuth.mockResolvedValue(false);
    await chat(req(msgs), fakeRes());
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
