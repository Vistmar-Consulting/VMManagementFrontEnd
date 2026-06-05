// api/ai/prepare.js
//
// Sync Meeting — ONE AI operation that generates a meeting agenda AND project-
// board changes in a single model pass. The model emits an integer `topicIndex`
// on each board-create, and this endpoint converts it to a stable `topicId`
// (and, for master, stamps the topic's organizationId) afterward.
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

// Sonnet 4.6 — same model as generate.js (fast + cheap, strong quality;
// admin-triggered low volume). Bump to Opus per-org later if needed.
const MODEL = "claude-sonnet-4-6";

// Sync Meeting reconciles a lot of input (transcripts + project board + other
// agendas + categorization) and does MORE than either source (agenda + board
// changes in one pass). Give the function generous headroom so a long run
// isn't killed by the platform default. (Vercel reads per-function config.)
export const config = { maxDuration: 300 };

// Combined structured-output schema: the agenda (topics[],
// openFloorHtml) PLUS boardChanges (creates / moves / notes). Strings + flat
// arrays; no recursion / numeric constraints (structured-outputs limitations).
// MASTER (Touch Base) adds a required per-topic `organizationId` so the
// cross-org agenda can be grouped + colored by org.
//
// NOTE: creates carry an integer `topicIndex` (0-based index into topics) — the
// model does NOT mint ids. The handler converts topicIndex → topicId afterward
// and the new task INHERITS its topic's category + tags.
function buildSchema(master) {
  const topicProps = {
    ref: { type: "string" },
    name: { type: "string" },
    bodyHtml: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  };
  const topicRequired = ["ref", "name", "bodyHtml", "categories", "tags"];
  if (master) {
    topicProps.organizationId = { type: "string" };
    topicRequired.push("organizationId");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      topics: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: topicProps, required: topicRequired },
      },
      openFloorHtml: { type: "string" },
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
                title:      { type: "string" },
                topicIndex: { type: "integer" },
                note:       { type: "string" },
                parentRef:  { type: "string" },   // optional — "" or omitted = top-level
              },
              required: ["title", "topicIndex", "note"],
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
    required: ["topics", "openFloorHtml", "boardChanges"],
  };
}

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

function orgListBlock(orgMeta) {
  const list = (Array.isArray(orgMeta) ? orgMeta : [])
    .map((o) => `- ${o.slug} — ${o.name}${o.type === "internal" ? " (Vistamar, internal)" : " (client)"}`)
    .join("\n");
  return list || "(no organizations provided)";
}

function buildSystem(prompt, style, categories, tagVocab, internal = false, master = false, orgMeta = []) {
  const filled = String(prompt || "").replaceAll("{{meetingStyle}}", style);
  const howToUse = master
    ? `## How to use the inputs — MASTER weekly agenda (the Monday Touch Base)
- This is Vistamar's MASTER cross-client weekly agenda: the internal team's single working view of everything to get done THIS WEEK, organized by organization. It spans EVERY active client PLUS Vistamar's own internal work, reconciling everything since the last Touch Base.
- Build it ORG BY ORG, in the order listed below. For EACH client, produce one or more topics covering their immediate this-week deliverables and what surfaced since the last Touch Base — drawn from that client's transcripts, board activity, and current agendas. Then a Vistamar section: platform development (always), and business development only if something surfaced.
- EVERY topic MUST set organizationId to the slug of the org it belongs to (from the list below). Keep each org's topics together and follow the given org order (clients first, Vistamar last).
- Focus on IMMEDIATE / this-week deliverables, decisions, and blockers — NOT the full backlog. Fold board state (in progress / awaiting sign-off / newly raised) into the relevant topics rather than listing tasks verbatim.
- Vistamar's section is ONLY Vistamar's own work — platform/product development + business development (promoting Vistamar + prospective-client outreach). Work delivering services to an existing client belongs under THAT client's section, never Vistamar's.

## Organizations (use these exact slugs for organizationId; keep this order)
${orgListBlock(orgMeta)}`
    : internal
    ? `## How to use the inputs
- This is a VISTAMAR INTERNAL meeting agenda — NOT client-facing. Reconcile the current agenda with everything that happened since this meeting last occurred: Vistamar internal meetings, recent Vistamar Project Board activity, Vistamar's OTHER internal agendas, and any additional context the user provided.
- SCOPE — Vistamar internal work is ONLY: (1) platform/product development of Vistamar's own apps and internal tooling, and (2) business development — promoting Vistamar's company & services AND outreach to PROSPECTIVE clients for new-business acquisition. Keep this agenda to that scope.
- Work that delivers services to an EXISTING client org (Unio, Bryn Mawr, Golden Vision, ID Care) does NOT belong on this internal agenda — it lives on that client's agenda/board. Outreach to a PROSPECTIVE (not-yet) client IS Vistamar business development and DOES belong here.
- Use Vistamar's other internal agendas for coherence: don't duplicate or contradict what's already planned elsewhere; surface cross-meeting dependencies.
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.`
    : `## How to use the inputs
- Reconcile the current agenda with everything that happened since this meeting last occurred: this client's meetings, internal Vistamar meetings, recent Project Board activity, this client's OTHER meeting agendas, and any additional context the user provided.
- The org operates holistically — be aware of everything happening across this client. Use the client's other agendas so this agenda stays coherent with them: don't duplicate or contradict what's already on another meeting's agenda, surface cross-meeting dependencies, and keep one consistent picture of the client's work.
- Internal Vistamar meetings (tagged [Vistamar internal]) are for YOUR situational awareness — never surface internal-only mechanics, staffing, or candor into a client-facing agenda, especially an executive one. Keep Vistamar looking strong and prepared to the client.
- Use Project Board activity to reflect what is done, in progress, or newly raised — fold it into the relevant topics rather than listing tasks verbatim.`;

  const boardScope = internal || master
    ? `## SCOPE — what belongs on the Vistamar board
Vistamar's board covers ONLY Vistamar's own work: (1) platform/product development of Vistamar's own apps and internal tooling, and (2) business development — promoting Vistamar's company & services AND outreach to PROSPECTIVE clients for new-business acquisition. Work that delivers services to an EXISTING client org (Unio, Bryn Mawr, Golden Vision, ID Care) does NOT belong here — it lives on that client's board, so do NOT propose it as a Vistamar create. Outreach to a PROSPECTIVE (not-yet) client IS Vistamar business development → include it.

`
    : "";

  return `${filled}

${howToUse}

## Your job — produce BOTH the next agenda AND the board changes it implies, in ONE pass
You generate the next meeting agenda AND the Project Board updates that follow from it, together, so every new task lands under the agenda topic it belongs to.

## Agenda output
- topics: an array of ${master ? "{ ref, name, bodyHtml, categories, tags, organizationId }" : "{ ref, name, bodyHtml, categories, tags }"} — each a topic title plus a few tight HTML bullets of what is on the table now. Keep the count and length small.${master ? " Set organizationId on EVERY topic; group topics by org in the listed order." : ""}
- openFloorHtml: HTML for any open-floor items, or "".

HTML rules: use ONLY these tags — <p>, <br>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href>. No headings, no inline styles, no other tags. Be concise — never a long document.

PRESERVE HYPERLINKS: the current agenda and the inputs may contain <a href="…"> links (docs, sheets, dashboards, GBP listings, etc.). Carry every existing link forward into the new agenda VERBATIM — keep the exact href and link text on the topic it belongs to. Never strip a link or turn it into plain text. If a transcript or note surfaces a relevant URL, include it as a link too.

TOPIC IDENTITY — DO NOT RENAME EXISTING TOPICS: the current agenda's topics are listed below, each tagged [ref: <id>]. For every topic you carry forward from the current agenda, set its "ref" to that exact id and keep its title unchanged — the title is fixed by the system and you may not reword it. Only a genuinely NEW topic may have a new title; set its "ref" to an empty string "". You may reorder topics and you may omit a topic whose work is fully complete.

## Board changes output (boardChanges)
Propose three kinds of Project Board updates a human will review, derived from the SAME record. You are given the existing board tasks each with an itemId.

${boardScope}### boardChanges.creates — NEW tasks
- Propose ONLY work that genuinely surfaced in the record and is NOT already on the board (don't duplicate existing tasks).
- Each create: a concrete action-oriented title; a one-line note citing the source (meeting/date) + naming the owner/contact (use the SOPs — e.g. Bill = website, Cedric = technical).
- CRITICAL: For each new task in boardChanges.creates, set \`topicIndex\` to the 0-based index (in the \`topics\` array) of the topic it belongs under. The task will INHERIT that topic's category and tags — do NOT assign categories/tags to tasks yourself. Every create must reference a real topic index.
- OPTIONAL: set \`parentRef\` when this task is a subitem.
  - Nest under an **existing** board item: set \`parentRef\` to that item's \`itemId\` (from the task list below).
  - Nest under a **newly proposed** task in this run: set \`parentRef\` to \`"new:N"\` where N is the 0-based index of the parent create in this \`creates\` array (e.g. \`"new:0"\` nests under the first proposed task).
  - One level deep only — never set \`parentRef\` on a task whose intended parent itself has a \`parentRef\`.
  - Leave \`parentRef\` empty or omit for top-level tasks.

### boardChanges.moves — STATUS MOVES on EXISTING tasks
- When the record clearly indicates an existing task progressed, propose a move. Set itemId (exact, from the existing list), title (copy the existing title), toStatus (one of: Assigned, In Progress, Review, Done, Pending), and a one-line reason citing the source.
- Examples: transcript says something shipped/aired/published → toStatus "Done"; work actively underway → "In Progress"; awaiting sign-off → "Review"; blocked/waiting → "Pending". Only move when the record is clear — when unsure, omit.

### boardChanges.notes — context on EXISTING tasks
- When the record adds useful context to an existing task without changing its status, propose a note: itemId, title (copy existing), and the note text (cite the source).

Be precise, not exhaustive. Return empty arrays for any boardChanges kind with nothing to propose.${buildCategorization(categories, tagVocab)}`;
}

const SCOPE_TAG = {
  "this-org": "Client",
  "vistamar-internal": "Vistamar internal",
};

function existingTasksBlock(lines, existingTasks) {
  lines.push("## Existing board tasks (don't duplicate for new creates; reference itemId for moves/notes)");
  (existingTasks || []).forEach((t) => lines.push(`- [itemId:${t.id}] ${t.title}${t.status ? ` [${t.status}]` : ""}${t.category ? ` (${t.category})` : ""}`));
  if (!existingTasks || existingTasks.length === 0) lines.push("(none)");
  lines.push("");
}

function buildMasterUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, existingTasks, extraContext, orgMeta) {
  const a = agenda || {};
  const lines = [];
  lines.push(`Generate this week's MASTER Touch Base agenda (${style}) AND the Project Board changes it implies. Organize the agenda ORG BY ORG in the order below (clients first, Vistamar last); set organizationId on every topic.`);
  lines.push("");
  lines.push("## Current Touch Base agenda (move it forward from here)");
  (a.topics || []).forEach((t, i) => {
    const refPart = t.id ? ` [ref: ${t.id}]` : "";
    lines.push(`Topic ${i + 1}: ${t.name || ""}${refPart}${t.organizationId ? ` [org: ${t.organizationId}]` : ""}`);
    if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
  });
  if (a.openFloorHtml) lines.push(`Open Floor (HTML): ${a.openFloorHtml}`);
  lines.push("");

  existingTasksBlock(lines, existingTasks);

  const order = (Array.isArray(orgMeta) ? orgMeta : []).map((o) => o.slug);
  const present = [...new Set([
    ...(transcripts || []).map((t) => t.org),
    ...(projectBoard || []).map((b) => b.org),
    ...(orgAgendas || []).map((g) => g.org),
  ].filter(Boolean))];
  const ordered = [...order.filter((s) => present.includes(s)), ...present.filter((s) => !order.includes(s))];

  lines.push("## This week, by organization (since the last Touch Base)");
  for (const slug of ordered) {
    const name = (orgMeta.find((o) => o.slug === slug)?.name) || slug;
    lines.push(`### ${name}  [organizationId: ${slug}]`);
    const trs = (transcripts || []).filter((t) => t.org === slug);
    if (trs.length) {
      lines.push("Meeting transcripts:");
      trs.forEach((tr) => {
        lines.push(`- ${tr.title || "Meeting"}${tr.date ? ` (${tr.date})` : ""}`);
        if (tr.overview) lines.push(`  Overview: ${tr.overview}`);
        if (tr.actionItems) lines.push(`  Action items: ${tr.actionItems}`);
      });
    }
    const bd = (projectBoard || []).filter((b) => b.org === slug);
    if (bd.length) {
      lines.push("Project Board activity:");
      bd.forEach((it) => {
        const flag = it.isNew ? "NEW" : "updated";
        const proj = it.project ? ` — ${it.project}` : "";
        lines.push(`- [${flag}] ${it.name || "(untitled)"} (status: ${it.status || "?"})${proj}`);
      });
    }
    const ags = (orgAgendas || []).filter((g) => g.org === slug);
    if (ags.length) {
      lines.push("Current agendas (planning context, don't copy):");
      ags.forEach((oa) => {
        lines.push(`  ${oa.title || "Meeting"}:`);
        (oa.topics || []).forEach((t) => lines.push(`   - ${t.name || ""}${t.bodyHtml ? `: ${t.bodyHtml}` : ""}`));
      });
    }
    if (!trs.length && !bd.length && !ags.length) lines.push("(nothing surfaced this week)");
    lines.push("");
  }
  if (extraContext && String(extraContext).trim()) {
    lines.push("## Additional context the user provided for this generation");
    lines.push(String(extraContext).trim());
  }
  return lines.join("\n");
}

function buildUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, existingTasks, extraContext, master = false, orgMeta = []) {
  if (master) return buildMasterUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, existingTasks, extraContext, orgMeta);
  const a = agenda || {};
  const lines = [];
  lines.push(`Generate the next ${style} meeting agenda for: ${a.title || "(untitled meeting)"}, AND the Project Board changes it implies.`);
  lines.push("");
  lines.push("## Current agenda (move it forward from here)");
  lines.push(`Title: ${a.title || ""}`);
  (a.topics || []).forEach((t, i) => {
    const refPart = t.id ? ` [ref: ${t.id}]` : "";
    lines.push(`Topic ${i + 1}: ${t.name || ""}${refPart}`);
    if (t.bodyHtml) lines.push(`  Body (HTML): ${t.bodyHtml}`);
  });
  if (a.openFloorHtml) lines.push(`Open Floor (HTML): ${a.openFloorHtml}`);
  lines.push("");

  existingTasksBlock(lines, existingTasks);

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

  const { prompt, meetingStyle, agenda, transcripts, projectBoard, existingTasks, orgAgendas, extraContext, categories, tagVocab, internal, master, orgMeta } = req.body || {};
  if (!prompt || !agenda) {
    return res.status(400).json({ error: "Missing required field: prompt and agenda" });
  }
  const style = meetingStyle === "executive" ? "executive" : "working";

  try {
    const client = new Anthropic({ apiKey });
    // Stream + finalMessage(): the unified Sync Meeting call uses a high
    // max_tokens that crosses the SDK's non-streaming 10-minute guard, which
    // throws on messages.create(). Streaming lifts that guard; the call still
    // completes well under the function's maxDuration (300s). Same params,
    // same structured output.
    const message = await client.messages.stream({
      model: MODEL,
      // PROPOSED higher ceiling — unified does more (agenda + board changes)
      // than either source; controller will latency-test these values.
      max_tokens: master ? 32000 : 24000,
      thinking: { type: "adaptive" },
      // medium effort — reconciliation + formatting, not hard reasoning;
      // medium roughly halves thinking time vs the default high, keeping the
      // call well under timeout without a quality hit.
      output_config: { effort: "medium", format: { type: "json_schema", schema: buildSchema(!!master) } },
      messages: [{ role: "user", content: buildUserMessage(agenda, transcripts, style, projectBoard, orgAgendas, existingTasks, extraContext, !!master, orgMeta || []) }],
      system: buildSystem(prompt, style, categories, tagVocab, !!internal, !!master, orgMeta || []),
    }).finalMessage();

    if (message.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "Generation was cut off (hit token limit). Try again." });
    }
    if (message.stop_reason === "refusal") {
      return res.status(502).json({ error: "The model declined to prepare this meeting." });
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock?.text) {
      return res.status(502).json({ error: "The model returned no content." });
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "The model returned malformed JSON." });
    }

    // Topics: mint a stable topicId per topic (t0, t1, …) so creates can
    // reference them by id after we drop the raw integer topicIndex.
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.map((t, i) => ({
          topicId: `t${i}`,
          ref: t?.ref ? String(t.ref) : "",
          name: String(t?.name || ""),
          bodyHtml: String(t?.bodyHtml || ""),
          categories: Array.isArray(t?.categories) ? t.categories.map((c) => String(c)) : [],
          tags: Array.isArray(t?.tags) ? t.tags.map((x) => String(x)) : [],
          organizationId: t?.organizationId ? String(t.organizationId) : null,
        }))
      : [];

    const bc = parsed.boardChanges || {};

    // creates: map integer topicIndex → topicId; DROP any create whose index
    // is out of range. Return topicId only (raw topicIndex is removed). For
    // master, stamp the referenced topic's organizationId onto the create.
    const creates = Array.isArray(bc.creates)
      ? bc.creates
          .map((c) => {
            const idx = Number.isInteger(c?.topicIndex) ? c.topicIndex : -1;
            if (idx < 0 || idx >= topics.length) return null;
            const create = {
              title: String(c?.title || ""),
              topicId: `t${idx}`,
              note: String(c?.note || ""),
              parentRef: typeof c?.parentRef === "string" ? c.parentRef : "",
            };
            if (master) create.organizationId = topics[idx].organizationId;
            return create;
          })
          .filter((c) => c && c.title)
      : [];

    const moves = Array.isArray(bc.moves)
      ? bc.moves
          .map((m) => ({
            itemId: String(m?.itemId || ""),
            title: String(m?.title || ""),
            toStatus: String(m?.toStatus || ""),
            reason: String(m?.reason || ""),
          }))
          .filter((m) => m.itemId && m.toStatus)
      : [];

    const notes = Array.isArray(bc.notes)
      ? bc.notes
          .map((n) => ({
            itemId: String(n?.itemId || ""),
            title: String(n?.title || ""),
            note: String(n?.note || ""),
          }))
          .filter((n) => n.itemId && n.note)
      : [];

    return res.status(200).json({
      topics,
      openFloorHtml: String(parsed.openFloorHtml || ""),
      boardChanges: { creates, moves, notes },
    });
  } catch (err) {
    console.error("ai/prepare failed", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Meeting preparation failed" });
  }
}
