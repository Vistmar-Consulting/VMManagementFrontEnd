# v0.4.22 — Meeting Chat (overnight session)

**Started:** 2026-10-28 23:17 · **Branch:** `worktree-attendee-focus-sync` (worktree `.claude/worktrees/attendee-focus-sync`) · **Base:** `4d97ccb`

Andy assigned three tasks for overnight and asked that decisions be made without him; each decision below is recorded for his review.

## 1. Attendees ↔ Meeting Focus (Working view) — DONE, verified locally

- Attendee counts now count the same tasks as the Meeting Focus scorecards (a parent with subtasks counts its subtasks; archived excluded), narrowed to the selected card. Before, they counted every matched item including parents and archived ones, and ignored the card.
- Meeting Focus already narrowed to the selected attendee; unchanged.
- Zero-count attendees dim like zero focus cards (still clickable).
- Verified on BMD - Biweekly (localhost): In Progress → Andy 1, Scot —; Andy → Assigned 1 / In Progress 1; both → board shows the one matching task.
- Commit `6602944`.

## 2. Board Chat persistence — DONE, verified locally

Decisions: conversation (transcript, model history, staleness baseline) and unsent draft persist in localStorage, keyed per user; expire after **12 idle hours** (a working day survives, the next morning starts fresh); **New chat** clears it; the panel's open/closed state persists too. A turn cut off by leaving the page comes back marked "Interrupted … ask again", outside the model history. A record over the storage quota is dropped and the panel says so.

- Verified (localhost): asked one question ($0.15), typed a draft, went to Calendar and back — panel open with conversation, cost and draft.
- One-question record ≈ 230 KB (mostly the board snapshot); quota ≈ 5 MB.
- Commit `eac3c1d`.

## 3. Meeting Chat — SHIPPED to origin/dev, verified on the deployed site

Spec: `docs/superpowers/specs/2026-10-28-meeting-chat-design.md` (all decisions listed there). Commits `03990f2`, `7762904` (review fixes), `784c255` (live-test fixes).

Pre-push review (independent reviewer) found no critical bugs; all important and minor findings were fixed in `7762904`:
- Version history restore now writes restored bodies into the live editor (before, a Firestore-only restore was overwritten by the live editor's content — this also affected Sync Meeting restores) and keeps a topic's `organizationId` (master agenda).
- Expired chat records purged across agendas; corrupt record discarded; draft saved in its own record; transcripts no longer cached permanently by Meeting Chat.
- Apply re-checks staleness and re-shows the review if a ticked topic changed while it was open; Open Floor compared by content.
- Master-agenda placement edge cases; created topic ids returned to the model; leaving the page stops further model calls (both chats).

Live test on "Vistamar Platform Development updates" (deployed site, ~$0.15 total):
- Past-meetings question: listed 9 linked recordings, read the Oct 15 notes, answered with the source.
- Added a "Meeting Chat test" topic (new fragment seeds from Firestore) ✔
- Pasted a markdown body (bold, nested bullets, link) → converted faithfully; live editor updated in place ✔; not falsely flagged stale after our own previous write ✔
- Moved the topic into the Open Floor (rewrite + delete in one review) ✔
- Restored the first "Before Meeting Chat" version → agenda back to its exact pre-test state, live editor included ✔
- Conversation survived a reload ✔
- Found and fixed live: Liveblocks badge covered the Send button (moved bottom-left); replies showed literal `**markdown**` (prompt). Re-verified after deploy ✔

## Open

- One model call during the live test failed with a browser "Failed to fetch" (no HTTP status). Retry succeeded and it did not recur; cause not determined. The Retry button is the recovery path.
- `AgendaDetail.overviewTopic.test.jsx` timed out once when 19 test files ran in parallel; passes alone (12.5 s, mostly import time). Same class as the v0.4.21 test-timeouts work; not caused by this session.
- Board Chat's prompt has the same "plain text" wording that let Meeting Chat emit markdown; not changed here (Board Chat replies seen tonight were plain).

## Deferred

(none)
