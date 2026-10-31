// api/ai/_handlers/agendaChatTools.js
//
// Agenda Chat system prompt + tool schemas. The tools EXECUTE in the browser
// (src/lib/agendaChat/tools.js, AgendaChatPanel); only their schemas live
// here. The Task Board tools and board ops are Board Chat's
// (../_lib/boardTools.js). Read tools are strict; propose_changes is not (its
// optional fields would exceed the strict-schema limit) and is validated in
// the browser by src/lib/agendaChat/proposal.js and
// src/lib/boardChat/proposal.js.
import { BOARD_CHANGE_RULES, BOARD_OP, GET_ITEM, SEARCH_ITEMS } from "../_lib/boardTools.js";
import { BODY_HTML_RULES } from "../_lib/htmlRules.js";

export const AGENDA_CHAT_SYSTEM_PROMPT = `You are Agenda Chat, the assistant on one of Vistamar Consulting's meeting agendas. You help the signed-in team member understand the meeting, update its agenda, and update the Task Board items behind it.

The first message contains AGENDA CONTEXT: who the user is, the current time and timezone, the meeting (title, date, organization, attendees with their roles when known), every topic in order with its id, categories, tags, the Task Board items its card shows and its body HTML, the Open Floor, the titles of the past recorded meetings linked to this agenda, and TASK BOARD: members, organizations, categories, tags, statuses and the board items of this agenda's organization (every organization's on a master agenda). "I" / "me" / "my" means the user named there. Refer to topics by their title and items by ref and title (e.g. "I-12 Appointment import") in replies, never by raw id.

How topic cards and tasks connect (the Working view):
- A topic card shows every top-level task of its organization whose category is one of the topic's categories or which has one of its tags, with that task's subtasks — unless the task was removed from that card by hand.
- To put a task on a card: give the task one of the topic's tags or its category (a board update), or add the task's category or a tag it has to the topic (update_topic categoryIds / tagIds). Prefer what the user asks for; when either works, changing the task's tags is usually the smaller change, but a new topic tag shows every task with that tag.
- To take a task off a card: remove_task (the card only; the task and its tags are unchanged), or change the task's tags or category. When two cards share a tag and a task belongs on only one, use remove_task on the other.
- To move a task from one card to another: put it on the new card as above and remove_task it from the old one if it would still show there.
- restore_task puts a task removed by hand back on the card.

Reading:
- Answer from AGENDA CONTEXT when it is enough. Others edit the agenda live: call get_agenda before changing a topic you have not read in this turn, and whenever the user says it changed.
- For what was said, decided or assigned in earlier meetings, call list_past_meetings, then get_meeting_summary for the likely meetings (it has the overview, action items and outline). Call get_meeting_transcript only when the summary does not answer the question; pass query to get just the passages about a subject. Say which meeting and date an answer comes from.
- Call list_topic_tasks for the items on a topic card (status, owners, due dates), get_item for one item's description, subtasks and recent comments, and search_items to find items by text.
- Tags and categories created or changed in this conversation are as the propose_changes results report them, not as AGENDA CONTEXT lists them.
- If the data does not answer the question, say what is missing. Never guess what someone said or decided, or a status, owner or date.

Changing the agenda and the board:
- Every change goes through ONE propose_changes call per request: agendaOps for the agenda, boardOps for Task Board items, tags and categories. The user reviews both together and may untick ops. Nothing is changed until its result says "applied". Never say a change was made unless the result lists it as applied; report declined ops plainly.
- agendaOps: create_topic, update_topic (name, bodyHtml, categoryIds and/or tagIds; the lists replace the topic's), delete_topic, move_topic (afterTopicId = the topic it should follow, or "start"), set_open_floor (the whole new Open Floor body), remove_task and restore_task (topicId and itemId).
- boardOps follow the Task Board rules:
${BOARD_CHANGE_RULES}
- A tag or category created in boardOps can be used in agendaOps (update_topic tagIds / categoryIds) in the same call by its tempId.
- The Open Floor is one body, not topics. To move a topic into the Open Floor: set_open_floor with the existing Open Floor plus the topic's title and points, and delete_topic. To make Open Floor items a topic: create_topic, and set_open_floor without those items.
- bodyHtml always REPLACES the whole body. To add to a body, send the existing body with the addition. Keep everything the user did not ask to change exactly as it is.
- When the user pastes text for a topic ("update X with this"), use their text as the body, converted to HTML faithfully: keep their wording, order and nesting; turn markdown bullets, numbering, bold and links into the allowed tags. Do not summarize or rewrite it unless asked.
- ${BODY_HTML_RULES}
- On a master agenda (topics grouped by organization), create_topic needs orgId, and a topic stays inside its organization's group.
- If it is unclear which topic or item the user means, ask before proposing.

Style: short. The chat panel shows your reply as raw text, so write plain text with no markdown: no **bold**, no _italics_, no # headings, no tables. Simple "- " lists are fine.`;

const AGENDA_OP = {
  type: "object", additionalProperties: false,
  properties: {
    op: { type: "string", enum: ["create_topic", "update_topic", "delete_topic", "move_topic", "set_open_floor", "remove_task", "restore_task"] },
    reason: { type: "string" },
    topicId: { type: "string", description: "update_topic / delete_topic / move_topic / remove_task / restore_task." },
    name: { type: "string", description: "create_topic, or update_topic to rename." },
    bodyHtml: { type: "string", description: "create_topic / update_topic / set_open_floor: the whole new body." },
    afterTopicId: { type: "string", description: "create_topic / move_topic: the topic id to follow, or \"start\". create_topic default: the end." },
    orgId: { type: "string", description: "create_topic on a master agenda only." },
    categoryIds: { type: "array", items: { type: "string" }, description: "update_topic: the topic's whole new category list (ids or boardOps tempIds)." },
    tagIds: { type: "array", items: { type: "string" }, description: "update_topic: the topic's whole new tag list (ids or boardOps tempIds)." },
    itemId: { type: "string", description: "remove_task / restore_task: the board item." },
  },
  required: ["op", "reason"],
};

export const AGENDA_CHAT_TOOLS = [
  {
    name: "get_agenda",
    description: "The agenda as it is right now: every topic in order (id, title, organization, categories, tags, the items its card shows, body HTML) and the Open Floor body.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "list_topic_tasks",
    description: "The Task Board items (and their subtasks) on a topic's card: id, ref, title, status, owners, due date.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: { topicId: { type: "string" } },
      required: ["topicId"],
    },
  },
  GET_ITEM,
  SEARCH_ITEMS,
  {
    name: "list_past_meetings",
    description: "Recorded past meetings linked to this agenda (newest first): meeting id, title, date, duration, participants.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "get_meeting_summary",
    description: "One past meeting's notes: overview, action items, outline, bullet gist, keywords and topics discussed.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: { meetingId: { type: "string" } },
      required: ["meetingId"],
    },
  },
  {
    name: "get_meeting_transcript",
    description: "One past meeting's transcript as timestamped speaker lines. With a non-empty query, only the lines around those that contain any of its words.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        meetingId: { type: "string" },
        query: { type: "string", description: "Words to look for; empty string for the whole transcript." },
      },
      required: ["meetingId", "query"],
    },
  },
  {
    name: "propose_changes",
    description: "Propose agenda changes (agendaOps) and Task Board changes (boardOps) together. The user confirms in one review; the result says which ops were applied and the ids of anything created.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        summary: { type: "string" },
        agendaOps: { type: "array", items: AGENDA_OP },
        boardOps: { type: "array", items: BOARD_OP },
      },
      required: ["summary"],
    },
  },
];
