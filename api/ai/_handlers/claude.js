// api/ai/_handlers/claude.js
//
// Shared model + call for Sync Meeting (prepare) and Refine. Both rewrite the
// WHOLE agenda as HTML, so their latency is output-bound. On Sonnet 4.6 the
// Unio Biweekly sync measured 270.6s (14K output tokens at ~52 tok/s) against
// Vercel's 300s maxDuration — any slower run 504'd. Opus 5.5 in fast mode ran
// the same inputs in 35.6s (2026-10-21).
//
// Opus 5.5 thinking is always on (adaptive); `thinking: { type: "disabled" }`
// is a 400, so callers control depth with output_config.effort only.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
const FAST_BETA = "fast-mode-2026-02-01";

// Fast mode has its own rate limit. On a 429 the same request is re-sent at
// standard speed (still Opus 5.5, ~2.5x slower) rather than failing the sync.
// maxRetries: 0 on the fast attempt — the SDK's own 429 retries honor an
// uncapped retry-after, and those sleeps plus the slower fallback could
// exceed maxDuration. A 429 delivered mid-stream (SSE error event) is not a
// RateLimitError and fails the request as before.
export async function streamMessage(client, params) {
  try {
    return await client.beta.messages
      .stream({ ...params, model: MODEL, speed: "fast", betas: [FAST_BETA] }, { maxRetries: 0 })
      .finalMessage();
  } catch (err) {
    if (!(err instanceof Anthropic.RateLimitError)) throw err;
    return await client.beta.messages.stream({ ...params, model: MODEL }).finalMessage();
  }
}
