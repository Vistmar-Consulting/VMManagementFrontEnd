// api/ai/refine.js
//
// Refine an ALREADY-PROPOSED agenda from a user instruction. Unlike generate.js
// this looks at NO data sources (no transcripts / board / window) — it just
// edits the current draft proposal per the instruction (e.g. "add these two
// blogs", "drop the GBP topic", "tighten the Unio section"). Used by the AI Gen
// review step's Refine box; the result replaces the displayed proposal.
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../meetings/_lib/cors.js";
import { requireAuth } from "../meetings/_lib/auth.js";

const MODEL = "claude-sonnet-4-6";
export const config = { maxDuration: 300 };

// Same proposal schema as generate.js (master adds per-topic organizationId).
function buildSchema(master) {
  const topicProps = {
    topicId: { type: "string" },
    name: { type: "string" },
    bodyHtml: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  };
  const topicRequired = ["name", "bodyHtml", "categories", "tags"];
  if (master) {
    topicProps.organizationId = { type: "string" };
    topicRequired.push("organizationId");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      preBriefHtml: { type: "string" },
      topics: { type: "array", items: { type: "object", additionalProperties: false, properties: topicProps, required: topicRequired } },
      openFloorHtml: { type: "string" },
    },
    required: ["preBriefHtml", "topics", "openFloorHtml"],
  };
}

function categorizationBlock(categories, tagVocab) {
  const cats = Array.isArray(categories) ? categories : [];
  const tags = Array.isArray(tagVocab) ? tagVocab : [];
  if (!cats.length) return "";
  const catList = cats.map((c) => `- ${c.slug} — ${c.name}`).join("\n");
  const tagList = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).join(", ");
  return `

## Categorization
Keep each existing topic's categories/tags as-is. For any NEW topic you add, set categories (1–3 slugs from the list) and relevant tags.
Categories:
${catList}
Tags: ${tagList}`;
}

function orgListBlock(orgMeta) {
  return (Array.isArray(orgMeta) ? orgMeta : [])
    .map((o) => `- ${o.slug} — ${o.name}${o.type === "internal" ? " (Vistamar, internal)" : " (client)"}`)
    .join("\n") || "(none)";
}

function buildSystem(categories, tagVocab, master, orgMeta) {
  return `You are refining a DRAFT meeting agenda based on a single instruction from the user. You are given the current draft (pre-brief, topics, open floor) and an instruction.

Apply ONLY what the instruction asks — add, edit, remove, or reorder as requested. Keep everything else EXACTLY as it is: same topics, same wording, same order, same categories/tags, same links. Do not invent unrelated content, do not re-summarize untouched topics, do not look for outside information — work only from the draft + the instruction.

PRESERVE HYPERLINKS: keep every existing <a href="…"> verbatim (exact href + text). If the instruction adds a link/URL, include it as an <a href> too.

PRESERVE TOPIC IDS: each input topic carries a topicId (e.g. "t0", "t2"). For every topic you keep or edit, copy its topicId exactly into the output. Do NOT invent or change topicIds. Omit topicId only for a brand-new topic you add — the caller will assign a fresh id.

HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>. No headings, no inline styles, no other tags. Be concise.
${master ? `\nThis is the MASTER Touch Base agenda — organized org by org. EVERY topic must keep/set its organizationId (slug from the list). Place any new topic under the right org and keep org grouping intact.\n\n## Organizations (use these slugs for organizationId)\n${orgListBlock(orgMeta)}\n` : ""}
## Output
Return the FULL refined agenda (not a diff) as JSON matching the schema: preBriefHtml, topics[{ name, bodyHtml, categories, tags${master ? ", organizationId" : ""} }], openFloorHtml.${categorizationBlock(categories, tagVocab)}`;
}

function buildUserMessage(proposal, instruction, master) {
  const p = proposal || {};
  const lines = [];
  lines.push("## Current draft agenda");
  if (p.preBriefHtml) lines.push(`Pre-Brief (HTML): ${p.preBriefHtml}`);
  (p.topics || []).forEach((t, i) => {
    const idPart = t.topicId ? ` [topicId: ${t.topicId}]` : "";
    const orgPart = master && t.organizationId ? ` [organizationId: ${t.organizationId}]` : "";
    lines.push(`Topic ${i + 1}: ${t.name || ""}${idPart}${orgPart}`);
    if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
    if (t.categories?.length) lines.push(`  categories: ${t.categories.join(", ")}`);
    if (t.tags?.length) lines.push(`  tags: ${t.tags.join(", ")}`);
  });
  if (p.openFloorHtml) lines.push(`Open Floor (HTML): ${p.openFloorHtml}`);
  lines.push("");
  lines.push("## Instruction (apply ONLY this; leave everything else unchanged)");
  lines.push(String(instruction || "").trim());
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { proposal, instruction, categories, tagVocab, master, orgMeta } = req.body || {};
  if (!proposal || !instruction || !String(instruction).trim()) {
    return res.status(400).json({ error: "Missing required field: proposal and instruction" });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.stream({
      model: MODEL,
      max_tokens: master ? 24000 : 16000,
      thinking: { type: "adaptive" },
      system: buildSystem(categories, tagVocab, !!master, orgMeta || []),
      output_config: { effort: "medium", format: { type: "json_schema", schema: buildSchema(!!master) } },
      messages: [{ role: "user", content: buildUserMessage(proposal, instruction, !!master) }],
    }).finalMessage();

    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "Refine was cut off (token limit). Try again." });
    if (message.stop_reason === "refusal") return res.status(502).json({ error: "The model declined this refinement." });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) return res.status(502).json({ error: "The model returned no agenda content." });

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed agenda JSON." });
    }

    const refined = {
      preBriefHtml: String(parsed.preBriefHtml || ""),
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.map((t) => ({
            topicId: t?.topicId ? String(t.topicId) : null,
            name: String(t?.name || ""),
            bodyHtml: String(t?.bodyHtml || ""),
            categories: Array.isArray(t?.categories) ? t.categories.map((c) => String(c)) : [],
            tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
            organizationId: t?.organizationId ? String(t.organizationId) : null,
          }))
        : [],
      openFloorHtml: String(parsed.openFloorHtml || ""),
    };
    return res.status(200).json({ proposal: refined });
  } catch (err) {
    console.error("ai/refine failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Agenda refinement failed" });
  }
}
