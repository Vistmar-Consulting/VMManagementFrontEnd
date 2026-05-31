// api/ai/suggest-tasks.js
//
// Slice 5a — AI-suggested Project Board tasks. Reads the meeting's window
// (transcripts + current agenda + other org agendas) with the FULL Client SOPs
// and proposes NEW tasks that surfaced but aren't on the board yet. The FE
// reviews, then writes the selected ones as statusId 8 ("AI Gen" triage).
//
// Separate from agenda generation (api/ai/generate.js) — a distinct, more
// deliberate action that uses the full SOPs (who-executes / who-to-contact).
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../meetings/_lib/cors.js";
import { requireAuth } from "../meetings/_lib/auth.js";

const MODEL = "claude-sonnet-4-6";
export const config = { maxDuration: 300 };

const TASKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["title", "category", "tags", "note"],
      },
    },
    moves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemId: { type: "string" },
          title: { type: "string" },
          toStatus: { type: "string" },
          reason: { type: "string" },
        },
        required: ["itemId", "title", "toStatus", "reason"],
      },
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemId: { type: "string" },
          title: { type: "string" },
          note: { type: "string" },
        },
        required: ["itemId", "title", "note"],
      },
    },
  },
  required: ["tasks", "moves", "notes"],
};

function buildSystem(categories, tagVocab) {
  const cats = Array.isArray(categories) ? categories : [];
  const tags = Array.isArray(tagVocab) ? tagVocab : [];
  const catList = cats.map((c) => `- ${c.slug} — ${c.name}: ${c.description || ""}`).join("\n");
  const tagList = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).join(", ");
  const sops = cats.filter((c) => c.sop).map((c) => `### ${c.name} (${c.slug})\n${c.sop}`).join("\n\n");
  return `You review a Vistamar Consulting client's marketing-meeting record and propose three kinds of Project Board updates a human will review: NEW tasks, STATUS MOVES on existing tasks, and NOTES on existing tasks. You are given the existing board tasks each with an itemId.

## tasks — NEW tasks
- Propose ONLY work that genuinely surfaced in the record and is NOT already on the board (don't duplicate existing tasks).
- Each: concrete action-oriented title; exactly ONE category slug; relevant tags; a one-line note citing the source (meeting/date) + naming the owner/contact (use the SOPs — e.g. Bill = website, Cedric = technical).

## moves — STATUS MOVES on EXISTING tasks
- When the record clearly indicates an existing task progressed, propose a move. Set itemId (exact, from the existing list), title (copy the existing title), toStatus (one of: Assigned, In Progress, Review, Done, Pending), and a one-line reason citing the source.
- Examples: transcript says something shipped/aired/published → toStatus "Done"; work actively underway → "In Progress"; awaiting sign-off → "Review"; blocked/waiting → "Pending". Only move when the record is clear — when unsure, omit.

## notes — context on EXISTING tasks
- When the record adds useful context to an existing task without changing its status, propose a note: itemId, title (copy existing), and the note text (cite the source).

Be precise, not exhaustive. Return empty arrays for any kind with nothing to propose.
- Use ONLY existing category slugs. Use existing tags where they fit; coin a new lowercase-hyphenated tag only when nothing fits and it'll recur.

## Categories
${catList}

## Tags
${tagList}

## Client SOPs (how each kind of work gets done + who to contact)
${sops}`;
}

function buildUserMessage(agenda, transcripts, orgAgendas, existingTasks, extraContext) {
  const lines = [];
  lines.push(`Meeting: ${agenda?.title || "(untitled)"}`);
  lines.push("");
  lines.push("## Existing board tasks (don't duplicate for new tasks; reference itemId for moves/notes)");
  (existingTasks || []).forEach((t) => lines.push(`- [itemId:${t.id}] ${t.title}${t.status ? ` [${t.status}]` : ""}${t.category ? ` (${t.category})` : ""}`));
  if (!existingTasks || existingTasks.length === 0) lines.push("(none)");
  lines.push("");
  if (Array.isArray(transcripts) && transcripts.length > 0) {
    lines.push("## Recent meeting transcripts");
    transcripts.forEach((tr) => {
      lines.push(`### ${tr.title || "Meeting"}${tr.date ? ` (${tr.date})` : ""}`);
      if (tr.overview) lines.push(`Overview: ${tr.overview}`);
      if (tr.actionItems) lines.push(`Action items: ${tr.actionItems}`);
      lines.push("");
    });
  }
  if (Array.isArray(orgAgendas) && orgAgendas.length > 0) {
    lines.push("## This client's current agendas (planning context)");
    orgAgendas.forEach((oa) => {
      lines.push(`### ${oa.title || "Meeting"}`);
      (oa.topics || []).forEach((t) => lines.push(`- ${t.name || ""}${t.bodyHtml ? `: ${t.bodyHtml}` : ""}`));
      lines.push("");
    });
  }
  if (extraContext && String(extraContext).trim()) {
    lines.push("## Additional context the user provided");
    lines.push(String(extraContext).trim());
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { agenda, transcripts, orgAgendas, existingTasks, categories, tagVocab, extraContext } = req.body || {};

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: buildSystem(categories, tagVocab),
      output_config: { effort: "medium", format: { type: "json_schema", schema: TASKS_SCHEMA } },
      messages: [{ role: "user", content: buildUserMessage(agenda, transcripts, orgAgendas, existingTasks, extraContext) }],
    });

    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "Generation cut off (token limit). Try again." });
    if (message.stop_reason === "refusal") return res.status(502).json({ error: "The model declined this request." });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) return res.status(502).json({ error: "The model returned no tasks." });

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed task JSON." });
    }

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((t) => ({
          title: String(t?.title || ""),
          category: String(t?.category || ""),
          tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
          note: String(t?.note || ""),
        })).filter((t) => t.title)
      : [];
    const moves = Array.isArray(parsed.moves)
      ? parsed.moves.map((m) => ({
          itemId: String(m?.itemId || ""),
          title: String(m?.title || ""),
          toStatus: String(m?.toStatus || ""),
          reason: String(m?.reason || ""),
        })).filter((m) => m.itemId && m.toStatus)
      : [];
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((n) => ({
          itemId: String(n?.itemId || ""),
          title: String(n?.title || ""),
          note: String(n?.note || ""),
        })).filter((n) => n.itemId && n.note)
      : [];
    return res.status(200).json({ tasks, moves, notes });
  } catch (err) {
    console.error("ai/suggest-tasks failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Task suggestion failed" });
  }
}
