import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub Key Vault so getToken() doesn't reach for real Teams credentials.
vi.mock("../keyvault.js", () => ({
  getTeamsCredentials: () =>
    Promise.resolve({
      clientId: "cid",
      clientSecret: "secret",
      tenantId: "tid",
      hostUserId: "meetings-oid",
    }),
}));

import { setLobbyBypass } from "../graph-events.js";

const TOKEN_URL = "https://login.microsoftonline.com/tid/oauth2/v2.0/token";

// graph-events caches its bearer token module-wide, so the token response only
// has to be served on the first call in the file.
function mockFetch(graphResponse) {
  global.fetch = vi.fn((url) => {
    if (String(url) === TOKEN_URL) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 3600 }),
      });
    }
    return Promise.resolve({
      ok: graphResponse.ok ?? true,
      status: graphResponse.status ?? 200,
      text: () => Promise.resolve(graphResponse.body ?? ""),
      json: () => Promise.resolve({}),
    });
  });
}

function graphCall() {
  return global.fetch.mock.calls.find(([url]) => String(url) !== TOKEN_URL);
}

describe("setLobbyBypass", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PATCHes the onlineMeeting with scope 'everyone' by default", async () => {
    mockFetch({ ok: true });
    await expect(setLobbyBypass({ onlineMeetingId: "om-1" })).resolves.toBe("everyone");

    const [url, opts] = graphCall();
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/users/meetings-oid/onlineMeetings/om-1"
    );
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({
      lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: true },
    });
  });

  it("honours an explicit scope", async () => {
    mockFetch({ ok: true });
    await expect(
      setLobbyBypass({ onlineMeetingId: "om-2", scope: "organizationAndFederated" })
    ).resolves.toBe("organizationAndFederated");
    expect(JSON.parse(graphCall()[1].body).lobbyBypassSettings.scope).toBe(
      "organizationAndFederated"
    );
  });

  it("throws (never silently no-ops) when Graph rejects the PATCH", async () => {
    mockFetch({ ok: false, status: 403, body: "Forbidden" });
    await expect(setLobbyBypass({ onlineMeetingId: "om-3" })).rejects.toThrow(
      /403.*Forbidden/
    );
  });

  it("throws when onlineMeetingId is missing rather than PATCHing a bad URL", async () => {
    mockFetch({ ok: true });
    await expect(setLobbyBypass({})).rejects.toThrow(/onlineMeetingId is required/);
    expect(graphCall()).toBeUndefined();
  });
});
