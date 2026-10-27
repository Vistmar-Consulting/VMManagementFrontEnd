// api/ai/_handlers/chatModels.js
//
// Board Chat always runs the newest Sonnet the API serves, so it upgrades with
// no code change (Andy, 2026-10-21). Resolved from the Models API, memoized
// per warm serverless instance. No hard-coded fallback: if the list fails,
// the request fails loudly.
const TTL_MS = 60 * 60 * 1000;
let cached = null;

export function pickLatestSonnet(models) {
  const sonnets = models.filter((m) => typeof m.id === "string" && m.id.startsWith("claude-sonnet-"));
  if (sonnets.length === 0) throw new Error("Models API returned no Sonnet models");
  sonnets.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return sonnets[0].id;
}

export async function resolveLatestSonnet(client, now = Date.now()) {
  if (cached && now - cached.at < TTL_MS) return cached.id;
  const models = [];
  for await (const m of client.models.list()) models.push(m);
  const id = pickLatestSonnet(models);
  cached = { id, at: now };
  return id;
}

export function resetModelCache() {
  cached = null;
}
