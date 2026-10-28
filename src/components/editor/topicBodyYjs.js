import * as Y from "yjs";
import { getSchema, createDocument } from "@tiptap/core";
import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import { bodyContentExtensions } from "./editorExtensions.js";
import { fragmentHasRealContent } from "./collabSync.js";

let schema = null;
const bodySchema = () => (schema ||= getSchema(bodyContentExtensions()));

// Write topic bodies straight into the agenda room's Yjs doc, replacing each
// fragment's content (fragment key = topic id or "openFloor", as
// CollabBodyEditor binds it).
// The live fragment wins over Firestore bodyHtml once it has content, so a
// Sync Meeting apply that updates a topic in place must write here too. HTML is
// parsed with the editor's own schema, the same way setContent parses it, and
// converted with the binding the editor uses (@tiptap/y-tiptap). One
// transaction, so collaborators receive every body in a single update.
//
// A BLANK fragment is skipped: it seeds itself from Firestore bodyHtml through
// CollabBodyEditor's single-writer election. Writing it here too would race
// that seed and merge two copies of the body.
export function writeTopicBodies(ydoc, bodiesById) {
  const docs = Object.entries(bodiesById || {})
    .filter(([id]) => fragmentHasRealContent(ydoc, id))
    .map(([id, html]) => [id, createDocument(html || "", bodySchema())]);
  if (!docs.length) return;
  ydoc.transact(() => {
    docs.forEach(([id, pmDoc]) => {
      const fragment = ydoc.get(id, Y.XmlFragment);
      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(pmDoc, fragment);
    });
  });
}
