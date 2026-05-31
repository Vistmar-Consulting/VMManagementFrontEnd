// api/ai/generate.js
//
// Slice 3a — AI Meeting Agenda generation. Calls Claude with the stored prompt
// + the current agenda + the working/executive style + recent transcript
// summaries, and returns a proposed next agenda as structured JSON. The FE
// reviews the proposal before applying it (the agenda is snapshotted first).
//
// Auth: requireAuth (Firebase ID token) gates on @vistamarconsulting.com — the
// FE additionally shows the trigger to admins only. A finer per-user admin
// gate is deferred (this function has no Firestore-admin SDK; the domain gate
// keeps clients out).
//
// The model returns content via structured outputs (output_config.format), so
// the JSON is schema-conformant — no brittle text parsing.
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../meetings/_lib/cors.js";
import { requireAuth } from "../meetings/_lib/auth.js";

// Sonnet 4.6 — Andy's choice for agenda gen (fast + cheap, strong quality;
// admin-triggered low volume). Bump to Opus per-org later if needed.
const MODEL = "claude-sonnet-4-6";

// Generation reconciles a lot of input (transcripts + project board + other
// agendas + categorization). Give the function generous headroom so a long
// run isn't killed by the platform default. (Vercel reads per-function config.)
export const config = { maxDuration: 300 };

// Structured-output schema for the proposed agenda. Strings + a flat array;
// no recursion / numeric constraints (structured-outputs limitations).
const AGENDA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preBriefHtml: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          bodyHtml: { type: "string" },
          categories: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "bodyHtml", "categories", "tags"],
      },
    },
    openFloorHtml: { type: "string" },
  },
  required: ["preBriefHtml", "topics", "openFloorHtml"],
};

// Fill {{meetingStyle}} in the stored prompt, then append the HTML/output
// contract. The stored prompt varies per org + style, so there is no stable
// reusable prefix — no prompt caching for this one-shot call (per the
// prompt-caching prefix-match guidance).
function buildCategorization(categories, tagVocab) {
  const cats = Array.isArray(categories) ? categories : [];
  const tags = Array.isArray(tagVocab) ? tagVocab : [];
  if (cats.length === 0) return "";
  const catList = cats.map((c) => `- ${c.slug} — ${c.name}: ${c.description || ""}`).join("\n");
  const tagList = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).join(", ");
  const sops = cats
    .filter((c) => c.sop)
    .map((c) => `### ${c.name} (${c.slug})\n${c.sop}`)
    .join("\n\n");
  return `

## Categorization (REQUIRED for every topic)
For each topic, also set:
- categories: 1–3 category SLUGS from this list — the most relevant kinds of work the topic covers. Use the slug exactly.
${catList}
- tags: relevant tags from this vocabulary. Coin a NEW lowercase-hyphenated tag ONLY when nothing fits and it will recur (e.g. a specific initiative name).
Tags: ${tagList}

Use the SOPs below to assign categories accurately and to reference the right owner/contact in the agenda content (e.g. who executes website vs. technical work).

## Category SOPs (how each kind of work gets done + who to contact)
${sops}`;
}

function buildSystem(prompt, style, categories, tagVocab) {
  const filled = String(prompt || "").replaceAll("{{meetingStyle}}", style);
  return `${filled}

## How to use the inputs
- Reconcile the current agenda with everything that happened since this meeting last occurred: this client's meetings, internal Vistamar meetings, recent Project Board activity, this client's OTHER meeting agendas, and any additional context the user provided.
- The org operates holistically — be aware of everything happening across this client. Use the client's other agendas so this agenda stays coherent with them: don't duplicate or contradict what's already on another meeting's agenda, surface cross-meeting dependencies, and keep one consistent picture of the client's work.
- Internal Vistamar meetings (tagged [Vistamar internal]) are for YOUR situational awareness — never surface internal-only mechanics, staffing, or candor into a client-facing agenda, especially an executive one. Keep Vistamar looking strong and prepared to the client.
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.

## Output format
Return the proposed next agenda as JSON matching the provided schema:
- preBriefHtml: a SHORT HTML pre-brief framing this meeting (a few tight bullets), or "" if not warranted.
- topics: an array of { name, bodyHtml } — each a topic title plus a few tight HTML bullets of what is on the table now. Keep the count and length small.
- openFloorHtml: HTML for any open-floor items, or "".

HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>. No headings, no inline styles, no other tags. Be concise — never a long document.${buildCategorization(categories, tagVocab)}`;
}

const SCOPE_TAG = {
  "this-org": "Client",
  "vistamar-internal": "Vistamar internal",
};

function buildUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, extraContext) {
  const a = agenda || {};
  const lines = [];
  lines.push(`Generate the next ${style} meeting agenda for: ${a.title || "(untitled meeting)"}.`);
  lines.push("");
  lines.push("## Current agenda (move it forward from here)");
  lines.push(`Title: ${a.title || ""}`);
  if (a.preBriefHtml) lines.push(`Pre-Brief (HTML): ${a.preBriefHtml}`);
  (a.topics || []).forEach((t, i) => {
    lines.push(`Topic ${i + 1}: ${t.name || ""}`);
    if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
  });
  if (a.openFloorHtml) lines.push(`Open Floor (HTML): ${a.openFloorHtml}`);
  lines.push("");
  if (Array.isArray(transcripts) && transcripts.length > 0) {
    lines.push("## Recent meeting transcripts (what happened since last time)");
    transcripts.forEach((tr) => {
      const tag = SCOPE_TAG[tr.scope] || "Client";
      lines.push(`### [${tag}] ${tr.title || "Meeting"}${tr.date ? ` (${tr.date})` : ""}`);
      if (tr.overview) lines.push(`Overview: ${tr.overview}`);
      if (tr.actionItems) lines.push(`Action items: ${tr.actionItems}`);
      lines.push("");
    });
  } else {
    lines.push("## Recent meeting transcripts");
    lines.push("(none in the window — base the next agenda on the current agenda + the inputs below.)");
    lines.push("");
  }
  if (Array.isArray(projectBoard) && projectBoard.length > 0) {
    lines.push("## Recent Project Board activity (created or updated since last meeting)");
    projectBoard.forEach((it) => {
      const flag = it.isNew ? "NEW" : "updated";
      const proj = it.project ? ` — ${it.project}` : "";
      lines.push(`- [${flag}] ${it.name || "(untitled)"} (status: ${it.status || "?"})${proj}`);
    });
    lines.push("");
  }
  if (Array.isArray(orgAgendas) && orgAgendas.length > 0) {
    lines.push("## This client's other meeting agendas (current planning across the org — for coherence, not to copy)");
    orgAgendas.forEach((oa) => {
      lines.push(`### ${oa.title || "Meeting"}`);
      if (oa.preBriefHtml) lines.push(`Pre-Brief: ${oa.preBriefHtml}`);
      (oa.topics || []).forEach((t) => {
        lines.push(`- ${t.name || ""}${t.bodyHtml ? `: ${t.bodyHtml}` : ""}`);
      });
      if (oa.openFloorHtml) lines.push(`Open Floor: ${oa.openFloorHtml}`);
      lines.push("");
    });
  }
  if (extraContext && String(extraContext).trim()) {
    lines.push("## Additional context the user provided for this generation");
    lines.push(String(extraContext).trim());
    lines.push("");
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });
  }

  const { prompt, meetingStyle, agenda, transcripts, projectBoard, orgAgendas, extraContext, categories, tagVocab } = req.body || {};
  if (!prompt || !agenda) {
    return res.status(400).json({ error: "Missing required field: prompt and agenda" });
  }
  const style = meetingStyle === "executive" ? "executive" : "working";

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: buildSystem(prompt, style, categories, tagVocab),
      // medium effort — agenda gen is reconciliation + formatting, not hard
      // reasoning; medium roughly halves thinking time vs the default high,
      // keeping the call well under timeout without a quality hit.
      output_config: { effort: "medium", format: { type: "json_schema", schema: AGENDA_SCHEMA } },
      messages: [{ role: "user", content: buildUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, extraContext) }],
    });

    if (message.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "Generation was cut off (hit token limit). Try again." });
    }
    if (message.stop_reason === "refusal") {
      return res.status(502).json({ error: "The model declined to generate this agenda." });
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) {
      return res.status(502).json({ error: "The model returned no agenda content." });
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed agenda JSON." });
    }

    const proposal = {
      preBriefHtml: String(parsed.preBriefHtml || ""),
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.map((t) => ({
            name: String(t?.name || ""),
            bodyHtml: String(t?.bodyHtml || ""),
            categories: Array.isArray(t?.categories) ? t.categories.map((c) => String(c)) : [],
            tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
          }))
        : [],
      openFloorHtml: String(parsed.openFloorHtml || ""),
    };
    return res.status(200).json({ proposal });
  } catch (err) {
    console.error("ai/generate failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Agenda generation failed" });
  }
}
