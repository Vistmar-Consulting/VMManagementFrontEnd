// Keep a long AI request's connection alive while the model works.
//
// /api/ai/prepare holds the response until Opus finishes (often minutes). With
// no bytes flowing, an idle-connection cutoff anywhere between the browser and
// Vercel drops the request: the browser reports "Failed to fetch" while the
// function finishes with a 200 nobody receives (2026-11-02, Unio sync).
//
// This commits a 200 JSON response up front and writes a space at a fixed interval.
// Leading whitespace is valid JSON, so the client still calls res.json(). Because
// the status is already sent, errors after this point go in the body as
// { error } — the client must check for that field, not just res.ok.
export function startKeepAlive(res, intervalMs = 15000) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.flushHeaders?.();
  res.write(" ");
  const timer = setInterval(() => res.write(" "), intervalMs);
  res.on("close", () => clearInterval(timer));
  const send = (body) => {
    clearInterval(timer);
    res.end(JSON.stringify(body));
  };
  return { send, fail: (message) => send({ error: message }) };
}
