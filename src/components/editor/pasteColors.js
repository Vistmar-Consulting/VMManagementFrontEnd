import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const COLOR_PROPS = ["color", "background-color", "background"];

// Text pasted from outside the editor (Google Docs, Gmail, web pages) arrives
// with inline colors on nearly every span — usually an explicit black. Strip
// them so only colors set from the toolbar stick. A paste from another agenda
// editor carries ProseMirror's data-pm-slice marker and keeps its colors.
export function stripPastedColors(html) {
  if (!html || html.includes("data-pm-slice")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("[style]").forEach((el) => {
    COLOR_PROPS.forEach((prop) => el.style.removeProperty(prop));
    // Removing the shorthand can leave its longhands (background-image, ...).
    Array.from(el.style)
      .filter((prop) => prop.startsWith("background"))
      .forEach((prop) => el.style.removeProperty(prop));
    if (!el.getAttribute("style").trim()) el.removeAttribute("style");
  });
  return doc.body.innerHTML;
}

export const PasteColorStrip = Extension.create({
  name: "pasteColorStrip",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: stripPastedColors } })];
  },
});
