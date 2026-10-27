import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const { buildSystem } = await import("../prepare.js");

const categories = [{ slug: "website", name: "Website", description: "Site work", sop: "Bill executes." }];
const tagVocab = [{ name: "hipaa" }];
const orgMeta = [{ slug: "unio", name: "Unio", type: "client" }, { slug: "vistamar", name: "Vistamar", type: "internal" }];

// Locks the Sync Meeting system prompt byte-for-byte across the boardRules.js
// extraction (Board Sync plan Task 3).
describe("prepare buildSystem", () => {
  it("client", () => expect(buildSystem("P {{meetingStyle}}", "working", categories, tagVocab, false, false, [])).toMatchSnapshot());
  it("internal", () => expect(buildSystem("P", "executive", categories, tagVocab, true, false, [])).toMatchSnapshot());
  it("master", () => expect(buildSystem("P", "working", categories, tagVocab, false, true, orgMeta)).toMatchSnapshot());
});
