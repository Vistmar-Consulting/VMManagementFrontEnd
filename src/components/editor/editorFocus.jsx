import { createContext, useContext, useState } from "react";

// Tracks which rich body (TipTap editor) is currently focused so a single
// shared toolbar can act on it. The provider wraps the Overview agenda card;
// shared-mode RichBodyEditors register themselves via setActiveEditor on focus.
const EditorFocusContext = createContext(null);

export function EditorFocusProvider({ children }) {
  const [activeEditor, setActiveEditor] = useState(null);
  return (
    <EditorFocusContext.Provider value={{ activeEditor, setActiveEditor }}>
      {children}
    </EditorFocusContext.Provider>
  );
}

// Returns { activeEditor, setActiveEditor }, or null when not inside a provider
// (e.g. RichBodyEditor's default inline mode, used by the Working view).
export function useEditorFocus() {
  return useContext(EditorFocusContext);
}
