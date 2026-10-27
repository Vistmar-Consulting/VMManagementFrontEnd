// api/ai/_handlers/chatTools.js
//
// Board Chat system prompt + tool schemas. The tools EXECUTE in the browser
// (src/lib/boardChat/tools.js, BoardChatPanel); only their schemas live here.
// Every schema is closed, optional fields omitted when unused. The read tools
// are strict; set_board_filter and propose_changes are not, because together
// their optional fields exceed the API's strict-schema limit ("Schema is too
// complex", 2026-10-27). Their inputs are validated in the browser by
// applyBoardFilter and boardChat/proposal.js.

export const SYSTEM_PROMPT = `You are Board Chat, the assistant on Vistamar Consulting's internal Task Board. You help the signed-in team member understand and update the board.

The first message contains BOARD CONTEXT: who the user is, the current time and timezone, members, organizations, categories, tags, statuses, and every non-archived task and subtask. "I" / "me" / "my" means the user named there. Item ids are in the first column; refer to items in replies by ref and title (e.g. "I-12 Appointment import", or "I-12/SI-3 Import script" for a subtask), never by raw id.

Reading:
- Answer from BOARD CONTEXT when it is enough. Call get_item for an item's description, subtasks or recent comments. Call search_items to find archived items or match description text.
- Call list_meetings for questions about meetings. Dates are YYYY-MM-DD in the user's timezone.
- If the data does not answer the question, say what is missing. Never guess a status, owner or date.

Filtering:
- When the user asks to see, show, list or filter items on the board, call set_board_filter. Use columnFilters when a column filter expresses the request exactly. Otherwise pass aiFilter with the exact ids of the tasks and subtasks in question. Always pass a 2-4 word label. Each call is saved as a view chip the user can switch back to; earlier views stay. Use clear: true alone to reset.

Changing the board:
- Every create, update or delete goes through ONE propose_changes call per request, listing every op. The user reviews it in a modal and may untick ops. Nothing is changed until its result says "applied".
- Never say a change was made unless the propose_changes result lists it as applied. Report declined or unticked ops plainly.
- Use only existing members, organizations, categories and tags (by id). Allowed statusId values: 1 Assigned, 2 In Progress, 9 Blocked, 4 Review, 5 Done, 7 Archive.
- A subtask's parent is a top-level item (parentRef = its id, or the tempId of a create earlier in the same call). Subtasks cannot have subtasks.
- If it is unclear which items the user means, ask before proposing.

Style: plain text, short. Simple "- " lists are fine; no tables, no headings.`;

const FIELDS = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    statusId: { type: "integer", enum: [1, 2, 9, 4, 5, 7] },
    assigneeIds: { type: "array", items: { type: "string" } },
    dueDate: { type: "string", description: "YYYY-MM-DD" },
    priorityId: { type: "integer", enum: [1, 2, 3, 4] },
    categoryId: { type: "string" },
    tagIds: { type: "array", items: { type: "string" } },
  },
};

export const TOOLS = [
  {
    name: "get_item",
    description: "Full detail for one item: description, subtasks, and its 5 most recent comments.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "search_items",
    description: "Keyword search over item titles and descriptions. Every word must match. Returns up to 50 items and the total match count.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        query: { type: "string" },
        includeArchived: { type: "boolean" },
      },
      required: ["query", "includeArchived"],
    },
  },
  {
    name: "list_meetings",
    description: "Team meetings between two dates (inclusive), with start/end times and attendee emails.",
    strict: true,
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "set_board_filter",
    description: "Change what the Task Board shows and save it as a view chip. Fields you omit keep their current value. clear: true first resets every filter; clear alone turns views off.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        clear: { type: "boolean" },
        label: { type: "string", description: "2-4 words naming this view's chip." },
        orgId: { type: "string", description: "An organization id, or \"all\"." },
        titleSearch: { type: "string" },
        columnFilters: {
          type: "object", additionalProperties: false,
          properties: {
            statusId: { type: "array", items: { type: "integer" } },
            assigneeIds: { type: "array", items: { type: "string" } },
            priorityId: { type: "array", items: { type: "integer" } },
            categoryId: { type: "array", items: { type: "string" } },
            tagIds: { type: "array", items: { type: "string" } },
          },
        },
        aiFilter: {
          type: "object", additionalProperties: false,
          properties: {
            itemIds: { type: "array", items: { type: "string" } },
          },
          required: ["itemIds"],
        },
      },
      required: ["clear"],
    },
  },
  {
    name: "propose_changes",
    description: "Propose creates, updates and deletes. The user confirms in a modal; the result says which ops were applied.",
    input_schema: {
      type: "object", additionalProperties: false,
      properties: {
        summary: { type: "string" },
        ops: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              op: { type: "string", enum: ["create", "update", "delete"] },
              reason: { type: "string" },
              tempId: { type: "string", description: "create only: a short id other ops can use as parentRef." },
              itemId: { type: "string", description: "update/delete only." },
              orgId: { type: "string", description: "create of a top-level item only." },
              parentRef: { type: "string", description: "create of a subtask only: parent item id or an earlier create's tempId." },
              fields: FIELDS,
              clear: { type: "array", items: { type: "string", enum: ["dueDate", "priorityId", "categoryId"] } },
            },
            required: ["op", "reason"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
];
