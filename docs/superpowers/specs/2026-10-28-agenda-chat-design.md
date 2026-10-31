# Agenda Chat — Design

**Date:** 2026-10-28
**Renamed 2026-10-30:** Meeting Chat → Agenda Chat (Andy: it chats with the agenda, not with people in a meeting). Route `/api/ai/agenda-chat`, chat kind `agenda`, Version history source `agenda-chat`.

**Status:** Built overnight 2026-10-28 from Andy's brief; decisions below were made by Claude (Andy was unavailable for questions) and are open for review.

## 1. What it is

A Claude chat panel on a Meeting Agenda page — the agenda's counterpart to Board Chat. Any active team member can:

- **Ask about the meeting**: what a topic covers, what was decided or said in past meetings linked to this agenda (Fireflies summaries, action items, transcripts), which tasks sit under a topic.
- **Change the agenda**: add, rename, rewrite, delete and reorder topics, and move content between topics and the Open Floor.
- **Update their own topic from text they paste**, e.g. "Update the Website topic with this body: …" with the text from their own Claude session.

Feature name: **Agenda Chat**.

## 2. Decisions

| Decision | Choice |
|---|---|
| Where | A "Agenda Chat" button in the agenda header opens a right-side drawer. Available in both Overview and Working views (it acts on the agenda, not on a view). |
| Who | Every active user (same as agenda editing rules). Not gated to admins like Sync Meeting. |
| Writes | One `propose_agenda_changes` call per request. A review modal lists every op with checkboxes (default on), showing the new body. Nothing is written until Apply. |
| Safety | Apply first snapshots the agenda into Version history (source `agenda-chat`, shown as "Before Agenda Chat"), so any apply is one click to revert. Rows whose topic changed after Claude read it are flagged. |
| Live editor | Bodies are written to Firestore and into the live Yjs fragments (`writeTopicBodies`), as Sync Meeting does. Apply refuses before writing anything if the live editor is not connected. |
| Open Floor | Treated as one more body (`set_open_floor`). "Move topic X to Open Floor" = append to Open Floor + delete topic; "make this Open Floor item a topic" = create topic + rewrite Open Floor. The model composes these from the primitive ops; the review shows both halves. |
| Fireflies | Read in the browser with the existing Fireflies client and caches (same as Past Meetings / Sync Meeting): only meetings whose title is in the agenda's `firefliesTitles`, from the 50 most recent recordings. |
| Board items | **Changed 2026-10-30:** Agenda Chat has Board Chat's Task Board toolset (`get_item`, `search_items`, and the board ops: tasks, subtasks, tags, categories, from `api/ai/_lib/boardTools.js`) for the agenda's organization's items (every org's on the master agenda), plus topic-card ops: `update_topic` categoryIds/tagIds and `remove_task` / `restore_task`. One `propose_changes` call carries `agendaOps` and `boardOps`; one review shows both; Apply writes the board half first (so topics can use a new tag), then the agenda half. |
| Model / server | Same handler as Board Chat with its own system prompt and tools: new `agenda-chat` route on `api/ai/dispatch.js`. Latest Sonnet resolved at runtime. Function count unchanged. |
| Persistence | Same as Board Chat: conversation + draft in localStorage per user **and agenda**, 12 idle hours, cleared by New chat. |
| Cost | Per-reply and total cost shown, as in Board Chat. |

## 3. Tools (run in the browser)

Read: `get_agenda` (live topics with ids, org, bodies as HTML, Open Floor), `list_topic_tasks(topicId)`, `list_past_meetings`, `get_meeting_summary(meetingId)`, `get_meeting_transcript(meetingId, query?)` (full transcript, or only the sentences around matches of `query`).

Since 2026-10-30 the write tool is `propose_changes(summary, agendaOps, boardOps)` (see Board items above); the original agenda ops were: `create_topic {name, bodyHtml?, afterTopicId?, orgId?}`, `update_topic {topicId, name?, bodyHtml?}`, `delete_topic {topicId}`, `move_topic {topicId, afterTopicId}` (`afterTopicId: "start"` = first), `set_open_floor {bodyHtml}`. Bodies follow the same HTML rules as Sync Meeting (`BODY_HTML_RULES`) and are sanitized with `sanitizeHtml` before saving. On the master Touch Base, `create_topic` needs `orgId` and a move must stay inside its org's section.

The agenda (topics + bodies + Open Floor + attendees + linked meeting titles) goes in the first message, like Board Chat's board snapshot.
