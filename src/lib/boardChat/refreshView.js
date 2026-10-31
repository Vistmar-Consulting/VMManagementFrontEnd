// src/lib/boardChat/refreshView.js
//
// Refresh a saved Board Chat view: rerun its request against the board as it
// is now and return the new filters. A conversation of its own (fresh board
// snapshot, nothing from the chat that made the view), so the answer can't
// lean on stale context. Board Chat's tools, except that no change can be
// proposed and the first set_board_filter call is the answer.
import { MAX_CALLS_PER_TURN, runTurn } from "./conversation.js";
import { planBoardFilter } from "./boardFilter.js";
import { boardContextText, buildBoardSnapshot, makeLookups } from "./snapshot.js";
import { runReadTool } from "./tools.js";

const EMPTY = { orgFilter: "all", titleSearch: "", columnFilters: {}, scorecardFilter: null, aiFilter: null };

export function refreshPrompt(label, request) {
  return [
    `Refresh my saved board view "${label}".`,
    `What it shows: ${request}`,
    "Work out which tasks and subtasks answer that now, from BOARD CONTEXT and your read tools, then call set_board_filter once with clear: true, the same label, the request, and the filters. Do not propose changes. Then reply in one short line with what changed.",
  ].join("\n");
}

// The request a view was made for: saved on the view, or (views made before
// requests were saved) the message that made it in its chat — the last
// exchange whose steps include "Filtered board: <label>".
export function requestFromChat(entries, label) {
  const step = `Filtered board: ${label}`;
  const hit = [...(entries || [])].reverse().find((e) => (e.steps || []).includes(step));
  return hit?.user || null;
}

// board: { items, users, orgs, categories, tags }. post(messages) calls the
// model. Returns { filters, reply, costUsd, unpriced }; throws when the turn
// fails or sets no filter (nothing is changed).
export async function refreshView({ label, request, board, user, post }) {
  const snap = buildBoardSnapshot(board);
  const lookups = makeLookups(board);
  let filters = null;
  const executeTool = async (name, input) => {
    if (name === "set_board_filter") {
      if (filters) throw new Error("The view is already set; reply now.");
      const plan = planBoardFilter({ ...input, clear: true }, board, EMPTY);
      if (plan.kind !== "view") throw new Error("Pass the view's filters, not clear alone.");
      filters = plan.filters;
      return { result: { applied: true, itemCount: filters.aiFilter?.itemIds.length ?? null }, step: "Set the view" };
    }
    if (name === "propose_changes") throw new Error("Not available while refreshing a view.");
    const out = await runReadTool(name, input, { items: board.items, lookups });
    return { result: out.result, step: name };
  };
  const messages = [{ role: "user", content: [
    { type: "text", text: boardContextText(snap.text, user, board.users) },
    { type: "text", text: refreshPrompt(label, request) },
  ] }];
  const out = await runTurn({ messages, post, executeTool });
  if (!filters) {
    throw Object.assign(new Error(out.done
      ? "Board Chat didn't set a filter, so the view is unchanged."
      : `Stopped after ${MAX_CALLS_PER_TURN} model calls without a filter; the view is unchanged.`), { turn: out.turn });
  }
  const last = [...out.messages].reverse().find((m) => m.role === "assistant");
  const reply = (last?.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  return { filters, reply, costUsd: out.turn.costUsd, unpriced: out.turn.unpriced };
}
