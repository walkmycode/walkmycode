// The panel registry (docs/SHELL.md §3): every panel the dock can show, its
// title, glyph, whether it can be closed, and its Alt+<n> shortcut. Pure data,
// so the layout code and its tests can read it without loading React.

export type PanelId = "map" | "code:home" | `code:${string}` | "guide" | "details" | "files" | "settings" | "coderoom" | "output";

export interface PanelDef {
  /** Component key in DockviewReact `components`. */
  key: string;
  title: string;
  /** Tab glyph, plain text. */
  icon: string;
  /** No close button (map, code:home, guide). */
  pinned?: boolean;
  /** False hides it from the Layout menu (the Code room until it is built). */
  available: boolean;
  renderer: "always" | "onlyWhenVisible";
  /** Alt+<n> reveals it (§9). */
  shortcut: number;
}

export const PANELS: Record<string, PanelDef> = {
  map: { key: "map", title: "Map", icon: "▦", pinned: true, available: true, renderer: "always", shortcut: 1 },
  "code:home": { key: "codeHome", title: "Code", icon: "‹›", pinned: true, available: true, renderer: "always", shortcut: 2 },
  guide: { key: "guide", title: "Guide", icon: "▭", pinned: true, available: true, renderer: "always", shortcut: 3 },
  details: { key: "details", title: "Details", icon: "ⓘ", available: true, renderer: "always", shortcut: 4 },
  files: { key: "files", title: "Files", icon: "▤", available: true, renderer: "always", shortcut: 5 },
  settings: { key: "settings", title: "Settings", icon: "⚙", available: true, renderer: "onlyWhenVisible", shortcut: 6 },
  coderoom: { key: "coderoom", title: "Code room", icon: "▶", available: false, renderer: "onlyWhenVisible", shortcut: 7 },
  // The code's output, popped out from under the editor (src/ide/outputStore.ts).
  // Always mounted: while it is open, the output lives here instead.
  output: { key: "output", title: "Output", icon: "▷", available: true, renderer: "always", shortcut: 8 },
};

/** Dynamic editors: id `code:<path>`, component 'code', params { path }. Not in PANELS. */
export const CODE_COMPONENT = "code";
export const isEditorId = (id: string) => id.startsWith("code:") && id !== "code:home";
export const editorPath = (id: string) => id.slice("code:".length);
export const editorId = (path: string) => `code:${path}`;
export const basename = (path: string) => path.split("/").pop() || path;

/** Every component key a saved layout may name (editors are never restored). */
export const KNOWN_COMPONENTS = new Set(Object.values(PANELS).map((p) => p.key));

/** The registry entry for the Alt+<n> shortcut, if any. */
export const panelForShortcut = (n: number): string | undefined => Object.keys(PANELS).find((id) => PANELS[id].shortcut === n);
