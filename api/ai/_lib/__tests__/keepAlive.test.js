import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { startKeepAlive } from "../keepAlive.js";

function fakeRes() {
  const res = new EventEmitter();
  res.headers = {};
  res.chunks = [];
  res.ended = false;
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.flushHeaders = vi.fn();
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = (c) => { if (c !== undefined) res.chunks.push(c); res.ended = true; };
  return res;
}

afterEach(() => vi.useRealTimers());

describe("startKeepAlive", () => {
  it("commits a 200 JSON response and writes a byte immediately", () => {
    vi.useFakeTimers();
    const res = fakeRes();
    startKeepAlive(res, 1000);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.chunks).toEqual([" "]);
  });

  it("writes whitespace on every interval until sent", () => {
    vi.useFakeTimers();
    const res = fakeRes();
    const out = startKeepAlive(res, 1000);
    vi.advanceTimersByTime(3000);
    expect(res.chunks).toEqual([" ", " ", " ", " "]);
    out.send({ ok: 1 });
    vi.advanceTimersByTime(5000);
    expect(res.ended).toBe(true);
    expect(JSON.parse(res.chunks.join(""))).toEqual({ ok: 1 });
  });

  it("fail() delivers the error in the body", () => {
    const res = fakeRes();
    startKeepAlive(res, 1000).fail("boom");
    expect(JSON.parse(res.chunks.join(""))).toEqual({ error: "boom" });
  });

  it("stops writing when the client disconnects", () => {
    vi.useFakeTimers();
    const res = fakeRes();
    startKeepAlive(res, 1000);
    res.emit("close");
    vi.advanceTimersByTime(5000);
    expect(res.chunks).toEqual([" "]);
  });
});
