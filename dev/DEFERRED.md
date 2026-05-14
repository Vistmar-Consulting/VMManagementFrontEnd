# Deferred Items — Vistamar Management

Items deferred during scaffolding (2026-05-12) and during early V1 development. Add new entries as discovered.

## V1 Bootstrap

- ~~`npm install` — not yet run~~ ✓ done 2026-05-12 (lockfile present)
- ~~Firebase project creation~~ ✓ done 2026-05-13 — `management-db9eb` in `us-west1` on Spark
- Vercel project creation — link new repo to a new Vercel project
- ~~`firebase init` for `firestore`, `storage`~~ ✓ done 2026-05-14 — config files written directly (firebase.json, .firebaserc, firestore.rules, firestore.indexes.json, storage.rules)
- `firebase init functions/` — still pending; V2 work, requires Blaze upgrade
- MUI theme port from VMConsoleFrontEnd (excluding Guide editorial cream/copper palette)
- ~~AuthContext implementation~~ ✓ done 2026-05-13 (Slice 2a) + extended 2026-05-14 (Slice 2b — user-doc bootstrap)
- ~~`useDoc` / `useCollection` hooks implementation~~ ✓ done 2026-05-14 (Slice 2b)
- Migration script (`functions/scripts/migrate-from-sql.js`) — V1 scope only (Members + Organizations + active Items)
- Manual seed: flip `users/P63r1qyS0vOQ4BovyRit6EwI5sk2.role` to `'admin'` in Firebase console (admin SDK bypass — client rules block self-promotion)
- Manual seed: create `organizations/vistamar` doc with `{ name: 'Vistamar Consulting', type: 'internal', accentColor: <TBD>, active: true, createdAt: <serverTimestamp> }` in Firebase console
- Cloud-Function auth-onCreate trigger (spec §5) — deferred until Blaze upgrade for V2; V1 uses client-side bootstrap in AuthContext as documented exception

## V2 Backlog

- Port `api/meetings/*` to `functions/src/meetings/*` — sources archived at `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/`
- Drop Graph code paths during port
- Replace Postmark + Graph sendMail with Gmail send via meetings@ service account
- Tate's recurring meetings migrated to meetings@ via `events.move()`
- Calendar page (decide on lib — FullCalendar dropped, options TBD)
