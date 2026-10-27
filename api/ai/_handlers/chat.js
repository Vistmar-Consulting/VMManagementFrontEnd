// api/ai/_handlers/chat.js
//
// Board Chat — ONE model call per request. The browser owns the tool loop: it
// runs the tools, appends tool_result blocks and POSTs again. Stateless; the
// browser sends the full append-only history every call (thinking blocks
// included, unchanged — required for preserved thinking on current models).
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../../meetings/_lib/cors.js";
import { requireAuth } from "../../meetings/_lib/auth.js";
import { resolveLatestSonnet } from "./chatModels.js";
import { costUsd } from "./chatPricing.js";
import { SYSTEM_PROMPT, TOOLS } from "./chatTools.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Missing required field: messages" });
  }

  const client = new Anthropic({ apiKey });
  let model;
  try {
    model = await resolveLatestSonnet(client);
  } catch (err) {
    return res.status(502).json({ error: `Could not resolve the latest Sonnet model: ${err.message}` });
  }

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    const cost = costUsd(message.model, message.usage);

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category;
      return res.status(502).json({
        error: `The model declined this request${category ? ` (${category})` : ""}.`,
        model: message.model,
        costUsd: cost,
      });
    }
    if (message.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "The reply was cut off (token limit).", model: message.model, costUsd: cost });
    }
    return res.status(200).json({
      content: message.content,
      stopReason: message.stop_reason,
      model: message.model,
      usage: message.usage,
      costUsd: cost,
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Rate limited by the Anthropic API — try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Anthropic API error ${err.status}: ${err.message}` });
    }
    return res.status(500).json({ error: err.message });
  }
}
