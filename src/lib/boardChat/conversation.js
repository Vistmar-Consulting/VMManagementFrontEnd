// src/lib/boardChat/conversation.js
//
// One user turn: POST, run any tool calls, POST again — until the model ends
// its turn or the call cap is hit. History is append-only: assistant content
// goes back exactly as received (thinking blocks included).
//
// Every assistant tool_use is answered by a tool_result in the next user
// message, or the API rejects the following request. At the cap the pending
// tool calls are answered with an is_error result instead of being run: no
// further model call would see their output, and propose_changes would open
// the change modal after the turn has already stopped.
export const MAX_CALLS_PER_TURN = 10;

const CAP_MESSAGE = `Not run: this turn reached its limit of ${MAX_CALLS_PER_TURN} model calls. The user can ask again to continue.`;

export function formatUsd(n) {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function addCost(turn, costUsd, billed) {
  if (typeof costUsd === "number") turn.costUsd += costUsd;
  else if (billed) turn.unpriced = true;
}

async function runTools(uses, executeTool, turn) {
  const results = [];
  for (const use of uses) {
    try {
      const out = await executeTool(use.name, use.input);
      turn.steps.push(out.step);
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.result) });
    } catch (err) {
      turn.steps.push(`${use.name} failed`);
      results.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
    }
  }
  return results;
}

export async function runTurn({ messages: start, post, executeTool, onUpdate }) {
  let messages = start;
  const turn = { costUsd: 0, unpriced: false, steps: [] };
  for (let call = 1; call <= MAX_CALLS_PER_TURN; call++) {
    let data;
    try {
      data = await post(messages);
    } catch (err) {
      addCost(turn, err.costUsd, Boolean(err.model));
      throw Object.assign(err, { messages, turn });
    }
    addCost(turn, data.costUsd, true);
    messages = [...messages, { role: "assistant", content: data.content }];
    onUpdate?.({ messages, turn });
    if (data.stopReason !== "tool_use") return { messages, turn, done: true };

    const uses = data.content.filter((b) => b.type === "tool_use");
    const capped = call === MAX_CALLS_PER_TURN;
    const results = capped
      ? uses.map((use) => ({ type: "tool_result", tool_use_id: use.id, content: CAP_MESSAGE, is_error: true }))
      : await runTools(uses, executeTool, turn);
    messages = [...messages, { role: "user", content: results }];
    onUpdate?.({ messages, turn });
    if (capped) return { messages, turn, done: false };
  }
  return { messages, turn, done: false };
}
