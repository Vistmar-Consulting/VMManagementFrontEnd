# Chat history — Board Chat and Meeting Chat

**Date:** 2026-10-29 · **Approved by:** Andy (design in session, 2026-10-29) · **Replaces:** the 12-hour localStorage conversation persistence from v0.4.22.

## Goal

Chats work like ordinary chat apps: every conversation is kept until its owner deletes it. A user can open an earlier chat and continue it, start a new chat, or delete chats. Board Chat filter views belong to the chat that created them.

## Decisions (Andy, 2026-10-29)

1. Chats live in Firestore, private to their owner. No other user — admins included — can read them in the app. (The Firebase console, as project owner, can.)
2. Board Chat views remember the chat that made them. Every view stays in the chip row whichever chat is open. Deleting a chat asks whether to delete its views too.
3. Meeting Chat lists only the open agenda's chats. Andy may later want chats from earlier meetings of the same series; not in scope now.
4. Board Chat lists all of the user's Board Chat chats.
5. Any chat can be continued. The first message in an old chat costs more (cache expired) — accepted.
6. Storage: one small summary doc per chat plus one doc per exchange (Firestore 1 MB doc limit).
7. The unsent draft stays as it is (localStorage, per user).

## Decisions made by Claude (for review)

- **Title** = the first question, trimmed to 60 characters. No rename.
- **History** opens in the panel itself (replaces the message list); each row shows title, last used, cost and a delete icon. The panel header shows the open chat's title.
- **On return** the panel opens the chat last open on that page (pointer in localStorage, per user; per user + agenda for Meeting Chat). If it was deleted elsewhere, a new chat opens.
- A chat doc is created at the first Send, not on New chat.
- Delete confirm is an in-app dialog, never `window.confirm`.
- Existing localStorage views are uploaded once per browser as views with no chat. Old localStorage conversations are not migrated (they expire within 12 hours).

## Data

```
users/{uid}/chats/{chatId}
  kind: "board" | "meeting"
  agendaId: string | null
  title: string
  createdAt, updatedAt: timestamp
  costUsd: number, unpriced: boolean
  turnCount: number
  seen: { [id]: ms | string }      # what the model last read (staleness baseline)

users/{uid}/chats/{chatId}/turns/{index, zero-padded}
  index: number
  status: "running" | "done" | "error"
  messagesJson: string             # model messages this exchange appended
  entryJson: string                # what the panel shows (question, reply, steps, cost, error/notice)
  savedAt: timestamp

users/{uid}/boardViews/{viewId}
  label, filters, chatId: string | null, createdAt
```

Messages are stored as JSON strings: Firestore rejects nested arrays and `undefined`, and the string length gives the exact size for the 1 MB check.

Rules (published 2026-10-29, commit `90154ec`): read/write only when `request.auth.uid == uid` and the user is active.

Queries are single-field equality (`kind == "board"`, `agendaId == X`) sorted in the browser — no composite index.

## Behavior

- **Send:** the turn doc is written with status `running` (question + model messages so far), then rewritten when the turn ends (`done` or `error`), together with the chat summary (updatedAt, cost, turnCount, seen) in one batch.
- **Load:** turns in index order. Model history = the messages of every turn that is not `running`. A `running` turn (the page was closed mid-answer) shows "Interrupted when you left the page — ask again" and contributes no messages, so the model never sees a half-finished exchange.
- **Retry** rewrites the same turn doc.
- **Too large:** a turn over ~1,000,000 bytes is not saved; the chat says "This chat can't be saved any further — start a new chat." The conversation on screen keeps working.
- **Save failure:** shown in the panel; never silent.
- **Delete:** turns, chat doc, and (if chosen) the chat's views, in batches of ≤ 450 writes. Deleting the open chat opens a new chat. Board views are removed through the board's own view store so an active view's filters are restored.
- **Switching chats** is disabled while an answer is running.

## Out of scope

Renaming chats; sharing chats; searching chats; showing Meeting Chat chats from earlier meetings of a series.

## Testing

- Unit: the chat store (turn save/load, running-turn handling, size check, delete batching) and the views store (migration, diff writes).
- Component: panel opens the last chat, lists history, deletes (with and without views).
- Live, deployed site, as Andy: Board Chat chat survives a reload and is continued; delete with and without views; a Meeting Chat chat on one agenda does not show on another; reading another user's chats is refused by the rules.
