import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { ySyncPluginKey } from "y-prosemirror";
import {
  isLocalEditTransaction,
  isBlankContent,
  fragmentHasRealContent,
  decideSeedAction,
  SEED_SETTLE_MS,
  isElectedSeeder,
} from "../collabSync.js";

// y-prosemirror tags transactions it applies from a REMOTE Yjs update with
// { isChangeOrigin: true } under ySyncPluginKey. A local user edit has no such tag.
const tr = (syncMeta) => ({ getMeta: (k) => (k === ySyncPluginKey ? syncMeta : undefined) });

describe("isLocalEditTransaction", () => {
  it("local edit (no y-sync meta) → true", () => {
    expect(isLocalEditTransaction(tr(undefined))).toBe(true);
  });
  it("remote edit (isChangeOrigin true) → false", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: true }))).toBe(false);
  });
  it("y-sync meta present but not a change-origin → true", () => {
    expect(isLocalEditTransaction(tr({ isChangeOrigin: false }))).toBe(true);
  });
  it("malformed transaction (no getMeta) → true (treat as local, fail safe to mirror)", () => {
    expect(isLocalEditTransaction({})).toBe(true);
  });
});

// ── Seed / self-heal logic (the blank-topic incident) ──────────────────────

function makeDoc(key, build) {
  const doc = new Y.Doc();
  build(doc.get(key, Y.XmlFragment));
  return doc;
}
function emptyParagraph() {
  return new Y.XmlElement("paragraph"); // <paragraph></paragraph> — TipTap's default empty doc
}
function paragraphWithText(text) {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}

describe("isBlankContent", () => {
  it("treats empty / whitespace / placeholder markup as blank", () => {
    expect(isBlankContent("")).toBe(true);
    expect(isBlankContent("<p></p>")).toBe(true);
    expect(isBlankContent("<p><br></p>")).toBe(true);
    expect(isBlankContent("<p>&nbsp;</p>")).toBe(true);
    expect(isBlankContent("   ")).toBe(true);
  });
  it("treats real text as non-blank", () => {
    expect(isBlankContent("<p>Real point</p>")).toBe(false);
    expect(isBlankContent("<ul><li>item</li></ul>")).toBe(false);
  });
});

describe("fragmentHasRealContent", () => {
  it("returns false for a truly empty fragment (length 0)", () => {
    const doc = makeDoc("t1", () => {});
    expect(fragmentHasRealContent(doc, "t1")).toBe(false);
  });

  it("REGRESSION (blank-topic incident): an empty <paragraph/> is NOT real content even though length === 1", () => {
    const doc = makeDoc("t1", (frag) => frag.insert(0, [emptyParagraph()]));
    // Exactly what defeated the old guard: a blank body still has a child node,
    // so `fragment.length > 0` read as "populated" and reseeding was blocked.
    expect(doc.get("t1", Y.XmlFragment).length).toBe(1);
    expect(fragmentHasRealContent(doc, "t1")).toBe(false);
  });

  it("returns true when the fragment holds a paragraph with text", () => {
    const doc = makeDoc("t1", (frag) => frag.insert(0, [paragraphWithText("Real talking point")]));
    expect(fragmentHasRealContent(doc, "t1")).toBe(true);
  });
});

describe("decideSeedAction", () => {
  it("skips when the fragment already has real content (never reseed)", () => {
    expect(decideSeedAction({ fragmentHasContent: true, seedHtml: "<p>x</p>" })).toBe("skip");
    expect(decideSeedAction({ fragmentHasContent: true, seedHtml: "" })).toBe("skip");
  });
  it("waits (does NOT lock) when fragment blank and Firestore blank too", () => {
    expect(decideSeedAction({ fragmentHasContent: false, seedHtml: "" })).toBe("wait");
    expect(decideSeedAction({ fragmentHasContent: false, seedHtml: "<p></p>" })).toBe("wait");
  });
  it("seeds when the fragment is blank but Firestore has content", () => {
    expect(decideSeedAction({ fragmentHasContent: false, seedHtml: "<p>real</p>" })).toBe("seed");
  });
});

describe("SEED_SETTLE_MS", () => {
  it("is a positive number", () => {
    expect(typeof SEED_SETTLE_MS).toBe("number");
    expect(SEED_SETTLE_MS).toBeGreaterThan(0);
  });
});

describe("isElectedSeeder", () => {
  it("sole client — empty array → seeds (defensive fallback)", () => {
    expect(isElectedSeeder(5, [])).toBe(true);
  });
  it("sole client — undefined → seeds (defensive fallback)", () => {
    expect(isElectedSeeder(5, undefined)).toBe(true);
  });
  it("self is minimum in a group → seeds", () => {
    expect(isElectedSeeder(3, [3, 7, 12])).toBe(true);
  });
  it("self is not minimum → does not seed", () => {
    expect(isElectedSeeder(7, [3, 7, 12])).toBe(false);
  });
  it("two clients — self is lower → seeds", () => {
    expect(isElectedSeeder(2, [2, 9])).toBe(true);
  });
  it("two clients — self is higher → does not seed", () => {
    expect(isElectedSeeder(9, [2, 9])).toBe(false);
  });
  it("only self in awareness (normal solo case) → seeds", () => {
    expect(isElectedSeeder(5, [5])).toBe(true);
  });
});
