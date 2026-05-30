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
