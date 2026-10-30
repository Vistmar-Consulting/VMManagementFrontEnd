# v0.4.23 — Overnight batch (2026-10-29 → 10-30)

**Started:** 2026-10-29 · **Base:** `faa995b` (end of v0.4.22) · Andy asked for this work to be done without him; decisions made along the way are listed for his review. Budget: $10 for paid calls (spent ≈ $0.31).

Each item was built in its own worktree, reviewed by an independent code-review agent, fixed, and pushed to `origin/dev`.

## Shipped

### 0. Saved chat history (Board Chat + Meeting Chat) — `90154ec` rules, `8ea0620`, `bf63dbe`
Spec: `docs/superpowers/specs/2026-10-29-chat-history-design.md` (decisions approved by Andy in session).
- Chats saved per user in Firestore (`users/{uid}/chats/{id}` + `turns/{n}`), private to the owner (rules published 2026-10-29 23:02). No expiry; users delete chats from History. Meeting Chat lists the open agenda's chats; Board Chat lists all.
- Board Chat filter views moved to Firestore (`users/{uid}/boardViews`), each remembering its chat; deleting a chat asks whether to delete its views.
- Verified live on the deployed site: save, reload, reopen and continue an old chat (model kept the earlier context), delete with views (view removed, filters restored), Meeting Chat chat not shown on another agenda. Test chats deleted afterwards.
- Not verified live: a second user being refused (no second login available); the rule is a plain owner check.

### 5. Agenda mini board: Notes / Files did nothing — `9ed17fd`, `2ce2893`
Root cause: the agenda page never passed the Notes/Files handlers or rendered the modals. Now the same modals as the Task Board. Verified locally.

### 4. "Open in Task Board" on mini-board rows — same commits
`/board?item=<id>` switches to the item's org if needed, keeps it visible through filters, opens its group and parent, scrolls to it and tints it for 10 s. The last rows of a group can't reach the top of the page (nothing below to scroll). Verified locally (top-level item and subtask).

### 1. Agenda "updated … ago" + avatar — `c05c753`, `7880b0e`
Every content edit (title, topics, bodies, Open Floor, topic categories/tags, Sync Meeting, Meeting Chat, Version restore) stamps `lastEditedAt/lastEditedByUid` through `lib/agendaEdits.js`. Sync Meeting now records who ran it (`lastUnifiedGenByUid`), so "synced … ago" gets an avatar from the next sync on. Verified locally.

### 3. Assign tasks to client contacts — `6daa91d`, `c70a3af`
- Root cause for Bill Lewis: the Assigned picker only offered signed-in users; Bill has never signed in. seo@ appeared because it once signed in.
- One people directory (`lib/people.js`): users + Vistamar's member directory + each client's contacts (Client Settings). Bots/proxies never offered. Not-signed-in people are assigned by email; at first sign-in those move to the uid.
- One existing task is assigned to seo@ (left as is; it stays removable).
- Verified locally: BMD task picker shows the team incl. Bill Lewis (no SEO) + BMD's 4 contacts; assign/unassign a contact.

### 2. Shared Tags vs Client Tags — `c70a3af`
- `tags.organizationId`: null = shared, else that org's own. Pickers show shared + the item's client's tags; the Tags filter shows the same for the selected client, all tags on "All"; tag dialog "Used by".
- Live data migrated 2026-10-30 (all 38 tags; before, none had the field):
  - Shared: email, print, website, in-clinic, social-media, video, education, branding, outreach, events, specialty-services, acquisitions, provider-specific, location-specific, corporate, urgent, approval-needed, blocked, client-internal, reputation-management.
  - ID Care: careers, homepage, insurance, launch, leadership-awards, locations, navigation, partner-with-us, providers, site-wide, travel-vaccines, Links.
  - Unio: communications, provider-onboarding, patient-services.
  - Vistamar: hipaa, serp-data, sales-blocker.
- Decision for review: reputation-management was listed as a Unio tag in the original taxonomy but only Bryn Mawr uses it; made shared.

### 6. Thursday "Vistamar Platform Development updates" — Fireflies
- Finding: of the six live meetings@ series, only Thursday Platform Dev and Friday Business Dev invite `fred@fireflies.ai`; seo@ is invited on all six. The 2026-09-14 investigation found fred@ on an invite triggers Fireflies' first-inviter selection, which can send another attendee's notetaker (Cedric's) instead of seo@'s. Lobby bypass is already "everyone" on both.
- Change (2026-10-30): removed `fred@fireflies.ai` from the Thursday series in Teams and Google via the app's attendee helpers (attendees received an updated invite). All five upcoming Thursdays (Nov 5 – Dec 3) verified: seo@ yes, fred@ no.
- Friday Business Dev deliberately left unchanged as a comparison; Andy will report how Friday's meeting goes.
- No meeting was deleted or recreated.

## Open

- Thursday Nov 5: confirm seo@'s Fireflies joins on its own. If it doesn't, next step is recreating the series from meetings@.
- Friday Business Dev still has fred@ on the invite.
- "Prepared by" on the agenda shows the current time, not a real date (pre-existing; not changed).
- Vite's optimized-deps cache in the shared `node_modules` breaks ("styled_default is not a function") when several worktrees run dev servers; `--force` restart fixes it.
- Client guest access (paused design): topic writes are now batched with an agenda-doc stamp, so guest rules would need agenda update rights too.
- A localhost-only "AI: Unio In Progress" view chip from earlier testing was uploaded to Andy's account by the views migration; harmless, Andy can delete it.

## Deferred

(none)
