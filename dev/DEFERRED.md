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
- ~~Manual seed: flip Andy's role to `'admin'`~~ ✓ done 2026-05-14
- ~~Manual seed: `organizations/vistamar`~~ ✓ done 2026-05-14 (`accentColor: '#2c5f7c'`)
- Firebase Storage initialization — **deferred to V2 or task-file-attachments slice (whichever lands first)**. Storage was reclassified as Blaze-only by Firebase in late 2025; upgrading early costs billing exposure for zero V1 benefit. `storage.rules` is authored and committed — when Blaze is enabled, `npx firebase deploy --only storage` ships it. Decision logged in `dev/sessions/v0_1_0_Andrew_V1_BOOTSTRAP/context.md` (2026-05-14).
- Cloud-Function auth-onCreate trigger (spec §5) — deferred until Blaze upgrade for V2; V1 uses client-side bootstrap in AuthContext as documented exception

## V2 Backlog

- Port `api/meetings/*` to `functions/src/meetings/*` — sources archived at `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/api/meetings/`
- Drop Graph code paths during port
- Replace Postmark + Graph sendMail with Gmail send via meetings@ service account
- Tate's recurring meetings migrated to meetings@ via `events.move()`
- Calendar page (decide on lib — FullCalendar dropped, options TBD)
