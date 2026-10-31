# v0.4.24 — Agenda Chat batch (2026-10-30)

**Base:** `0f75b36` (end of v0.4.23) · **Worktree:** `.claude/worktrees/agenda-chat-batch` · Andy asked for nine items to be done without him; decisions made along the way are listed below for his review. All shipped to `origin/dev` and checked on the deployed site except where noted. Model spend for live checks: about $0.65.

## Shipped

| # | Item | Commits | Verified |
|---|---|---|---|
| 1–2 | Organizations → Members: **Role** per member (e.g. CEO, Doctor), shown after the name; Name / Email / Role inputs are labeled. Scheduler auto-capture never clears a role. Role reaches Board Chat (member list) and Agenda Chat (attendees) as `memberRole`. | `9b0cb44` | Local build against live Firestore: set a role, saw "Name · Role", cleared it. |
| 3 | **Board Chat manages tags and categories**: create / rename / recolor / re-scope / delete, usable by tasks in the same proposal (tempId) and by id afterwards. Deletes clear tasks and agenda topic cards (new `lib/categoryWrites.js`, also used by the board's own category delete, which used to leave categories on topics). | `c4fb6c2` | Deployed: created a Golden Vision tag and put it on I-20 in one change; built a view on it in a later message; deleted it (cleared from I-20). |
| 4 | **Sync Meeting / Board Sync Notes + in-meeting tag**: every created, moved or noted task gets a Note (comment, labelled "Sync Meeting" / "Board Sync") with why, meeting + date, and who discussed it; notes on existing tasks go to Notes instead of the description. Every task a sync creates gets the shared In-Meeting tag. | `83cf441` (built by a subagent, reviewed), review fixes in `7704bfa` | Unit tests only. **No live Sync Meeting / Board Sync run** (paid, and it writes real tasks). |
| 5 | **Meeting Chat → Agenda Chat** everywhere: route `/api/ai/agenda-chat`, chat kind `agenda`, Version history source `agenda-chat`, files `src/lib/agendaChat/`, `AgendaChatPanel`. | `394181e` | Deployed: header button and drawer say Agenda Chat; new chats save as kind `agenda`. |
| 6 | **Agenda Chat changes the Task Board**: Board Chat's toolset (tasks, subtasks, tags, categories) plus topic-card ops (`update_topic` categoryIds/tagIds, `remove_task` / `restore_task`). One `propose_changes` with `agendaOps` + `boardOps`, one review; the board half applies first so a topic can use a tag created in the same request. | `2898a2f` | Deployed: put a hand-removed task back on its card; created a tag, tagged I-38 and added the tag to the topic in one change; deleted the tag (cleared from task and topic). |
| 7 | **AI views** replace the view chips: one "AI views" button (searchable list, Refresh + Delete per view) and one pill for the view that is on (Refresh, Reapply when edited, x = off). | `4d33f13` | Deployed. |
| 8 | **Refresh a view**: confirm dialog with the editable request, reruns it in a fresh Board Chat run, updates the view in place. Views now save their `request`; older views take it from the chat message that made them. | `4d33f13` | Deployed: refreshed a view ($0.16). |
| 9 | **Remove from topic** on mini-board rows (`topic.excludedItemIds`), Removed list with Restore. `src/lib/topicItems.js` is now the one rule for what a topic card shows (mini board, KPI strip, Meeting Focus, Attendees, Agenda Chat). | `33194f2` | Deployed: removed I-38 from a card (card, KPIs and attendee counts updated), restored it. |

Also fixed (found while working):
- **Syncs never saw tags added from the Task Board** (`2cf30ed`): `orderBy("sortOrder")` drops docs without the field; 13 tags had none (all ID Care section tags, Links, In-Meeting). Syncs now sort in the browser; the board's Add tag writes a sortOrder; the 13 tags were given one.
- Deleting a task from the mini board left its subtasks orphaned; it now deletes them (`33194f2`).
- On the master agenda, topic cards matched items of the agenda's own org instead of the topic's org (`33194f2`).

## Decisions for Andy's review
- Item 4 uses the **existing shared "In-Meeting" tag** Andy created (id `MfwWJSTarNFOXgggwmAK`); the syncs find it by name, so no second tag was made.
- Notes are authored by whoever clicks Apply (Firestore rules require author = signed-in user), with a Sync Meeting / Board Sync label.
- Removing a task from a card is sticky: it stays off even if its tags change, until restored.
- Board Chat refuses to make a tag one client's while other clients' tasks use it.
- Refresh runs a fresh conversation (not the original chat), so the result reflects the board as it is now.

## Data changes (2026-10-30, through the app's own Firestore code)
- 3 Version history entries: source `meeting-chat` → `agenda-chat`.
- 84 AI Gen tasks given the In-Meeting tag (without bumping `updatedAt`).
- 13 tags given a `sortOrder` (after the existing ones).
- Andy's own chats had no `meeting`-kind chats to rename. Other users' saved Meeting Chat chats (if any) keep `kind: "meeting"`; it is not read (agenda chats are listed by agendaId), and owner-only rules prevent migrating them.
- Test data from live checks removed: qa tags, test view, two test chats; I-20 / I-38 / the topic are as before. A "Before Agenda Chat" version entry from the test remains on Vistamar Platform Development updates.

## Verification
- Full suite: 690/696; the 6 failures were 5-second test timeouts under full-suite load (editor tests + one Board Chat modal test) and all pass when run alone (26/26). Targeted suites after the review fixes pass. `npm run build` passes.
- Independent pre-push review: no critical issues; 2 important + 8 minor, all fixed in `7704bfa` except legacy "meeting-chat" labels, handled by the data migration instead.

## Open
- Item 4 not exercised live. The next real Sync Meeting / Board Sync is its first live run: check the Notes on created tasks and the In-Meeting tag.
- Pre-existing, not changed: vitest 5 s default timeouts under full-suite load (see v0.4.21 test-timeouts session).

## Deferred
(none)
