// dev/test-studio-call.mjs
//
// Smoke test for the Studio integration infrastructure. Calls Studio's
// /v1/clients endpoint through the shared studioFetch helper — the SAME code
// path the api/content/* proxies use — but without the HTTP/auth layer, so it
// verifies the Studio call works without needing a Firebase X-User-Token or a
// running `vercel dev`.
//
// Prereq: a Studio server reachable at STUDIO_API_URL with a matching
// INTEGRATION_API_SECRET. For local dev, start Studio's Next.js dev server and
// point STUDIO_API_URL at it.
//
// Run:  node --env-file=.env.vercel dev/test-studio-call.mjs

import { getStudioClients } from "../api/content/_lib/studio.js";

const target = process.env.STUDIO_API_URL || "http://localhost:3007 (default)";
console.log(`→ Studio API: ${target}\n`);

try {
  const data = await getStudioClients();
  const clients = data.clients ?? data; // tolerate {clients:[...]} or [...]
  console.log(`✓ GET /api/integrations/v1/clients → ${clients.length} client(s):`);
  for (const c of clients) console.log(`    - ${c.slug}  (${c.name})`);
  console.log("\nInfrastructure OK — Management can reach the Studio API.");
} catch (err) {
  console.error(`✗ FAILED: ${err.name || "Error"} — ${err.message}`);
  if (err.status) console.error(`  Studio HTTP ${err.status}`, err.body ?? "");
  process.exitCode = 1;
}
