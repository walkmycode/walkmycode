// The dock's keyboard shortcuts (docs/SHELL.md §9). One table, bound once per
// window document: the main page on mount, each pop-out when it opens.
// Browser-reserved chords (Ctrl+1…9, Ctrl+W, Ctrl+Shift+P) are left alone on
// purpose, so the reveal chords use Alt and pop-out uses O.
import { panelForShortcut } from "./panels";

export type Command =
  | { do: "reveal"; id: string }
  | { do: "tab"; dir: 1 | -1 }
  | { do: "group"; dir: 1 | -1 }
  | { do: "float" }
  | { do: "popout" }
  | { do: "dock" }
  | { do: "escape" }
  | { do: "maximise" }
  | { do: "resize"; dx: number; dy: number }
  | { do: "layoutMenu" }
  | { do: "reset" }
  | { do: "palette" };

export interface ShellCommands {
  run(c: Command): boolean | void;
}

/** What the shortcut list in Settings and the Layout menu shows. */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Alt+1…6", what: "Show Map, Code, Guide, Details, Files or Settings" },
  { keys: "Ctrl+] / Ctrl+[", what: "Next / previous tab in this group" },
  { keys: "Ctrl+Shift+] / [", what: "Next / previous group" },
  { keys: "Ctrl+Shift+F", what: "Float this group" },
  { keys: "Ctrl+Shift+O", what: "Pop this group out into its own window" },
  { keys: "Ctrl+Shift+D or Esc", what: "Dock a floating group back" },
  { keys: "Ctrl+Shift+M", what: "Maximise or restore this group" },
  { keys: "Alt+Shift+Arrows", what: "Make this group wider, narrower, taller or shorter" },
  { keys: "Ctrl+Shift+L", what: "Open the Layout menu" },
  { keys: "Ctrl+Shift+0", what: "Reset the layout" },
  { keys: "Ctrl+K", what: "Go to: a card by name, two names (A to B), or ask how something works and the map flies there" },
  { keys: "Esc", what: "Stop a fly-through (its path stays drawn); again to put it away" },
];

export interface Chord {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const STEP = 40;

/** The command for a key press, or null. Uses `code` where Shift or Alt change `key`. */
export function commandFor(e: Chord, opts: { popout: boolean }): Command | null {
  const { ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta } = e;
  if ((ctrl || meta) && !alt && !shift && e.key.toLowerCase() === "k") return { do: "palette" };
  if (e.key === "Escape" && !ctrl && !alt && !meta) return { do: "escape" };
  if (alt && !ctrl && !meta && !shift) {
    const m = /^Digit([1-9])$/.exec(e.code);
    const id = m ? panelForShortcut(Number(m[1])) : undefined;
    return id ? { do: "reveal", id } : null;
  }
  if (alt && shift && !ctrl && !meta) {
    if (e.key === "ArrowLeft") return { do: "resize", dx: -STEP, dy: 0 };
    if (e.key === "ArrowRight") return { do: "resize", dx: STEP, dy: 0 };
    if (e.key === "ArrowUp") return { do: "resize", dx: 0, dy: -STEP };
    if (e.key === "ArrowDown") return { do: "resize", dx: 0, dy: STEP };
    return null;
  }
  if (!ctrl || alt || meta) return null;
  if (!shift) {
    if (e.code === "BracketRight") return { do: "tab", dir: 1 };
    if (e.code === "BracketLeft") return { do: "tab", dir: -1 };
    return null;
  }
  switch (e.code) {
    case "BracketRight":
      return { do: "group", dir: 1 };
    case "BracketLeft":
      return { do: "group", dir: -1 };
    case "KeyF":
      return { do: "float" };
    case "KeyO":
      return opts.popout ? { do: "popout" } : null;
    case "KeyD":
      return { do: "dock" };
    case "KeyM":
      return { do: "maximise" };
    case "KeyL":
      return { do: "layoutMenu" };
    case "Digit0":
      return { do: "reset" };
  }
  return null;
}

/** Typing somewhere: shortcuts other than Escape and Ctrl+K stay out of the way. */
function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], .cm-content");
}

/** Bind the table to one window's document. Returns the unbinder. */
export function bindKeys(doc: Document, commands: ShellCommands, opts: { popout: boolean }): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const c = commandFor(e, opts);
    if (!c) return;
    if (c.do !== "escape" && c.do !== "palette" && typing(e.target)) return;
    const handled = commands.run(c);
    if (handled !== false) e.preventDefault();
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}
