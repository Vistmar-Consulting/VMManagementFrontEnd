// api/ai/[action].js
//
// Single catch-all for every /api/ai/* route. Vercel counts one Serverless
// Function per file under api/, and the Hobby plan caps a deployment at 12.
// Adding api/content/clients.js (Studio proxy) made 13, so EVERY deployment
// from 2026-07-27 onward built fine and then died at "Deploying outputs..."
// with: "No more than 12 Serverless Functions can be added to a Deployment on
// the Hobby plan." Production froze on the Jul 27 build for a month.
//
// Collapsing generate/prepare/refine into this one dispatcher takes the count
// 13 -> 11, which restores deploys and leaves room for the next Studio route.
//
// The real handlers live in ./_handlers/. A directory whose name starts with
// "_" is NOT treated as a function by Vercel, so they add nothing to the count.
//
// URLs are unchanged — /api/ai/prepare, /api/ai/refine, /api/ai/generate all
// still resolve here and dispatch to the same code as before. No frontend
// change; src/lib/aiAgenda.js keeps calling the same paths.

import generate from "./_handlers/generate.js";
import prepare from "./_handlers/prepare.js";
import refine from "./_handlers/refine.js";

// maxDuration must live on the function file itself, not the handlers. All
// three previously declared 300 and the longest (prepare) genuinely needs it.
export const config = { maxDuration: 300 };

const ROUTES = { generate, prepare, refine };

export default async function handler(req, res) {
  // Vercel populates req.query.action from the [action] path segment.
  const action = String(req.query?.action || "");
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
  if (!route) {
    return res.status(404).json({ error: `Unknown AI route: ${action || "(none)"}` });
  }
  // Each handler still does its own applyCors + requireAuth, exactly as when
  // it was its own function — nothing about the request contract changed.
  return route(req, res);
}
