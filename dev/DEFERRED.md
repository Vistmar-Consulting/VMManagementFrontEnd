# Deferred Items — Vistamar Management

Items deferred during scaffolding (2026-05-12) and during early V1 development. Add new entries as discovered.

## V1 Bootstrap

- `npm install` — not yet run; deps listed in package.json but lockfile absent
- Firebase project creation — Andrew creates `vm-management` in Firebase console
- Vercel project creation — link new repo to a new Vercel project
- `firebase init` for `functions/`, `firestore`, `storage` (after Firebase project exists)
- MUI theme port from VMConsoleFrontEnd (excluding Guide editorial cream/copper palette)
- AuthContext implementation
- `useDoc` / `useCollection` hooks implementation
- Migration script (`functions/scripts/migrate-from-sql.js`) — V1 scope only (Members + Organizations + active Items)

## V2 Backlog

- Port `api/meetings/*` to `functions/src/meetings/*` — sources archived at `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/`
- Drop Graph code paths during port
- Replace Postmark + Graph sendMail with Gmail send via meetings@ service account
- Tate's recurring meetings migrated to meetings@ via `events.move()`
- Calendar page (decide on lib — FullCalendar dropped, options TBD)
