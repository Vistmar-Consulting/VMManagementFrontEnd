import { describe, expect, it } from "vitest";
import { buildPeople, personIds, personName } from "../people.js";

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

  it("finds a signed-in person by the email they were assigned by before signing in", () => {
    expect(people.byId["adeemer@vistamarconsulting.com"]).toBe(people.byId.uAndy);
    expect(personIds(people.byId.uAndy)).toEqual(["uAndy", "adeemer@vistamarconsulting.com"]);
    expect(personIds(people.byId["blewis@vistamarconsulting.com"])).toEqual(["blewis@vistamarconsulting.com"]);
  });

  it("a contact listed under two clients is offered for both, once", () => {
    const two = buildPeople({ membersByOrg: { a: [{ email: "x@client.com" }], b: [{ email: "X@client.com" }] } });
    expect(two.list).toHaveLength(1);
    expect(two.list[0].orgIds).toEqual(["a", "b"]);
    expect(ids(two.choicesFor("b"))).toEqual(["x@client.com"]);
  });

  it("carries a directory role as memberRole, never over a user's admin role", () => {
    const withRoles = buildPeople({
      users: [{ id: "uAndy", email: "adeemer@vistamarconsulting.com", role: "admin" }],
      membersByOrg: {
        vistamar: [{ email: "adeemer@vistamarconsulting.com", role: "Founder" }, { email: "blewis@vistamarconsulting.com", role: "Web developer" }],
        unio: [{ email: "tate.robinson@uniohp.com", role: "CEO" }],
      },
    });
    expect(withRoles.byId.uAndy).toMatchObject({ role: "admin", memberRole: "Founder" });
    expect(withRoles.byId["blewis@vistamarconsulting.com"].memberRole).toBe("Web developer");
    expect(withRoles.byId["tate.robinson@uniohp.com"].memberRole).toBe("CEO");
  });

  it("anyone else is assigned by lowercased email", () => {
    expect(people.idForEmail("BLewis@vistamarconsulting.com")).toBe("blewis@vistamarconsulting.com");
    expect(people.idForEmail("someone@elsewhere.com")).toBe("someone@elsewhere.com");
    expect(people.idForEmail("")).toBeNull();
  });
});
