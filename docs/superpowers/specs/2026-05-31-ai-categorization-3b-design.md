# AI Categorization + Tag Coining (Slice 3b) — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design). Build directly + prod-verify (Andy's lighter process).
**Sequence:** After F1 (categories+SOPs), F2 (tags), F3 (200 real items). Folds in F1c (SOPs → AI Gen). Then Slice 5 (AI-Gen tasks).

## 1. Goal

During agenda generation, the AI assigns each topic relevant **categories** (from the 10) + **tags** (from the 29, + can coin new), so each topic's Working-view mini-board surfaces the org's related real work (the backfilled items share that vocabulary). The AI also reads the **category SOPs** (full) to assign accurately + reference the right owner/contact.

## 2. Function (`api/ai/generate.js`)

- Body gains `categories` (`[{slug, name, description, sop}]`) + `tagVocab` (`[{name, layer}]` or grouped names).
- **Output schema** — topics gain `categories: [string]` (1–3 category slugs) + `tags: [string]` (tag names; existing or new).
- `buildSystem`: append a categorization section — the 10 categories (slug · name · description) + the full SOPs + the tag vocabulary; instruct: assign the 1–3 most relevant category **slugs** per topic; assign relevant existing tags; coin a NEW specific tag only when nothing fits and it'll recur; use SOP owners/contacts in the agenda content where useful.
- `buildUserMessage`: unchanged inputs (current agenda, transcripts, project board, other agendas, extra context) — the categories/SOPs/tags go in the system block (stable-ish, could cache later).

## 3. FE (`src/lib/aiAgenda.js`)

- `assembleGenInputs` also loads `categories` (id=slug, name, description, sop) + `tagVocab` (existing tag names) from Firestore; returns them. Summary gains nothing new.
- `generateAgenda` forwards `categories` + `tagVocab`.
- `applyProposal` (resolve + create):
  - Load `categories` + `tags` collections (valid slugs + existing tag name→id).
  - Per topic: resolve `categories` → `categoryIds` (map slug or lowercased-name → slug; drop unknown; dedup). Resolve `tags` → `tagIds`: existing name → id; **new** name → create `tags/{slug(name)}` `{name, color:"#8b5cf6", layer:3, sortOrder, createdAt}` → id. Build a name→id map once for the whole proposal (so a new tag used on 2 topics is created once).
  - Set `topic.categoryIds`/`tagIds` (in the same topic write that already sets name/bodyHtml/sortOrder).

## 4. Review (`AIGenDialog.jsx`)

- The dialog has `tagVocab` (existing names) from assembleGenInputs → flag any proposed tag not in it as **NEW**.
- Review step adds a per-topic categorization view under the rendered agenda: each topic → category chips + tag chips (NEW tags visually flagged). So new vocab is consented before apply creates it.

## 5. Out of scope

Slice 5 (AI-Gen task create/promote, statusId 8); tagging the backfilled items (tighter board focus); prompt caching the category/SOP system block; security deferrals (client-side prompt, FE-only admin gate) unchanged.

---
*End of spec.*
