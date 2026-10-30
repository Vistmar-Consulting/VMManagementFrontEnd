// api/ai/sync-board.js (dispatched)
//
// Board Sync — Project Board changes (creates / moves / notes) for ONE org,
// from the transcripts the ledger marks new for that org. No agenda output.
// The Task Board fires one request per selected org in parallel and merges the
// results into one review (spec docs/superpowers/specs/2026-10-26-board-sync-design.md).
//
// Auth: requireAuth (Firebase ID token, @vistamarconsulting.com) PLUS an
// Andy-only email check — Board Sync is restricted to adeemer@.
import Anthropic from "@anthropic-ai/sdk";
import { applyCors } from "../../meetings/_lib/cors.js";
import { requireAuth } from "../../meetings/_lib/auth.js";
import { VISTAMAR_BOARD_SCOPE, CREATE_BASE_RULES, PARENT_REF_RULES, MOVES_RULES, NOTES_RULES } from "../_lib/boardRules.js";

// Same model as prepare.js.
const MODEL = "claude-sonnet-4-6";

// Twin: src/lib/boardSyncCore.js BOARD_SYNC_EMAIL (api/ can't import src/).
// __tests__/syncBoard.test.js asserts the two match.
export const BOARD_SYNC_EMAIL = "adeemer@vistamarconsulting.com";

export function isBoardSyncAllowed(email) {
  return String(email || "").toLowerCase().trim() === BOARD_SYNC_EMAIL;
}

// Board changes only. Unlike prepare.js, creates carry their own categories +
// tags — there is no topic to inherit from.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    boardChanges: {
      type: "object",
      additionalProperties: false,
      properties: {
        creates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              note: { type: "string" },
              parentRef: { type: "string" },
              categories: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["title", "note", "categories", "tags"],
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
      required: ["creates", "moves", "notes"],
    },
  },
  required: ["boardChanges"],
};

function categorizationBlock(categories, tagVocab) {
  const cats = Array.isArray(categories) ? categories : [];
  const tags = Array.isArray(tagVocab) ? tagVocab : [];
  if (cats.length === 0) return "";
  const catList = cats.map((c) => `- ${c.slug} — ${c.name}: ${c.description || ""}`).join("\n");
  const tagList = tags.map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean).join(", ");
  const sops = cats.filter((c) => c.sop).map((c) => `### ${c.name} (${c.slug})\n${c.sop}`).join("\n\n");
  return `

## Categories (slugs)
${catList}

## Tag vocabulary
${tagList || "(none)"}${sops ? `\n\n## Category SOPs (how each kind of work gets done + who to contact)\n${sops}` : ""}`;
}

export function buildSystem({ orgPrompt, org, categories, tagVocab }) {
  const internal = org?.type === "internal" || org?.slug === "vistamar";
  const orgContext = String(orgPrompt || "").replaceAll("{{meetingStyle}}", "working");
  return `You maintain the Vistamar Project Board for ONE organization: ${org?.name || org?.slug} (${org?.slug}${internal ? ", Vistamar internal" : ", client"}).
You are NOT writing a meeting agenda. Your only output is boardChanges for this organization's board.

## Organization context
This is the organization's meeting-agenda prompt. Use it for knowledge of the org, its people and priorities; ignore any instructions in it about agenda format or topics.
${orgContext || "(none)"}

## How to use the inputs
- NEW transcripts are meetings not yet turned into board changes for this org. Create tasks ONLY from these.
- CONTEXT-ONLY transcripts are meetings already synced for this org. Never create a task from them alone; use them to justify moves and notes and to avoid duplicates.
- A cross-org meeting (e.g. the Monday Touch Base) covers every organization: take ONLY the parts about ${org?.name || org?.slug}.${internal ? "" : `
- NEW transcripts marked "Vistamar internal" are internal Vistamar meetings (platform, business development). Create tasks from them ONLY for work they assign to ${org?.name || org?.slug}; ignore the rest. They often repeat what the Touch Base or this org's own meetings already covered, so check the existing tasks before every create.`}
- Use the existing tasks, recent board activity, this org's current agendas (planning context) and any user-provided context to stay consistent and avoid duplicates.

${internal ? `${VISTAMAR_BOARD_SCOPE}\n\n` : ""}### boardChanges.creates — NEW tasks
${CREATE_BASE_RULES}
- Set categories to an array with exactly ONE category SLUG from the list below (use the slug exactly), and tags from the vocabulary. Coin a NEW lowercase-hyphenated tag ONLY when nothing fits and it will recur. Never coin a tag for urgency or a blocked state (e.g. "urgent", "blocked") — those are statuses.
${PARENT_REF_RULES}

${MOVES_RULES}

${NOTES_RULES}

Be precise, not exhaustive. Return empty arrays for any boardChanges kind with nothing to propose.${categorizationBlock(categories, tagVocab)}`;
}

const SCOPE_TAG = { "already-synced": "Already synced" };

function sharedSuffix(tr, orgName) {
  const from = tr.sharedFrom || tr.scope;
  if (from === "vistamar-internal") return ` [Vistamar internal — take only ${orgName}'s parts]`;
  if (from === "cross-org") return ` [cross-org — take only ${orgName}'s parts]`;
  return "";
}

function transcriptLines(lines, list, orgName, tagged) {
  list.forEach((tr) => {
    const tag = tagged ? `[${SCOPE_TAG[tr.scope] || "Context"}] ` : "";
    const cross = sharedSuffix(tr, orgName);
    lines.push(`### ${tag}${tr.title || "Meeting"}${tr.date ? ` (${tr.date})` : ""}${cross}`);
    if (tr.overview) lines.push(`Overview: ${tr.overview}`);
    if (tr.actionItems) lines.push(`Action items: ${tr.actionItems}`);
    lines.push("");
  });
}

export function buildUserMessage({ org, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext }) {
  const orgName = org?.name || org?.slug || "this org";
  const lines = [`Propose the Project Board changes for ${orgName} from the record below.`, ""];

  lines.push("## Existing board tasks (don't duplicate for new creates; reference itemId for moves/notes)");
  (existingTasks || []).forEach((t) => lines.push(`- [itemId:${t.id}] ${t.title}${t.status ? ` [${t.status}]` : ""}${t.category ? ` (${t.category})` : ""}`));
  if (!existingTasks?.length) lines.push("(none)");
  lines.push("");

  lines.push("## NEW meeting transcripts (create tasks from these)");
  if (transcripts?.length) transcriptLines(lines, transcripts, orgName, false);
  else lines.push("(none — propose moves/notes only if the context clearly supports them)", "");

  if (contextTranscripts?.length) {
    lines.push("## CONTEXT-ONLY transcripts (never create tasks from these alone)");
    transcriptLines(lines, contextTranscripts, orgName, true);
  }

  if (projectBoard?.length) {
    lines.push("## Recent Project Board activity (last 30 days)");
    projectBoard.forEach((it) => lines.push(`- [${it.isNew ? "NEW" : "updated"}] ${it.name || "(untitled)"} (status: ${it.status || "?"})${it.project ? ` — ${it.project}` : ""}`));
    lines.push("");
  }
  if (orgAgendas?.length) {
    lines.push("## This org's current meeting agendas (planning context, don't copy)");
    orgAgendas.forEach((oa) => {
      lines.push(`### ${oa.title || "Meeting"}`);
      (oa.topics || []).forEach((t) => lines.push(`- ${t.name || ""}${t.bodyHtml ? `: ${t.bodyHtml}` : ""}`));
      lines.push("");
    });
  }
  if (extraContext && String(extraContext).trim()) {
    lines.push("## Additional context the user provided for this sync");
    lines.push(String(extraContext).trim());
  }
  return lines.join("\n");
}

export function normalizeBoardChanges(parsed) {
  const bc = parsed?.boardChanges || {};
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x)) : []);
  return {
    creates: (Array.isArray(bc.creates) ? bc.creates : [])
      .map((c) => ({
        title: String(c?.title || ""),
        note: String(c?.note || ""),
        parentRef: typeof c?.parentRef === "string" ? c.parentRef : "",
        categories: strs(c?.categories),
        tags: strs(c?.tags),
      }))
      .filter((c) => c.title),
    moves: (Array.isArray(bc.moves) ? bc.moves : [])
      .map((m) => ({ itemId: String(m?.itemId || ""), title: String(m?.title || ""), toStatus: String(m?.toStatus || ""), reason: String(m?.reason || "") }))
      .filter((m) => m.itemId && m.toStatus),
    notes: (Array.isArray(bc.notes) ? bc.notes : [])
      .map((n) => ({ itemId: String(n?.itemId || ""), title: String(n?.title || ""), note: String(n?.note || "") }))
      .filter((n) => n.itemId && n.note),
  };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;
  if (!isBoardSyncAllowed(req.authUser?.email)) {
    return res.status(403).json({ error: "Board Sync is restricted to adeemer@vistamarconsulting.com" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });

  const { org, orgPrompt, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext, categories, tagVocab } = req.body || {};
  if (!org?.slug) return res.status(400).json({ error: "Missing required field: org" });

  try {
    const client = new Anthropic({ apiKey });
    // Streamed for the same reason as prepare.js (long max_tokens trips the
    // SDK's non-streaming guard). Board-only output is smaller than Sync Meeting.
    const message = await client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: buildSystem({ orgPrompt, org, categories, tagVocab }),
      messages: [{ role: "user", content: buildUserMessage({ org, transcripts, contextTranscripts, projectBoard, existingTasks, orgAgendas, extraContext }) }],
    }).finalMessage();

    if (message.stop_reason === "max_tokens") return res.status(502).json({ error: "Generation was cut off (hit token limit). Retry this org." });
    if (message.stop_reason === "refusal") return res.status(502).json({ error: "The model declined this sync." });
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) return res.status(502).json({ error: "The model returned no content." });

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed JSON." });
    }
    return res.status(200).json({
      boardChanges: normalizeBoardChanges(parsed),
      // Real token counts so per-run cost can be measured (logged in boardSyncLog).
      usage: { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null },
    });
  } catch (err) {
    console.error("ai/sync-board failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Board Sync failed" });
  }
}
