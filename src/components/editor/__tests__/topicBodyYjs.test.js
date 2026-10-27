import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import { writeTopicBodies } from "../topicBodyYjs.js";
import { fragmentHasRealContent } from "../collabSync.js";
import { bodyContentExtensions } from "../editorExtensions.js";

// Y.XmlFragment#toString lowercases node names (bulletList → bulletlist).
const xml = (ydoc, key) => ydoc.get(key, Y.XmlFragment).toString();

// A fragment that already holds content, as a topic open in the room does.
function withBodies(keys) {
  const ydoc = new Y.Doc();
  keys.forEach((k) => {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText("old")]);
    ydoc.get(k, Y.XmlFragment).insert(0, [p]);
  });
  return ydoc;
}

describe("writeTopicBodies", () => {
  it("replaces each populated fragment's content with the new body", () => {
    const ydoc = withBodies(["topicA", "topicB"]);
    writeTopicBodies(ydoc, { topicA: "<p>Hello <strong>world</strong></p>", topicB: "<ul><li><p>One</p></li></ul>" });
    expect(xml(ydoc, "topicA")).toBe("<paragraph>Hello <bold>world</bold></paragraph>");
    expect(xml(ydoc, "topicB")).toBe("<bulletlist><listitem><paragraph>One</paragraph></listitem></bulletlist>");
  });

  it("skips a blank fragment — it seeds from Firestore through the election instead", () => {
    const ydoc = new Y.Doc();
    ydoc.get("topicA", Y.XmlFragment).insert(0, [new Y.XmlElement("paragraph")]);
    writeTopicBodies(ydoc, { topicA: "<p>New</p>", topicB: "<p>Also new</p>" });
    expect(fragmentHasRealContent(ydoc, "topicA")).toBe(false);
    expect(fragmentHasRealContent(ydoc, "topicB")).toBe(false);
  });

  it("keeps a table as a table", () => {
    const ydoc = withBodies(["topicA"]);
    writeTopicBodies(ydoc, { topicA: "<table><tbody><tr><th><p>H</p></th></tr><tr><td><p>c</p></td></tr></tbody></table>" });
    expect(xml(ydoc, "topicA")).toMatch(/^<table><tablerow><tableheader[^>]*><paragraph>H<\/paragraph><\/tableheader><\/tablerow><tablerow><tablecell[^>]*><paragraph>c<\/paragraph><\/tablecell><\/tablerow><\/table>$/);
  });

  it("applies every body in one Yjs transaction", () => {
    const ydoc = withBodies(["a", "b", "c"]);
    let transactions = 0;
    ydoc.on("afterTransaction", () => { transactions += 1; });
    writeTopicBodies(ydoc, { a: "<p>1</p>", b: "<p>2</p>", c: "<p>3</p>" });
    expect(transactions).toBe(1);
  });

  it("renders in a bound editor exactly as the editor's own setContent would", () => {
    const html = '<p>Hi <a href="https://x.test">link</a></p><ul><li><p>One</p></li></ul><table><tbody><tr><td><p>c</p></td></tr></tbody></table>';
    const bind = (ydoc, field) => new Editor({
      extensions: [...bodyContentExtensions(), Collaboration.configure({ document: ydoc, field })],
    });
    const viaSetContent = bind(new Y.Doc(), "ref");
    viaSetContent.commands.setContent(html, { emitUpdate: false });

    const ydoc = withBodies(["topicA"]);
    const editor = bind(ydoc, "topicA");
    writeTopicBodies(ydoc, { topicA: html });
    expect(editor.getHTML()).toBe(viaSetContent.getHTML());
    expect(editor.getHTML()).toContain('href="https://x.test"');
    editor.destroy();
    viaSetContent.destroy();
  });
});
