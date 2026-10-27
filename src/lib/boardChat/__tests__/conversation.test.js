// src/lib/boardChat/__tests__/conversation.test.js
import { describe, it, expect, vi } from "vitest";
import { MAX_CALLS_PER_TURN, formatUsd, runTurn } from "../conversation.js";

const user = { role: "user", content: "hi" };

describe("runTurn", () => {
  it("loops through a tool call and sums cost", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0.01, content: [{ type: "tool_use", id: "t1", name: "get_item", input: { itemId: "p1" } }] })
      .mockResolvedValueOnce({ stopReason: "end_turn", costUsd: 0.02, content: [{ type: "text", text: "Done" }] });
    const executeTool = vi.fn().mockResolvedValue({ result: { ok: 1 }, step: "Read I-4" });
    const out = await runTurn({ messages: [user], post, executeTool });
    expect(out.done).toBe(true);
    expect(out.turn.costUsd).toBeCloseTo(0.03, 6);
    expect(out.turn.steps).toEqual(["Read I-4"]);
    expect(out.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"ok\":1}" }] });
    expect(out.messages[3].content[0].text).toBe("Done");
  });

  it("returns a tool failure to the model as is_error", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t1", name: "get_item", input: {} }] })
      .mockResolvedValueOnce({ stopReason: "end_turn", costUsd: 0, content: [] });
    const out = await runTurn({ messages: [user], post, executeTool: async () => { throw new Error("No item x"); } });
    expect(out.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "t1", content: "No item x", is_error: true });
  });

  it("marks unpriced when a call has no cost", async () => {
    const post = vi.fn().mockResolvedValue({ stopReason: "end_turn", costUsd: null, content: [] });
    const out = await runTurn({ messages: [user], post, executeTool: vi.fn() });
    expect(out.turn.unpriced).toBe(true);
  });

  it("stops at the call cap", async () => {
    const post = vi.fn().mockResolvedValue({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t", name: "x", input: {} }] });
    const out = await runTurn({ messages: [user], post, executeTool: async () => ({ result: {}, step: "x" }) });
    expect(out.done).toBe(false);
    expect(post).toHaveBeenCalledTimes(MAX_CALLS_PER_TURN);
  });

  it("at the cap, answers every pending tool_use without running it", async () => {
    const post = vi.fn().mockResolvedValue({
      stopReason: "tool_use", costUsd: 0.001,
      content: [
        { type: "thinking", thinking: "t", signature: "s" },
        { type: "tool_use", id: "a", name: "get_item", input: {} },
        { type: "tool_use", id: "b", name: "propose_changes", input: {} },
      ],
    });
    const executeTool = vi.fn().mockResolvedValue({ result: {}, step: "x" });
    const out = await runTurn({ messages: [user], post, executeTool });
    expect(executeTool).toHaveBeenCalledTimes(2 * (MAX_CALLS_PER_TURN - 1));
    expect(out.turn.costUsd).toBeCloseTo(0.001 * MAX_CALLS_PER_TURN, 6);
    const last = out.messages[out.messages.length - 1];
    const prev = out.messages[out.messages.length - 2];
    expect(prev.role).toBe("assistant");
    expect(last.role).toBe("user");
    expect(last.content.map((b) => b.tool_use_id)).toEqual(["a", "b"]);
    expect(last.content.every((b) => b.type === "tool_result" && b.is_error === true)).toBe(true);
    expect(last.content[0].content).toMatch(/10/);
  });

  it("every tool_use is answered by the next user message, in order", async () => {
    const post = vi.fn().mockResolvedValue({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t", name: "x", input: {} }] });
    const out = await runTurn({ messages: [user], post, executeTool: async () => ({ result: {}, step: "x" }) });
    out.messages.forEach((m, i) => {
      if (m.role !== "assistant") return;
      const ids = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
      const next = out.messages[i + 1];
      expect(next.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id)).toEqual(ids);
    });
  });

  it("keeps assistant content exactly as returned, thinking included", async () => {
    const content = [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "Hi" }];
    const post = vi.fn().mockResolvedValue({ stopReason: "end_turn", costUsd: 0, content });
    const out = await runTurn({ messages: [user], post, executeTool: vi.fn() });
    expect(out.messages[1]).toEqual({ role: "assistant", content });
  });

  it("a mid-turn error keeps cost already billed plus the error's cost, and history up to the last tool_results", async () => {
    const err = Object.assign(new Error("Anthropic API error 529: overloaded"), { costUsd: 0.002, model: "m" });
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0.01, content: [{ type: "tool_use", id: "t1", name: "get_item", input: { itemId: "p1" } }] })
      .mockRejectedValueOnce(err);
    const executeTool = vi.fn().mockResolvedValue({ result: { ok: 1 }, step: "Read I-4" });
    const caught = await runTurn({ messages: [user], post, executeTool }).catch((e) => e);
    expect(caught.message).toBe("Anthropic API error 529: overloaded");
    expect(caught.turn.costUsd).toBeCloseTo(0.012, 6);
    expect(caught.turn.steps).toEqual(["Read I-4"]);
    expect(caught.messages).toHaveLength(3);
    expect(caught.messages[2].content[0].tool_use_id).toBe("t1");
  });

  it("an unbilled error (no model) is not unpriced; a billed one with null cost is", async () => {
    const unbilled = await runTurn({ messages: [user], post: vi.fn().mockRejectedValue(new Error("Rate limited")), executeTool: vi.fn() }).catch((e) => e);
    expect(unbilled.turn).toEqual({ costUsd: 0, unpriced: false, steps: [] });
    const billed = await runTurn({ messages: [user], post: vi.fn().mockRejectedValue(Object.assign(new Error("declined"), { costUsd: null, model: "m" })), executeTool: vi.fn() }).catch((e) => e);
    expect(billed.turn.unpriced).toBe(true);
  });

  it("reports progress through onUpdate", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0, content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] })
      .mockResolvedValueOnce({ stopReason: "end_turn", costUsd: 0, content: [] });
    const onUpdate = vi.fn();
    await runTurn({ messages: [user], post, executeTool: async () => ({ result: {}, step: "x" }), onUpdate });
    expect(onUpdate.mock.calls.map((c) => c[0].messages.length)).toEqual([2, 3, 4]);
  });

  it("an API error carries the messages so far, for Retry, and its cost", async () => {
    const err = Object.assign(new Error("boom"), { costUsd: 0.004, model: "m" });
    const post = vi.fn().mockRejectedValue(err);
    await expect(runTurn({ messages: [user], post, executeTool: vi.fn() })).rejects.toMatchObject({ messages: [user], turn: { costUsd: 0.004 } });
  });
});

describe("runTurn empty tool_use", () => {
  it("tool_use stop with no tool_use blocks ends the turn with an error, keeping cost and a resendable history", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0.01, content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] })
      .mockResolvedValueOnce({ stopReason: "tool_use", costUsd: 0.02, model: "m", content: [{ type: "text", text: "hmm" }] });
    const executeTool = vi.fn().mockResolvedValue({ result: {}, step: "x" });
    const err = await runTurn({ messages: [user], post, executeTool }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("The model asked for tools but sent none.");
    expect(err.turn.costUsd).toBeCloseTo(0.03, 6);
    expect(post).toHaveBeenCalledTimes(2);
    expect(err.messages).toHaveLength(3);
    expect(err.messages[2].role).toBe("user");
    expect(err.messages[2].content[0].tool_use_id).toBe("t1");
  });
});

describe("formatUsd", () => {
  it("shows 4 decimals under a cent, 2 above", () => {
    expect(formatUsd(0.00412)).toBe("$0.0041");
    expect(formatUsd(0.5)).toBe("$0.50");
  });

  it("shows <$0.0001 for a positive amount that would round to zero, $0.0000 for zero", () => {
    expect(formatUsd(0.00004)).toBe("<$0.0001");
    expect(formatUsd(0)).toBe("$0.0000");
  });
});
