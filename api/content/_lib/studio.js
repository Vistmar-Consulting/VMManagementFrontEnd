// api/content/_lib/studio.js
//
// Server-side client for Vistamar Studio's integration API. This is the single
// chokepoint through which every Management → Studio call flows: it holds the
// shared bearer secret and the Studio base URL (both from env) so no Studio
// credential ever reaches the browser, and it normalizes error handling so
// route handlers stay thin.
//
// Env:
//   STUDIO_API_URL          Base URL of the Studio deployment to call.
//                           Defaults to the local Studio dev server so local
//                           dev works with zero config. Set to the deployed
//                           Studio URL in Vercel for staging/prod.
//   INTEGRATION_API_SECRET  Shared server-to-server bearer secret. MUST match
//                           Studio's INTEGRATION_API_SECRET.
//
// Studio API contract: docs/studio-integration-guide.md §3.

const DEFAULT_STUDIO_API_URL = "http://localhost:3007";

export class StudioApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.body = body;
  }
}

function getConfig() {
  const baseUrl = (process.env.STUDIO_API_URL || DEFAULT_STUDIO_API_URL).replace(/\/$/, "");
  const secret = process.env.INTEGRATION_API_SECRET;
  if (!secret) {
    // Configuration fault, not a client error — surface as 500 upstream.
    throw new StudioApiError("INTEGRATION_API_SECRET not configured", 500);
  }
  return { baseUrl, secret };
}

// Calls a Studio integration endpoint. `path` is the absolute API path,
// e.g. "/api/integrations/v1/clients". Returns parsed JSON; throws
// StudioApiError (carrying Studio's HTTP status + body) on any non-2xx so
// callers can map the status through to their own response.
export async function studioFetch(path, { method = "GET", body, signal } = {}) {
  const { baseUrl, secret } = getConfig();

  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text; // non-JSON error page (e.g. a 404 HTML body)
  }

  if (!res.ok) {
    const msg = (data && data.error) || `Studio API responded ${res.status}`;
    throw new StudioApiError(msg, res.status, data);
  }
  return data;
}

// ── Convenience wrappers for the Phase-1 read endpoints ────────────────────

// GET /v1/clients → { clients: [{ slug, name, brandColor, websiteUrl, articleCadencePerMonth }] }
export function getStudioClients(opts) {
  return studioFetch("/api/integrations/v1/clients", opts);
}

// GET /v1/content → { blogs: Blog[], generatedAt, schemaVersion }
// Optional filters: client (slug), months ("current,next" | "YYYY-MM"),
// include ("overdue,backlog").
export function getStudioContent({ client, months, include, ...opts } = {}) {
  const q = new URLSearchParams();
  if (client) q.set("client", client);
  if (months) q.set("months", months);
  if (include) q.set("include", include);
  const qs = q.toString();
  return studioFetch(`/api/integrations/v1/content${qs ? `?${qs}` : ""}`, opts);
}
