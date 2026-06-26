// GET /api/content/clients
//
// Management → Studio proxy. Returns Studio's client roster
// ({ slug, name, brandColor, websiteUrl, articleCadencePerMonth }[]) so the
// agenda layer can build a slug ↔ organizationId map.
//
// This is the FIRST integration call — deliberately the simplest one: no query
// params, no org mapping, and it returns real non-empty data, so it cleanly
// proves the whole Management → Studio chain (env → bearer → Studio API) works.
//
// The Studio bearer secret lives only on the server (in the studio helper); the
// browser calls this proxy with its existing Firebase X-User-Token, gated by
// the same @vistamarconsulting.com check as the meetings endpoints.
//
// Contract: docs/studio-integration-guide.md §4.

import { requireAuth } from "../meetings/_lib/auth.js";
import { applyCors } from "../meetings/_lib/cors.js";
import { getStudioClients, StudioApiError } from "./_lib/studio.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!(await requireAuth(req, res))) return;

  try {
    const data = await getStudioClients();
    return res.status(200).json(data);
  } catch (err) {
    if (err instanceof StudioApiError) {
      // Studio's own auth/config faults are upstream failures from the
      // browser's perspective → 502 Bad Gateway, not a Management 500.
      console.error("GET /api/content/clients — Studio error:", err.status, err.message);
      const status = err.status >= 500 ? 502 : err.status;
      return res.status(status).json({ error: `Studio: ${err.message}` });
    }
    console.error("GET /api/content/clients error:", err);
    return res.status(500).json({ error: err.message });
  }
}
