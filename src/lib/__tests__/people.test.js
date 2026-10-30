import { describe, expect, it } from "vitest";
import { buildPeople, personName } from "../people.js";

const users = [
  { id: "uAndy", email: "adeemer@vistamarconsulting.com", displayName: "Andy Deemer" },
  { id: "uSeo", email: "seo@vistamarconsulting.com", displayName: "SEO Analytics" },
  { id: "uGone", email: "former@vistamarconsulting.com", displayName: "Former", active: false },
];
const membersByOrg = {
  vistamar: [
    { email: "adeemer@vistamarconsulting.com", name: "Andy D" },
    { email: "blewis@vistamarconsulting.com", name: "Bill Lewis" },
    { email: "meetings@vistamarconsulting.com", name: "Meetings" },
  ],
  "bryn-mawr": [
    { email: "Scott@BrynMawrDermatology.com", name: "Scott Burkholder" },
    { email: "fred@fireflies.ai", name: "Fireflies" },
  ],
  unio: [{ email: "tate.robinson@uniohp.com", name: "Tate Robinson" }],
};
const people = buildPeople({ users, membersByOrg });
const ids = (list) => list.map((p) => p.id);

describe("buildPeople", () => {
  it("offers the team (signed-in or not) and the item's client contacts, never bots or inactive users", () => {
    expect(ids(people.choicesFor("bryn-mawr"))).toEqual(["uAndy", "blewis@vistamarconsulting.com", "scott@brynmawrdermatology.com"]);
    expect(ids(people.choicesFor("vistamar"))).toEqual(["uAndy", "blewis@vistamarconsulting.com"]);
    expect(ids(people.choicesFor("unio"))).toContain("tate.robinson@uniohp.com");
    expect(ids(people.choicesFor("unio"))).not.toContain("scott@brynmawrdermatology.com");
  });

  it("still resolves someone who can't be assigned, so existing assignments show", () => {
    expect(personName(people.byId.uSeo)).toBe("SEO Analytics");
    expect(people.byId.uSeo.assignable).toBe(false);
    expect(people.byId["fred@fireflies.ai"]).toBeUndefined();
  });

  it("a signed-in teammate is one person, by uid, whatever the directory says", () => {
    expect(people.list.filter((p) => p.email === "adeemer@vistamarconsulting.com")).toHaveLength(1);
    expect(people.idForEmail("ADeemer@vistamarconsulting.com")).toBe("uAndy");
  });

  it("anyone else is assigned by lowercased email", () => {
    expect(people.idForEmail("BLewis@vistamarconsulting.com")).toBe("blewis@vistamarconsulting.com");
    expect(people.idForEmail("someone@elsewhere.com")).toBe("someone@elsewhere.com");
    expect(people.idForEmail("")).toBeNull();
  });
});
