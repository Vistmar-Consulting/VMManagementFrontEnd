import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the Key Vault lookup so sendRelay doesn't reach for a real Postmark token.
vi.mock("../keyvault.js", () => ({
  getPostmarkToken: () => Promise.resolve("test-token"),
}));

import { sendRelay } from "../relay-mail.js";

function mockFetch({ ok = true, status = 200, body }) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok,
      status,
      text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    })
  );
}

const ARGS = { to: "x@vistamarconsulting.com", subject: "S", htmlBody: "<p>hi</p>" };

describe("sendRelay Postmark response handling", () => {
  beforeEach(() => {
    delete process.env.MEETINGS_DEV_OVERRIDE_TO;
  });

  it("resolves when Postmark returns ErrorCode 0", async () => {
    mockFetch({ body: { ErrorCode: 0, Message: "OK", MessageID: "abc" } });
    await expect(sendRelay(ARGS)).resolves.toBeUndefined();
  });

  it("throws on a non-zero ErrorCode even when HTTP status is 200 (silent-failure bug)", async () => {
    mockFetch({ ok: true, status: 200, body: { ErrorCode: 406, Message: "Inactive recipient" } });
    await expect(sendRelay(ARGS)).rejects.toThrow(/406.*Inactive recipient/);
  });

  it("throws on a non-2xx HTTP status", async () => {
    mockFetch({ ok: false, status: 422, body: { ErrorCode: 300, Message: "Invalid email" } });
    await expect(sendRelay(ARGS)).rejects.toThrow(/422/);
  });

  it("throws when a 200 body is not JSON", async () => {
    mockFetch({ ok: true, status: 200, body: "not json" });
    await expect(sendRelay(ARGS)).rejects.toThrow(/unparseable/);
  });

  it("throws when ErrorCode is missing from the body", async () => {
    mockFetch({ ok: true, status: 200, body: { Message: "no code" } });
    await expect(sendRelay(ARGS)).rejects.toThrow(/missing ErrorCode/);
  });
});
