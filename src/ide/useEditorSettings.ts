// The editor's switches (src/lib/editorSettings.ts) for a component: it draws again when one changes.
import { useSyncExternalStore } from "react";
import { DEFAULT_EDITOR, editorSettings, onEditorSettings, type EditorSettings } from "@/lib/editorSettings";

export function useEditorSettings(): EditorSettings {
  return useSyncExternalStore(onEditorSettings, editorSettings, () => DEFAULT_EDITOR);
}
