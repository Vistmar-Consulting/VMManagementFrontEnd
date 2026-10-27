// api/ai/_handlers/chatPricing.js
//
// USD per million tokens, Anthropic first-party rates (claude-api skill price
// table, cached 2026-10-06). cacheWrite = 5-minute cache write (1.25x input).
// A model missing here prices as null and the panel shows "unpriced" — when
// the latest Sonnet changes, add its row.
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

export function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return (
    (usage.input_tokens || 0) * p.input
    + (usage.output_tokens || 0) * p.output
    + (usage.cache_creation_input_tokens || 0) * p.cacheWrite
    + (usage.cache_read_input_tokens || 0) * p.cacheRead
  ) / 1_000_000;
}
