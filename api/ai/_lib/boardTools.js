// api/ai/_lib/boardTools.js
//
// The Task Board toolset Board Chat and Agenda Chat share: reading items and
// the ops of a board proposal (tasks, subtasks, tags, categories), plus the
// prompt rules for them. The tools EXECUTE in the browser
// (src/lib/boardChat/tools.js, src/lib/boardChat/proposal.js); only their
// schemas live here.
//
// Read tools are strict. The proposal schema is not: with every optional
// field it would pass the API's strict-schema limit of 24 optional
// parameters across strict tools ("Schema is too complex", 2026-10-27), so
// the browser validates it instead.

export const GET_ITEM = {
  name: "get_item",
  description: "Full detail for one item: description, subtasks, and its 5 most recent comments.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    properties: { itemId: { type: "string" } },
    required: ["itemId"],
  },
};

export const SEARCH_ITEMS = {
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
};

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
    categoryId: { type: "string", description: "A category id, or the tempId of a create_category in the same call." },
    tagIds: { type: "array", items: { type: "string" }, description: "Tag ids, or tempIds of create_tag ops in the same call. Replaces the item's tags." },
  },
};

export const BOARD_OP_NAMES = ["create", "update", "delete", "create_tag", "update_tag", "delete_tag", "create_category", "update_category", "delete_category"];

// One op of a board proposal.
export const BOARD_OP = {
  type: "object", additionalProperties: false,
  properties: {
    op: { type: "string", enum: BOARD_OP_NAMES },
    reason: { type: "string" },
    tempId: { type: "string", description: "create / create_tag / create_category: a short id other ops in this call can use (parentRef, tagIds, categoryId)." },
    itemId: { type: "string", description: "update / delete of an item." },
    orgId: { type: "string", description: "create of a top-level item only." },
    parentRef: { type: "string", description: "create of a subtask only: parent item id or an earlier create's tempId." },
    fields: FIELDS,
    clear: { type: "array", items: { type: "string", enum: ["dueDate", "priorityId", "categoryId"] } },
    tagId: { type: "string", description: "update_tag / delete_tag." },
    categoryId: { type: "string", description: "update_category / delete_category." },
    name: { type: "string", description: "create_tag / create_category, or a rename." },
    color: { type: "string", description: "Tag / category color as #rrggbb (optional)." },
    tagScope: { type: "string", description: "create_tag / update_tag: \"shared\" (every client) or one organization id (that client's own tag)." },
  },
  required: ["op", "reason"],
};

export const BOARD_CHANGE_RULES = `- Use only existing members, organizations, categories and tags (by id), or ones created in the same call. Assign "Vistamar team" members to any task, a "client contact" only to tasks of that client's organization, and never a member marked "not assignable". Tag a task only with "shared" tags or its own organization's tags. Allowed statusId values: 1 Assigned, 2 In Progress, 9 Blocked, 4 Review, 5 Done, 7 Archive.
- A subtask's parent is a top-level item (parentRef = its id, or the tempId of a create earlier in the same call). Subtasks cannot have subtasks.
- Tags and categories: create_tag (name, tagScope, optional color), update_tag (tagId; name, color and/or tagScope), delete_tag (tagId); create_category (name, optional color), update_category (categoryId; name and/or color), delete_category (categoryId). Tag names are lowercase-hyphenated like the existing ones. A tag for one client's own work gets tagScope = that organization's id; one every client can use gets "shared". Deleting a tag or category also removes it from every task and agenda topic card that uses it.
- To use a new tag or category right away, give its create a tempId and put that tempId in tagIds / categoryId of other ops in the same call. Once applied, the result gives its real id: use that id from then on, in this and later requests. Never coin urgency or blocked tags; those are priority and status.
- fields.tagIds replaces an item's whole tag list: send its current tags plus the new one to add a tag.`;
