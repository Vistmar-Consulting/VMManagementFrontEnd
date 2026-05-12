# Vistamar Management

Internal project management app for Vistamar Consulting. Project Board, Meetings, Agendas.

## Stack

- **Frontend:** Vite + React 18 + MUI + Emotion + React Router v6
- **Backend:** Firebase (Auth, Firestore, Cloud Functions, Storage)
- **Hosting:** Vercel (frontend) + Firebase (backend)
- **Auth:** Google SSO restricted to `@vistamarconsulting.com`

## Status

**Scaffolded 2026-05-12.** V1 implementation pending. See `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md` for full spec.

## Quick start

```bash
npm install
cp .env.example .env       # fill in Firebase config from console
npm run dev                # http://localhost:5173
```

## Phasing

- **V1** — Project Board, Members, Organizations, Auth, real-time hooks
- **V2** — Meetings, Agendas, Google Calendar integration, Gmail send
- **V3** — TBD

## Related

- Spec: `docs/superpowers/specs/2026-05-12-vmmanagement-spinout-design.md`
- Reference (PM code extracted from VMConsoleFrontEnd): `~/Vistamar_Consulting/_PM_Archive_From_Console_2026-05-12/`
- Old console (SERP / Reports — non-PM features stay there): `~/Vistamar_Consulting/VMConsoleFrontEnd/`
