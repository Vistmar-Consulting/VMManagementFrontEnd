// api/meetings/_lib/cors.js
//
// Shared CORS helper for api/meetings/* endpoints. Allowlist: prod Management
// origin (vm-management-front-end.vercel.app), localhost:5173 (Vite dev), and
// Vercel preview deploys for the vistamar-consulting team.
// Returns true when the request was a handled OPTIONS preflight — callers
// should `if (applyCors(req, res)) return;` at the top of their handler.

const ALLOWED_ORIGINS = [
  "https://vm-management-front-end.vercel.app",
  "http://localhost:5173",
];

// Matches Vercel preview deploy URLs for the vistamar-consulting team.
// Pattern: <project>-<branch-or-hash>-vistamar-consulting.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-vistamar-consulting\.vercel\.app$/;

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RE.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
