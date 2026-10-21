// api/ai/_handlers/claude.js
//
// Shared model + call for Sync Meeting (prepare) and Refine. Both rewrite the
// WHOLE agenda as HTML, so their latency is output-bound. On Sonnet 4.6 the
// Unio Biweekly sync measured 270.6s (14K output tokens at ~52 tok/s) against
// Vercel's 300s maxDuration — any slower run 504'd. Opus 5.5 in fast mode ran
// the same inputs in 35.6s (2026-10-21).
//
// Thinking is always adaptive on these models (Opus 5.5 rejects
// `thinking: { type: "disabled" }`), so callers control depth with
// output_config.effort only.
import Anthropic from "@anthropic-ai/sdk";

const FAST_BETA = "fast-mode-2026-02-01";

// Fallback chain, tried in order when an attempt fails before producing a
// result. `startBy` = latest elapsed ms at which the attempt may still start
// and finish inside maxDuration (300s); later attempts are skipped and the
// last error is thrown. Pre-output failures (429, 529, 5xx, connection) land
// in seconds, so in practice every step gets its chance.
const ATTEMPTS = [
  { label: "opus-5.5 fast", model: "claude-opus-5-5", fast: true, startBy: Infinity },
  { label: "opus-5.5", model: "claude-opus-5-5", fast: false, startBy: 60_000 },
  { label: "sonnet-5.5", model: "claude-sonnet-5-5", fast: false, startBy: 90_000 },
];

// Worth trying another model: rate limits, overload/5xx, network failures.
// A 4xx (bad request, auth) would fail the same way on every model.
function isFallbackError(err) {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (!(err instanceof Anthropic.APIError)) return false;
  return err.status == null || err.status === 429 || err.status >= 500;
}

// maxRetries: 0 on every attempt — the SDK's own retries honor an uncapped
// retry-after, and those sleeps would eat the time the next model needs.
export async function streamMessage(client, params) {
  const t0 = Date.now();
  let lastErr;
  for (const a of ATTEMPTS) {
    if (Date.now() - t0 > a.startBy) break;
    const body = a.fast
      ? { ...params, model: a.model, speed: "fast", betas: [FAST_BETA] }
      : { ...params, model: a.model };
    try {
      return await client.beta.messages.stream(body, { maxRetries: 0 }).finalMessage();
    } catch (err) {
      if (!isFallbackError(err)) throw err;
      console.warn(`ai: ${a.label} failed (${err.status ?? err.name}); trying next model`);
      lastErr = err;
    }
  }
  throw lastErr;
}
