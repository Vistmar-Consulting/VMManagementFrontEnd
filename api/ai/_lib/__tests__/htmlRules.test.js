import { describe, it, expect, vi } from "vitest";
import { BODY_HTML_RULES } from "../htmlRules.js";

vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

const prepare = await import("../../_handlers/prepare.js");
const refine = await import("../../_handlers/refine.js");
const generate = await import("../../_handlers/generate.js");

const cats = [{ slug: "website", name: "Website", description: "", sop: "" }];

describe("BODY_HTML_RULES", () => {
  it("keeps existing color spans and forbids new ones", () => {
    expect(BODY_HTML_RULES).toContain("<span style>");
    expect(BODY_HTML_RULES).toMatch(/never add a new style or <span>/i);
    expect(BODY_HTML_RULES).not.toMatch(/no inline styles/i);
  });

  it("is used by all three system prompts", () => {
    expect(prepare.buildSystem("P", "working", cats, [], false, false, [])).toContain(BODY_HTML_RULES);
    expect(refine.buildSystem(cats, [], false, [])).toContain(BODY_HTML_RULES);
    expect(generate.buildSystem("P", "working", cats, [], false, false, [])).toContain(BODY_HTML_RULES);
  });
});
