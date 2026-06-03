import { Liveblocks } from "@liveblocks/node";
import { applyCors } from "./meetings/_lib/cors.js";
import { requireAuth } from "./meetings/_lib/auth.js";

const liveblocks = new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY });

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return res.status(500).json({ error: "LIVEBLOCKS_SECRET_KEY not configured" });
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
