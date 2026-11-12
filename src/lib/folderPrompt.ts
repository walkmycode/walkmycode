// Before the fallback folder input (<input webkitdirectory>, used where the
// browser has no showDirectoryPicker, which includes WalkMyCode Lite inside
// Claude), Chrome asks its own "Upload all files…?" question, which cannot be
// restyled or skipped. So "Choose a folder" first shows WalkMyCode's own note
// (src/components/home/FolderPromptSheet.tsx) saying what that question means,
// unless the viewer said "Don't show this again". Never with the real directory
// picker, which asks nothing. Pure, so tests can load it.

/** Set to "1" by "Don't show this again", in this browser only. */
export const FOLDER_PROMPT_OFF = "walkmycode.folderPromptOff";

/** Shown in the note and under the drop zone where the fallback input is used. */
export const DROP_TIP = "Tip: drag the folder onto this page instead; no prompt.";

type Picker = "directory" | "input";

/** localStorage, or null where it is blocked (private mode, a sandboxed frame). */
export function prefStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Whether the viewer asked never to see the note again. */
export function folderPromptOff(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(FOLDER_PROMPT_OFF) === "1";
  } catch {
    return false;
  }
}

/** Whether "Choose a folder" shows the note first: only on the fallback input, and not once it was turned off. */
export function showFolderPrompt(picker: Picker, store: Pick<Storage, "getItem"> | null): boolean {
  return picker === "input" && !folderPromptOff(store);
}

/** "Don't show this again". Not remembered when storage is blocked: the note then shows next time. */
export function turnFolderPromptOff(store: Pick<Storage, "setItem"> | null): void {
  try {
    store?.setItem(FOLDER_PROMPT_OFF, "1");
  } catch {
    /* storage blocked */
  }
}

/** The drop zone's tip: where the fallback input is the picker and a folder can be dropped instead. */
export function showDropTip(plan: { picker: Picker; drop: boolean }): boolean {
  return plan.picker === "input" && plan.drop;
}
