// The code editor's switches (Settings → Editor): the one place that says which of the editor's
// helpers are on. Each is a row in EDITOR_SWITCHES (its words, and whether it starts on), so the
// Settings pane, the editor and the Code panel all read the same list. Remembered in this browser;
// every open editor follows a change at once (src/ide/useEditorSettings.ts). No React here, so
// tests can load it.
import { readPref } from "./prefs";

export interface EditorSettings {
  /** Who last changed each line, and when (git blame): the note on the cursor's line and a line's details. */
  lineHistory: boolean;
  /** Suggestions while typing: names used in the file, and the language's own words. */
  suggestions: boolean;
  /** A wrapped line goes on under its own indentation, not at the left edge. */
  neatWrap: boolean;
  /** A faint line for each level of nesting; the block the cursor is in drawn bright. */
  indentGuides: boolean;
  /** Brackets coloured by how deep they are; the pair at the cursor gives a small pop. */
  colourBrackets: boolean;
  /** The current-line band glides, guides draw in, brackets pop (never when the computer asks for less motion). */
  codeMotion: boolean;
  // Next: `typeAware: boolean`, suggestions that know types (rust-analyzer, the TypeScript language
  // service). Add the field here and its row to EDITOR_SWITCHES; Settings draws it and it is saved
  // with the rest. Nothing reads it yet, so there is no switch for it.
}

export type EditorSwitch = keyof EditorSettings;

export const EDITOR_SWITCHES: { id: EditorSwitch; label: string; hint: string; on: boolean; local?: boolean }[] = [
  {
    id: "lineHistory",
    // From git on this computer: WalkMyCode Lite has no way to it, so it shows no switch for it.
    local: true,
    label: "Line history (who changed each line, and when)",
    hint: "At the end of the line the cursor is on, and in a box when you point at or click a line, while reading or editing. From your own git, so only where WalkMyCode can reach the project's folder on this computer. Blame in a file's header shows every line's author beside the line numbers.",
    on: true,
  },
  {
    id: "suggestions",
    label: "Suggestions while typing",
    hint: "Names already used in the file and the language's own words, as you type. Enter or Tab takes one, Esc closes the list.",
    on: true,
  },
  {
    id: "neatWrap",
    label: "Neat wrapping",
    hint: "A long line that wraps carries on under its own indentation, two columns in, so you can still see where each line starts.",
    on: true,
  },
  {
    id: "indentGuides",
    label: "Indent guides",
    hint: "A faint line for each level of nesting, a colour per level. The block the cursor is in is drawn bright.",
    on: true,
  },
  {
    id: "colourBrackets",
    label: "Coloured brackets",
    hint: "Brackets coloured by how deep they are, so you can see which one closes which.",
    on: true,
  },
  {
    id: "codeMotion",
    label: "Motion in the code",
    hint: "The current line's band glides to the next line, guides draw in, a matching bracket pops. Never when your computer asks for less motion.",
    on: true,
  },
];

export const DEFAULT_EDITOR: EditorSettings = Object.fromEntries(EDITOR_SWITCHES.map((s) => [s.id, s.on])) as unknown as EditorSettings;

/** The switches a build shows: Lite has none for what needs this computer. */
export function editorSwitchesFor(target: string) {
  return target === "lite" ? EDITOR_SWITCHES.filter((s) => !s.local) : EDITOR_SWITCHES;
}

/** The editor's keys, as Settings lists them. */
export const EDITOR_KEYS: { keys: string; what: string }[] = [
  { keys: "Enter / Tab", what: "Take the suggestion (with no list open: a new line, or indent)" },
  { keys: "↑ / ↓", what: "Move in the list of suggestions" },
  { keys: "Esc", what: "Close the list" },
  { keys: "Ctrl+Space", what: "Open the list" },
  { keys: "Ctrl+S", what: "Save the file" },
  { keys: "Shift+Alt+F", what: "Format the file (JavaScript, TypeScript, JSON, CSS, HTML, Markdown, YAML, GraphQL)" },
  { keys: "Ctrl+Enter", what: "Run the code, where it can be run" },
  { keys: "Ctrl+Z / Ctrl+Y", what: "Undo / redo" },
];

export const EDITOR_KEY = "walkmycode.editor";

/** What was saved, cleaned: a switch that is missing or not true/false keeps its default. */
export function parseEditor(v: string | null | undefined): EditorSettings {
  let saved: Record<string, unknown> = {};
  try {
    const j: unknown = v ? JSON.parse(v) : null;
    if (j && typeof j === "object" && !Array.isArray(j)) saved = j as Record<string, unknown>;
  } catch {
    // Not JSON: the defaults.
  }
  const out = { ...DEFAULT_EDITOR };
  for (const s of EDITOR_SWITCHES) if (typeof saved[s.id] === "boolean") out[s.id] = saved[s.id] as boolean;
  return out;
}

// ── in the browser ──

let now: EditorSettings | null = null;
const listeners = new Set<() => void>();

/** The switches now. The same object until one changes. */
export function editorSettings(): EditorSettings {
  if (now === null) {
    try {
      now = parseEditor(readPref(window.localStorage, EDITOR_KEY));
    } catch {
      now = DEFAULT_EDITOR;
    }
  }
  return now;
}

/** Turn a switch on or off: every open editor follows, and this browser remembers. */
export function setEditorSetting(id: EditorSwitch, on: boolean): void {
  const cur = editorSettings();
  if (cur[id] === on) return;
  now = { ...cur, [id]: on };
  try {
    window.localStorage.setItem(EDITOR_KEY, JSON.stringify(now));
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  listeners.forEach((f) => f());
}

/** Hear every change. Returns the unsubscribe. */
export function onEditorSettings(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Another tab changed them: read again. Tests use it to start clean. */
export function rereadEditorSettings(): void {
  now = null;
  listeners.forEach((f) => f());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === EDITOR_KEY) rereadEditorSettings();
  });
}
