import { Liveblocks } from "@liveblocks/node";
import { applyCors } from "./meetings/_lib/cors.js";
import { requireAuth } from "./meetings/_lib/auth.js";

const liveblocks = new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY });

// A tab running an older bundle can silently delete content its editor schema
// doesn't know (e.g. tables) from the shared room. Only the deployed build may
// join. "dev" is a local Vite build pointed at a deployed API. Bundles from
// before this check send no build ID and are refused too.
export function isStaleBuild(clientBuild, serverBuild) {
  if (!serverBuild) return false;
  if (clientBuild === "dev") return false;
  return clientBuild !== serverBuild;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return res.status(500).json({ error: "LIVEBLOCKS_SECRET_KEY not configured" });
  }
  if (isStaleBuild(req.headers["x-build-id"], process.env.VERCEL_GIT_COMMIT_SHA)) {
    return res.status(426).json({ error: "Stale app version — reload" });
  }
  if (!(await requireAuth(req, res))) return; // sends its own 401/403

  const { uid, displayName, email } = req.authUser;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const name = String(body.name || displayName || email || "User");
  const color = String(body.avatarColor || "#888888");

  const session = liveblocks.prepareSession(uid, { userInfo: { name, color } });
  session.allow("agenda:*", session.FULL_ACCESS);
  const { status, body: authBody } = await session.authorize();
  return res.status(status).send(authBody);
}
