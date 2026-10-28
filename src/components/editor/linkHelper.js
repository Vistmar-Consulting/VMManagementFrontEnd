// Shared link prompt for the rich-body editors. Used both by the cmd/ctrl+K
// handler inside each editor and by the toolbar Link button — each acting on
// the editor it's given (the focused one, in shared-toolbar mode).
export function promptLink(editor) {
  if (!editor) return;
  const currentHref = editor.getAttributes("link").href ?? "";
  const url = window.prompt("Link URL", currentHref);
  if (url === null) return; // cancelled
  if (url.trim() === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  } else {
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }
}

// ProseMirror handleClick for the topic body: a left click on a link opens it
// in a new tab. A contenteditable surface never follows links on its own, so
// without this the only way out was the context menu. Read-only bodies are
// left to the native <a target="_blank"> so the link isn't opened twice.
export function openLinkOnClick(view, _pos, event) {
  if (event.button !== 0 || !view.editable) return false;
  const link = event.target?.closest?.("a[href]");
  if (!link || !view.dom.contains(link)) return false;
  event.preventDefault();
  window.open(link.href, "_blank", "noopener,noreferrer");
  return true;
}
