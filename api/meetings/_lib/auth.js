// api/meetings/_lib/auth.js
//
// V2.2.2b auth upgrade — Firebase ID token verification via the public
// identitytoolkit accounts:lookup endpoint. No service-account / firebase-
// admin SDK required: this calls Google's REST API with the public Firebase
// Web API key, which returns the verified user record (or rejects an
// invalid/expired token).
//
// Replaces the V2.1.x presence-only check. With this in place, all
// V2.2 endpoints (create / cancel / rename / attendees / send-prep /
// send-schedule) can be ungated — there's no longer a forgery path where
// an attacker could call them with X-User-Token: anything.
//
// Gates:
//   1. ID token must be valid and current (Google rejects expired / forged).
//   2. user.email must end in @vistamarconsulting.com.
//   3. user.emailVerified must be true.
//
// In-memory cache: 5-minute TTL on token → user, scoped to the Vercel
// serverless instance. A cold invocation re-verifies on the first call,
// then subsequent calls within the warm window are served from cache.

const VM_DOMAIN_SUFFIX = "@vistamarconsulting.com";
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const tokenCache = new Map();

function getApiKey() {
  // Available on both the FE bundle (Vite VITE_ prefix) and the Vercel
  // serverless runtime (process.env reads any env var regardless of prefix).
  // Set in V2.1.1 alongside the other VITE_FIREBASE_* vars.
  const key = process.env.VITE_FIREBASE_API_KEY;
  if (!key) {
    throw new Error(
      "auth.js: VITE_FIREBASE_API_KEY env var not set on the Vercel project"
    );
  }
  return key;
}

async function verifyIdToken(token) {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) return cached.user;

  // accounts:lookup validates the token (signature + expiry + audience) AND
  // returns the user record in one call. 200 + non-empty users → valid.
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${getApiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!r.ok) return null;
  const data = await r.json();
  const user = Array.isArray(data.users) ? data.users[0] : null;
  if (!user) return null;

  tokenCache.set(token, { user, expiresAt: now + TOKEN_CACHE_TTL_MS });
  return user;
}

// Async version. Endpoints must `if (!(await requireAuth(req, res))) return;`.
export async function requireAuth(req, res) {
  const token = req.headers["x-user-token"];
  if (!token) {
    res.status(401).json({ error: "Missing X-User-Token header" });
    return false;
  }

  let user = null;
  try {
    user = await verifyIdToken(token);
  } catch (err) {
    console.error("auth.js: verify failed", err);
    res.status(500).json({ error: "Auth verification error" });
    return false;
  }

  if (!user) {
    res.status(401).json({ error: "Invalid or expired X-User-Token" });
    return false;
  }

  const email = (user.email || "").toLowerCase();
  if (!email.endsWith(VM_DOMAIN_SUFFIX)) {
    res.status(403).json({ error: "Vistamar domain required" });
    return false;
  }
  // emailVerified is a string "true"/"false" in some response shapes, boolean
  // in others. Normalize.
  const verified = user.emailVerified === true || user.emailVerified === "true";
  if (!verified) {
    res.status(403).json({ error: "Email not verified" });
    return false;
  }

  // Attach for downstream handlers that want the authed user identity.
  req.authUser = { uid: user.localId, email, displayName: user.displayName || null };
  return true;
}

// requireV2_2Enabled is no longer needed — the auth upgrade closes the
// presence-only forgery path that gated the V2.2 endpoints. Kept as a
// no-op shim so endpoint imports don't break in case any branch still
// references it; remove on next pass once all callsites are clean.
export function requireV2_2Enabled() {
  return true;
}
