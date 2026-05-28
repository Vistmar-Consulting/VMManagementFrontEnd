// api/meetings/_lib/auth.js
//
// Shared auth helpers for api/meetings/* endpoints.
//
// SPEC NOTE (structural, not behavioral): the spec's AC #11 calls for an
// X-User-Token check on every Meetings endpoint. The current check is
// PRESENCE-ONLY — any non-empty token passes. Genuine validation (SQL
// lookup against sec.Users, or proxy to Hugo's Console API
// /api/ValidateToken) is a follow-up decision. Flagged explicitly in the
// Plan A handoff so the PR description surfaces this honestly rather than
// claiming parity with Hugo's PM API.
//
// Ref: docs/specs/2026-04-23-cross-tenant-invite-delivery-design.md
// Ref: docs/plans/2026-04-23-cross-tenant-invite-delivery.md (Task 5)

export function requireAuth(req, res) {
  const token = req.headers["x-user-token"];
  if (!token) {
    res.status(401).json({ error: "Missing X-User-Token header" });
    return false;
  }
  // TODO Phase-1 follow-up: validate token against sec.Users (or proxy).
  // Until that decision lands, presence of any non-empty token counts as
  // authenticated — same shape as Hugo's existing endpoints, structurally.
  return true;
}

// Shared resolver: X-User-Token -> { org_Id, user_id, email } row from
// sec.Users. Plan C's orphans + claim endpoints need this for VM-role
// (-1) checks; Plan A does not call it yet. Stub returns null until
// real lookup lands.
export async function getUserFromToken(_token) {
  // TODO Phase-1 follow-up: SQL lookup against sec.Users by token,
  // returning { org_Id, user_id, email }. Keep this stub in place so
  // Plan C's imports don't break when its endpoints land.
  return null;
}
