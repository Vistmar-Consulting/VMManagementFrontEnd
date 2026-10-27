# Board Chat — Design

**Date:** 2026-10-21
**Status:** Approved 2026-10-21
**Branch:** `worktree-task-board-ai-chat`

## 1. What it is

A chat panel on the Task Board where a signed-in user talks to Claude about the board. Claude can:

- **Answer questions** about tasks, subtasks, assignees and meetings. Examples: "What do I need to get done today, and which meetings do I need them done before?" and "Has Andy finished getting the appointments data into the db?"
- **Filter the board**, both through the existing column filters and through an **AI filter** that narrows the table to exactly the tasks and subtasks Claude picked. Example: "Show me everyone's tasks related to appointment data."
- **Change the board** (create, update, move, delete tasks and subtasks). Every write goes to a **change modal** first. Nothing is written until the user clicks Apply.

A running **cost tracker** shows what each reply cost and the conversation total.

Feature name: **Board Chat**.

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Write confirmation | Modal pops up listing every proposed change; Apply / Cancel. Per-change checkboxes (default on) so one wrong pick can be unticked instead of re-asked. |
| Model | Latest Sonnet, resolved at runtime from the Models API (newest `claude-sonnet-*` by `created_at`). No hard-coded version. |
| Where tools run | In the browser, through the Firebase Web SDK as the signed-in user. Security rules apply unchanged; no admin SDK, no service account. |
| Where the model runs | Server: new `chat` route on the existing `api/ai/dispatch.js`. Holds `ANTHROPIC_API_KEY`. Vercel function count stays at 11. |
| Conversation persistence | In-memory only (React state). Survives panel close; cleared by "New chat" or page reload. |
| Cost display | Per-reply cost in the reply's bottom corner; conversation total in the panel header. |
| Sync Task Board (Fireflies → board) | **Deferred** to its own session. The write layer here (§6) is built so it can reuse it. |

## 3. Architecture

```
Browser (TaskBoard)                         Vercel  /api/ai/chat
──────────────────                          ─────────────────────
BoardChatPanel
  ├─ builds board snapshot ─┐
  ├─ messages[] (append-only)┼──POST──────▶ chat.js
  │                          │               ├─ requireAuth (Firebase ID token)
  │                          │               ├─ resolveLatestSonnet() (memoized)
  │                          │               ├─ messages.create(tools, system, msgs)
  │  ◀──── content + usage + model + cost ───┤  one model call per request
  ├─ stop_reason == tool_use?
  │    read tool   → run locally → tool_result → POST again
  │    filter tool → set board filter state  → tool_result → POST again
  │    propose_changes → open ChangesModal
  │         Apply  → itemWrites transaction → tool_result "applied …"
  │         Cancel → tool_result "user declined"            → POST again
  └─ end_turn → render reply + cost
```

The server is **stateless and runs one model call per request**. The browser owns the tool loop. This is the same split Sync Meeting uses: the browser gathers the data and applies the changes, and the server only reasons.

**Loop guardrail:** at most 10 model calls per user message. If it hits the cap, the turn stops with a visible "stopped after 10 steps" notice. It does not fail silently.

## 4. Server — `api/ai/_handlers/chat.js`

- Registered in `ROUTES` in `api/ai/dispatch.js`. URL `/api/ai/chat`. No `vercel.json` change: the existing `/api/ai/:action` rewrite covers it.
- `applyCors` + `requireAuth`, same as the sibling handlers.
- **Model resolution** (`api/ai/_handlers/chatModels.js`): `client.models.list()`, keep ids starting with `claude-sonnet-`, pick the newest `created_at`. Memoized per warm instance for 1 hour. If the list call fails, return a 502 with the reason. There is no fallback to a hard-coded id.
- **Request:** `{ messages }`. The browser puts the context (board snapshot, the current user, the current time and timezone) as the first text block of the conversation's first user message. The server forwards `messages` unchanged.
- **Call:** adaptive thinking (model default), `output_config.effort: "medium"`, `tool_choice: auto`, `strict: true` on every tool, automatic prompt caching (top-level `cache_control`), `max_tokens` 16000.
- **No refusal fallback in V1.** The installed `@anthropic-ai/sdk` 0.100.1 has no `fallbacks` support (checked 2026-10-21). Adding it means upgrading the SDK, which `prepare.js` also depends on and which another session is changing. A refusal is shown to the user as an error.
- **Response:** `{ content, stopReason, model, usage, costUsd }`. The browser appends `content` exactly as returned, thinking blocks included. History is append-only, which is required for preserved thinking on current models.
- **Cost** (`api/ai/_handlers/chatPricing.js`): price table keyed by model id (input, output, cache write, cache read per MTok). `costUsd` is computed from `usage`. If the resolved model isn't in the table, `costUsd` is `null` and the UI shows **"unpriced"**. It never guesses. A new Sonnet therefore shows "unpriced" until someone adds its row.
- **Errors:** typed SDK errors are mapped to status codes (429 → 429 with retry hint, 400 → 400 with the API message verbatim, every other API or connection error → 502 with the message). `refusal` → 502 with `stop_details.category`.

### Known risk — auto-upgrading model

A new Sonnet can change API behavior. Sonnet 5.5, for example, 400s on `thinking: disabled` and on forced `tool_choice`. The request avoids every setting that has broken on a Sonnet so far. If a future model rejects the request anyway, the chat shows the API error verbatim and stops. There is no silent fallback to an older model.

### Known risk — strict schema size (unverified)

Across the strict tools there are about 23 optional parameters. The plan review recalled a limit on optional parameters in strict schemas (around 24). This could not be confirmed in the docs on 2026-10-21. The first real call (plan Task 11) tests it. If the API returns a 400 about schema complexity, the panel shows it verbatim. The fix is to drop `strict` from `set_board_filter` and `propose_changes`. Their inputs are already fully validated by `applyBoardFilter` and `boardChat/proposal.js`. The outcome is recorded in the session `context.md`.

## 5. Tools

The schemas live on the server, in `chat.js`. Execution happens in the browser, in `src/lib/boardChat/tools.js`.

**Board snapshot** (in context, not a tool): every non-archived item as one compact row: `id, ref (I-N / SI-N), title, org, parentId, status, assignees (names), priority, category, tags, dueDate, updatedAt`. Descriptions are left out to keep it small, and `get_item` fetches them. Members, orgs, categories, tags and statuses are listed once. With ~85–500 items the snapshot is roughly 5–25K tokens, cached after the first call.

| Tool | Kind | Does |
|---|---|---|
| `get_item` | read | Full item, including description, subitems and the 5 latest comments. |
| `search_items` | read | Keyword search over title + description, including archived items. Used when the snapshot isn't enough. |
| `list_meetings` | read | `meetingsApi.listMeetings({ start, end })`, trimmed to title, start, end and attendee emails. Org is left out because the list API's `org_id` is a legacy Console id, and attendee domains identify the client. |
| `set_board_filter` | view | Sets any of: `orgFilter`, `columnFilters`, `titleSearch`, and **`aiFilter: { label, itemIds[] }`**. `clear: true` resets all of them plus the scorecard filter (Claude does not set scorecards). |
| `propose_changes` | write | `{ summary, ops[] }`. Opens the change modal. Returns what was applied or declined. |

**`propose_changes` ops:**
- `create` — `{ tempId, orgId, parentRef?, title, description?, statusId?, assigneeIds?, dueDate?, priorityId?, categoryId?, tagIds? }`. `parentRef` is an existing item id or another op's `tempId`, which lets Claude create a project with subtasks in one proposal.
- `update` — `{ itemId, fields, clear? }`. `fields` is an explicit, strict object, and any field can be omitted: `title, description, statusId, assigneeIds, dueDate, priorityId, categoryId, tagIds`. `clear` lists fields to null out (`dueDate`, `priorityId`, `categoryId`). Creates use the same `fields` object. That covers status moves, reassignment, renames, due dates, priority, category and tags. Moving an item to another project or org (`parentId` / `organizationId`) is **not** supported in V1. Moving to Done sets `completedAt`; moving out of Done clears it, the same as Sync Meeting. That rule lives in the **Board Chat proposal layer** (`boardChat/proposal.js`), which adds `completedAt` to the patch. The shared writer does not, so the board's manual status changes keep their current behavior.
- `delete` — `{ itemId }`. Cascades to subitems, the same as the board's delete. The cascade set comes from the live client item list (`useItems`) and is fixed when the modal opens. The modal shows the cascade count.

Allowed statuses: Assigned, In Progress, Blocked, Review, Done, Archive. Claude never sets AI Gen (8). Categories and tags must be existing ones. Board Chat does not create new categories or tags.

## 6. Writes — `src/lib/itemWrites.js` (new, shared)

The board's create, subitem, update and delete logic currently lives inline in `TaskBoard.jsx` (`handleAddItem`, `handleAddSubitem`, `handleUpdate`, `handleConfirmDelete`). It moves into `itemWrites.js` and the board calls it. That way the board, Board Chat and the later Sync Task Board all share one writer: same counters (`nextItemNumber`, `nextSubitemNumber`), same `hasChildren`, same cascade.

`applyChangeSet(ops, uid)` runs **one Firestore transaction** for the accepted ops. All reads happen first: org docs and parent docs for counters, plus every target item. The writes follow. Either everything commits or nothing does.

**Staleness check:** the panel tracks, per item, **the `updatedAt` the model last saw**. It is set from the snapshot, refreshed by every `get_item` / `search_items` result, and refreshed again by applied changes. When the modal opens, each op is checked against the live board. A missing target, or a live `updatedAt` newer than the last one the model saw, is flagged in the modal and unticked, and the user can re-tick it after seeing the current value. Changes the user applied earlier in the same chat are therefore not flagged as stale. The `propose_changes` tool_result reports each applied op with the item's new values and refs (including new I-N / SI-N), plus the ops that were declined or unticked.

**Scope of the shared writer:** `TaskBoard.jsx` moves onto `itemWrites.js`. `MiniProjectBoard.jsx` also creates items, but it stays as-is in this session.

**Audit:** creates carry `createdVia: "board-chat"`. Updates and deletes are not tagged, because there's no per-field history on items today. See open question 2.

## 7. UI

- **Toggle button** in the Task Board header opens a right-side drawer, `BoardChatPanel.jsx`. The board stays usable beside it.
- **Panel:** header with the running total (e.g. "$0.0412") and a "New chat" button; message list; input (Enter sends, Shift+Enter adds a newline). Each assistant reply shows its own cost in the bottom-right corner, summed across every model call that reply took. Tool activity shows as small inline lines such as "Searched tasks · Read I-42 · Filtered board (14)".
- **AI filter chip** sits in the board's filter row: "AI: Appointment data (14) ×". It ANDs with the existing filters, through `buildItemMatcher`, which gains an optional `idSet`. Subitem matches pull their parent into view through the existing parent-or-subitem logic. × clears it.
- **`BoardChatChangesModal.jsx`:** grouped Create / Update / Delete, one row per op with a checkbox. Updates show field before → after. Deletes are styled as destructive and show the cascade count. Stale ops carry a warning. The footer has Cancel and "Apply N changes". The modal stays open with the error if the transaction fails.

## 8. Error handling

- API or network error → an error bubble with the message and a Retry button that resends the last request. History is unchanged.
- Tool execution error → returned to the model as a `tool_result` with `is_error: true`, so it can recover or explain.
- Transaction failure → the modal shows it and nothing is applied. Claude gets an `is_error` result.
- A refusal or the loop cap is shown as a visible notice in the chat.

## 9. Testing

Unit tests (`__tests__` beside the code):
- `boardChat/snapshot` — row shape, archived excluded, names resolved.
- `boardChat/proposal` — op validation, tempId parent resolution, before/after diff, staleness detection, Done → `completedAt`.
- `itemWrites.applyChangeSet` — transaction plan: counters, `hasChildren`, cascade (Firestore mocked the way existing tests do).
- `boardFilters` — `idSet` ANDs with the column filters.
- `chatModels` — picks the newest Sonnet; throws on an empty or failed list.
- `chatPricing` — known model → cost; unknown model → `null`.
- `chat.js` handler — auth gate, route registered, error mapping (Anthropic client mocked).

Board refactor safety: the only existing TaskBoard test (`TaskBoard.expandAll.test.jsx`) doesn't touch the write handlers. **Characterization tests** for create, subitem, update and delete are written first. They assert exactly the Firestore writes each handler makes today, with the expected documents copied field for field from the current inline handlers, and they run against the extracted `itemWrites.js` functions. The board then calls those functions, and the full suite plus `vite build` must pass.

UI verification: drive `localhost:5173` with agent-browser. Ask the three example questions, apply one change set, use the AI filter. **This spends real Anthropic credit.** Estimate the cost and get Andy's OK before running it.

## 10. Cost estimate (unverified)

At $2 / $10 per MTok in/out with $0.20 cache reads, a typical question takes 2–3 model calls with a cached ~10K-token snapshot, so roughly **$0.01–$0.05 per question**. These are estimates, to be confirmed against real `usage` during verification.

## 11. Out of scope

- Sync Task Board / Fireflies on the board (deferred, own session).
- Saved chat history.
- Comments, files, categories and tags as write targets.
- An AI Integration page row for Board Chat (the CLAUDE.md sync rule covers Sync Meeting only). Can be added if wanted.

## 12. Resolved (2026-10-21)

1. Name: **Board Chat**.
2. Audit: `createdVia: "board-chat"` on creates only. No automatic comments on updates or deletes in V1.
