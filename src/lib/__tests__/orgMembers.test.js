import { describe, it, expect } from "vitest";
import {
  memberIdFromEmail,
  isClientEmail,
  isVistamarTeamEmail,
  vistamarTeamChoices,
  deliverablesSummary,
} from "../orgMembers.js";

describe("memberIdFromEmail", () => {
  it("lowercases and trims a valid email", () => {
    expect(memberIdFromEmail("  David@UnioHP.com ")).toBe("david@uniohp.com");
  });
  it("returns null for malformed input (no @, no dot after @, whitespace)", () => {
    expect(memberIdFromEmail("notanemail")).toBeNull();
    expect(memberIdFromEmail("a@b")).toBeNull();
    expect(memberIdFromEmail("a b@x.com")).toBeNull();
    expect(memberIdFromEmail("")).toBeNull();
    expect(memberIdFromEmail(null)).toBeNull();
  });
});

describe("isClientEmail", () => {
  it("true for non-vistamar domains", () => {
    expect(isClientEmail("david@uniohp.com")).toBe(true);
  });
  it("false for vistamar (any case)", () => {
    expect(isClientEmail("adeemer@VistamarConsulting.com")).toBe(false);
  });
  it("false for malformed", () => {
    expect(isClientEmail("nope")).toBe(false);
  });
  it("false for the Fireflies notetaker and scheduling proxies", () => {
    expect(isClientEmail("fred@fireflies.ai")).toBe(false);
    expect(isClientEmail("anything@fireflies.ai")).toBe(false);
    expect(isClientEmail("meetings@vistamarconsulting.com")).toBe(false);
    expect(isClientEmail("seo@vistamarconsulting.com")).toBe(false);
  });
});

describe("isVistamarTeamEmail", () => {
  it("accepts a real Vistamar-domain human", () => {
    expect(isVistamarTeamEmail("blewis@vistamarconsulting.com")).toBe(true);
    expect(isVistamarTeamEmail("  BLewis@VistamarConsulting.com ")).toBe(true);
  });
  it("rejects non-Vistamar domains", () => {
    expect(isVistamarTeamEmail("dmorris@brynmawrdermatology.com")).toBe(false);
    expect(isVistamarTeamEmail("candidate@gmail.com")).toBe(false);
  });
  it("rejects the silent scheduling proxies and bots", () => {
    expect(isVistamarTeamEmail("meetings@vistamarconsulting.com")).toBe(false);
    expect(isVistamarTeamEmail("seo@vistamarconsulting.com")).toBe(false);
    expect(isVistamarTeamEmail("fred@fireflies.ai")).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(isVistamarTeamEmail("")).toBe(false);
    expect(isVistamarTeamEmail(null)).toBe(false);
    expect(isVistamarTeamEmail("notanemail")).toBe(false);
  });
});

describe("vistamarTeamChoices", () => {
  const ORG = [
    { name: "Bill Lewis", email: "blewis@vistamarconsulting.com" },
    { name: "Andy Deemer", email: "adeemer@vistamarconsulting.com" },
  ];
  const USERS = [
    { displayName: "Cedric Tuck-Sherman", email: "ctucksherman@vistamarconsulting.com" },
    { displayName: "SEO Analytics", email: "seo@vistamarconsulting.com" },
  ];

  it("unions the org directory with users so neither source can hide a teammate", () => {
    expect(vistamarTeamChoices({ orgMembers: ORG, users: USERS })).toEqual([
      { name: "Andy Deemer", email: "adeemer@vistamarconsulting.com" },
      { name: "Bill Lewis", email: "blewis@vistamarconsulting.com" },
      { name: "Cedric Tuck-Sherman", email: "ctucksherman@vistamarconsulting.com" },
    ]);
  });

  it("keeps a directory-only teammate who has never signed in", () => {
    const names = vistamarTeamChoices({ orgMembers: ORG, users: [] }).map((c) => c.name);
    expect(names).toContain("Bill Lewis");
  });

  it("keeps a signed-in teammate who is missing from the directory", () => {
    const names = vistamarTeamChoices({ orgMembers: [], users: USERS }).map((c) => c.name);
    expect(names).toContain("Cedric Tuck-Sherman");
  });

  // The load-bearing guard: an external guest captured onto the Vistamar org
  // must never be offered as a teammate.
  it("excludes external guests that leaked into the Vistamar directory", () => {
    const polluted = [...ORG, { name: "Denni Morris", email: "dmorris@brynmawrdermatology.com" }];
    const emails = vistamarTeamChoices({ orgMembers: polluted }).map((c) => c.email);
    expect(emails).not.toContain("dmorris@brynmawrdermatology.com");
  });

  it("excludes silent proxies from either source", () => {
    const choices = vistamarTeamChoices({
      orgMembers: [{ name: "Meetings Vistamar", email: "meetings@vistamarconsulting.com" }],
      users: USERS,
    });
    expect(choices.map((c) => c.email)).toEqual(["ctucksherman@vistamarconsulting.com"]);
  });

  it("dedupes by email, preferring the curated directory name", () => {
    const choices = vistamarTeamChoices({
      orgMembers: [{ name: "Scot Robinson", email: "srobinson@vistamarconsulting.com" }],
      users: [{ displayName: "srobinson", email: "SRobinson@vistamarconsulting.com" }],
    });
    expect(choices).toEqual([
      { name: "Scot Robinson", email: "srobinson@vistamarconsulting.com" },
    ]);
  });

  it("sorts by display name, not by email or insertion order", () => {
    expect(vistamarTeamChoices({ orgMembers: ORG }).map((c) => c.name)).toEqual([
      "Andy Deemer",
      "Bill Lewis",
    ]);
  });

  it("drops anyone already on the attendee list", () => {
    const exclude = new Set(["adeemer@vistamarconsulting.com"]);
    const emails = vistamarTeamChoices({ orgMembers: ORG, users: USERS, exclude }).map((c) => c.email);
    expect(emails).not.toContain("adeemer@vistamarconsulting.com");
    expect(emails).toContain("blewis@vistamarconsulting.com");
  });

  it("falls back to the email when no display name is stored", () => {
    expect(vistamarTeamChoices({ orgMembers: [{ email: "hfurth@vistamarconsulting.com" }] })).toEqual([
      { name: "hfurth@vistamarconsulting.com", email: "hfurth@vistamarconsulting.com" },
    ]);
  });

  it("tolerates missing/empty inputs", () => {
    expect(vistamarTeamChoices()).toEqual([]);
    expect(vistamarTeamChoices({ orgMembers: null, users: null })).toEqual([]);
  });
});

describe("deliverablesSummary", () => {
  it("joins the labels of set deliverables with a middot", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Social posts", quantity: 8, cadence: "month" },
    ])).toBe("Blog posts · Social posts");
  });
  it("omits rows with no positive quantity", () => {
    expect(deliverablesSummary([
      { label: "Blog posts", quantity: 4, cadence: "month" },
      { label: "Empty", quantity: 0, cadence: "month" },
      { label: "Nullq", cadence: "month" },
    ])).toBe("Blog posts");
  });
  it("returns an em dash for empty/no deliverables", () => {
    expect(deliverablesSummary([])).toBe("—");
    expect(deliverablesSummary(null)).toBe("—");
  });
});
