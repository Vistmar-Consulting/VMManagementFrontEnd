# Vistamar Studio Integration — Guide for the Management App

**Audience:** anyone working on **VMManagement** (this repo).
**Purpose:** get you fully up to speed on how **Vistamar Studio** (the content engine) works and
how we intend to integrate its content pipeline into this app's **Meeting Agendas** and **Task
Boards**.
**Status:** intended design, 2026-06-12. Not yet built. Source design doc lives in the Studio repo
at `docs/specs/content-lifecycle-and-management-integration.md`.

> ⚠️ **READ FIRST — the Meeting Agenda module will need to be redesigned before this integration
> can land.** The current agenda/topics structure (live category/tag filtering over the project
> board) does not have a natural home for externally-sourced content deliverables grouped by month
> with embedded review links. We need to add a **Content** section to the agenda whose items come
> from Studio (not from this app's `items`/`topics`). Plan that redesign as a prerequisite, not an
> afterthought. Details in §5.

---

## 1. What Vistamar Studio is

Studio is a separate **Next.js** app (separate repo `lakong/vistamar-studio`, separate Firebase
project) that plans and generates blog content for our healthcare clients. Each blog moves through
a pipeline:

```
Idea → Outline → Draft → Posted
```

- **Idea** — a proposed blog topic (we pitch ~4 per client per month; the client picks some).
- **Outline** — the structural plan (AI-generated once the idea is approved).
- **Draft** — the full article (AI-generated once the outline is approved).
- **Posted** — live on the client's website (our web team posts it manually).

## 2. How content is modeled (what the API will hand you)

Each blog has a stable id, **`blogId`**, that persists across every stage. Status is **two
independent axes**:

| Axis | Values |
|---|---|
| **Stage** | `Idea` · `Outline` · `Draft` · `Posted` |
| **Approval** (of the current stage) | `Pending Approval` · `Approved` (Idea stage also: `Save for Later`) |

So a blog reads as `{Stage} — {Approval}`, e.g. *"Outline — ready for approval."* That string is
exactly what the agenda renders.

**Approving a stage in Studio automatically generates the next one** (Idea→Outline, Outline→Draft).
Approving the Draft hands off to our web team, who post it and mark it `Posted` (Studio silently
records the go-live date). This automation lives entirely in Studio — see §4 for why that matters
to us.

Other fields you'll get per blog: `clientSlug`, `clientName`, `title`, `targetMonth` (`YYYY-MM`),
`order` (posting sequence within a month), `overdue` (bool), `stageTimestamps`, a `reviewLink`
(Studio's tokenized review URL — read-only for outlines, editable for drafts), `publishedUrl` /
`publishedAt`, and an open `metadata: {}` bag.

## 3. The API contract (Studio → Management)

Studio exposes a **versioned JSON** read API, authed by a shared bearer secret
(`INTEGRATION_API_SECRET`). Versioned (`/v1/`), `blogId`-keyed, **additive-only** (ignore fields
you don't recognize), with a `metadata` bag so new fields never break us.

### Phase 1 — read
- `GET /api/integrations/v1/content?client={slug}&months=current,next&include=overdue,backlog`
  → `{ blogs: Blog[], generatedAt, schemaVersion }`
- `GET /api/integrations/v1/clients` → `[{ slug, name, brandColor, websiteUrl, articleCadencePerMonth }]`

### Phase 2 — write (just approvals, for now)
- `POST /api/integrations/v1/blogs/{blogId}/approve` → approves the current stage in Studio, which
  triggers the next stage. Returns the blog's new `{stage, approval}`.

Example `Blog`:
```jsonc
{
  "blogId": "...",
  "clientSlug": "bryn-mahr-dermatology",
  "title": "Acne Treatment Beyond Topicals: When It's Time for Prescription Help",
  "stage": "Outline",
  "approval": "Pending Approval",
  "stageLabel": "Outline — ready for approval",
  "targetMonth": "2026-06",
  "order": 1,
  "overdue": false,
  "reviewLink": { "url": "https://.../review/r_...", "mode": "read-only" },
  "publishedUrl": null, "publishedAt": null,
  "metadata": {}
}
```

## 4. How this app should consume it

**Do NOT call Studio from the browser** (the secret must stay server-side, and Studio's Firestore
is sealed — no direct cross-project reads). Instead:

1. **Serverless proxy** — add `api/content/list.js` (model it on the existing `api/meetings/*`
   functions). It holds `INTEGRATION_API_SECRET`, calls Studio's `GET /v1/content`, and returns
   JSON to our client. Gate inbound calls with the existing `@vistamarconsulting.com` auth
   (`api/meetings/_lib/auth.js:requireAuth`).
2. **Agenda "Content" section** — on **Sync Meeting**, the proxy fetches all blogs for the meeting's
   org for the **current + next month + anything overdue**, and renders each as:

   > **{Topic Title}** *(hyperlinked to the Studio review link)* — {deliverable}, {status}

   grouped by **month**, with **overdue/outstanding** floated to the top and **Save-for-Later** as
   a separate collapsed **Backlog** line. (This mirrors the agenda format we already use — see the
   reference screenshot in the design discussion.)
3. **Phase 2 — Approve from the agenda.** Add an **Approve** control that POSTs to Studio's approve
   endpoint via the proxy. Because the approve→generate-next logic lives in Studio, we just fire
   the POST; next time you Sync Meeting the blog has advanced (e.g. Idea→Outline, pending approval).
   This keeps the two apps in lockstep with no duplicated workflow logic here.

**Client ↔ Organization mapping.** Studio keys clients by **slug**; we key orgs by
`organizationId`. Start with a small manual map for our ~5 clients; later add a `studioSlug` field
to our `organizations` docs (`firestore.rules` already gates org writes to admins).

## 5. Prerequisite: redesign the Meeting Agenda module

**This is the blocking work for our side.** Today an agenda is `agendas/{id}` with `topics`
subcollections, and topics surface project-board `items` via live category/tag filtering. There is
**no place for externally-sourced content deliverables**. Before integrating, we need to:

- Add a first-class **Content** section to the agenda data model + UI, distinct from `topics`,
  whose entries originate from Studio (keyed by `blogId`), not from our `items`/`topics`.
- Decide whether Studio blogs also become **task-board cards** (`items`) — recommended only behind
  a dedicated `content-studio` tag with idempotent upsert keyed on `blogId` — or live **only** in
  the agenda Content section. (Recommendation: start agenda-only; add cards later if wanted.)
- Define the month-bucketing + overdue/backlog rendering for the Content section.

Treat this redesign as **Phase 0 on the Management side**, sequenced before wiring the Studio API.

## 6. Phasing (joint)

| Phase | Studio | Management |
|---|---|---|
| **0** | Status-model rework + Gantt (internal) | **Meeting Agenda module redesign** (Content section) |
| **1** | Read API (`/v1/content`, `/v1/clients`) | Proxy + Agenda Content panel (read-only) |
| **2** | `POST /v1/.../approve` | Approve action in the agenda |

---

*Questions on the Studio side → see `vistamar-studio/docs/specs/content-lifecycle-and-management-integration.md`
and `vistamar-studio/docs/audit/` for how Studio works internally.*
