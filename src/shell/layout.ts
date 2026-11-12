// Layouts (docs/SHELL.md §5): the presets as builder functions, the saved
// shape, `sanitise` for a layout read back from storage, and where it is kept.
// Pure apart from localStorage; dockview is only a type here, so the tests
// run without a browser.
import type { AddPanelOptions, DockviewApi, SerializedDockview } from "dockview-react";
import { readPref, removePref } from "../lib/prefs";
import { KNOWN_COMPONENTS, PANELS, isEditorId } from "./panels";

export type PresetName = "explore" | "read" | "tour" | "stack";
export const PRESETS: { name: PresetName; label: string; hint: string }[] = [
  { name: "explore", label: "Explore", hint: "Map | Code | Guide, Details, Files" },
  { name: "read", label: "Read", hint: "Files | Code, wide | Guide over Map" },
  { name: "tour", label: "Tour", hint: "Guide, wide | Map over Code" },
  { name: "stack", label: "Stack", hint: "Everything as tabs in one group (narrow windows)" },
];
export const pickDefault = (w: number): PresetName => (w < 900 ? "stack" : "explore");

/** The part of DockviewApi a preset needs (so a test can pass a fake). */
export type PresetApi = Pick<DockviewApi, "clear" | "addPanel" | "getPanel">;

/** Clear the dock and lay out one preset. Editors are not built here: the
 * caller re-adds them from the open files afterwards (§4). */
export function buildPreset(api: PresetApi, name: PresetName, width: number) {
  api.clear();
  const add = (id: string, o: Partial<AddPanelOptions> = {}) =>
    api.addPanel({ id, component: PANELS[id].key, title: PANELS[id].title, renderer: PANELS[id].renderer, ...o } as AddPanelOptions);
  switch (name) {
    case "explore": // Map | Code | Guide, Details, Files
      add("map");
      add("code:home", { position: { referencePanel: "map", direction: "right" }, initialWidth: Math.round(width * 0.34) });
      add("guide", { position: { referencePanel: "code:home", direction: "right" }, initialWidth: 400 });
      add("details", { position: { referencePanel: "guide", direction: "within" }, inactive: true });
      add("files", { position: { referencePanel: "guide", direction: "within" }, inactive: true });
      break;
    case "read": // Files | Code (wide) | Guide over Map
      add("code:home");
      add("files", { position: { referencePanel: "code:home", direction: "left" }, initialWidth: 260 });
      add("guide", { position: { referencePanel: "code:home", direction: "right" }, initialWidth: 380 });
      add("map", { position: { referencePanel: "guide", direction: "below" }, initialHeight: 260 });
      add("details", { position: { referencePanel: "guide", direction: "within" }, inactive: true });
      break;
    case "tour": // Guide (wide chalkboard) | Map over Code
      add("guide");
      add("map", { position: { referencePanel: "guide", direction: "right" }, initialWidth: Math.round(width * 0.55) });
      add("code:home", { position: { referencePanel: "map", direction: "below" } });
      add("details", { position: { referencePanel: "guide", direction: "within" }, inactive: true });
      add("files", { position: { referencePanel: "guide", direction: "within" }, inactive: true });
      break;
    case "stack": // narrow frames: everything tabbed in one group
      add("map");
      for (const id of ["code:home", "guide", "details", "files"]) add(id, { position: { referencePanel: "map", direction: "within" }, inactive: true });
      api.getPanel("map")?.api.setActive();
  }
}

/**
 * The column sizes a preset wants. initialWidth/Height are only hints (a later
 * split takes its space from its neighbour, and the dock may not have its real
 * size yet when the panels are added), so the caller runs this once the dock
 * has been laid out, with its measured width and height.
 */
export function sizePreset(api: Pick<DockviewApi, "getPanel">, name: PresetName, width: number, height: number) {
  const size = (id: string, s: { width?: number; height?: number }) => api.getPanel(id)?.group?.api.setSize(s);
  switch (name) {
    case "explore": {
      const guide = 400;
      const code = Math.round(width * 0.34);
      size("map", { width: Math.max(320, width - guide - code) });
      size("guide", { width: guide });
      break;
    }
    case "read":
      size("files", { width: 260 });
      size("guide", { width: 380 });
      size("map", { height: Math.min(260, Math.round(height * 0.4)) });
      break;
    case "tour":
      size("map", { width: Math.round(width * 0.55) });
      break;
  }
}

// ── saved shape ──

export interface SavedLayout {
  v: 1;
  preset: PresetName | "custom";
  layout: SerializedDockview;
  savedAt: number;
  /** The user's own arrangement, kept while the window is too narrow for it
   * (under 900 px the dock shows Stack) and brought back when it widens. */
  wide?: SerializedDockview;
}
export interface LayoutStorage {
  load(): Promise<SavedLayout | null>;
  save(l: SavedLayout): Promise<void>;
  clear(): Promise<void>;
}

const PRESET_NAMES = new Set<string>(["explore", "read", "tour", "stack", "custom"]);

function isLayout(l: unknown): l is SerializedDockview {
  const d = l as Partial<SerializedDockview> | null | undefined;
  return !!d && typeof d === "object" && !!d.grid && typeof d.grid === "object" && !!d.grid.root && typeof d.panels === "object" && !!d.panels;
}

/** A stored value if it is a layout of this version, else null (older or corrupt data is dropped). */
export function parseSaved(raw: string | null): SavedLayout | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedLayout> | null;
    if (!o || o.v !== 1 || !isLayout(o.layout) || !PRESET_NAMES.has(String(o.preset))) return null;
    const saved: SavedLayout = { v: 1, preset: o.preset as SavedLayout["preset"], layout: o.layout, savedAt: typeof o.savedAt === "number" ? o.savedAt : 0 };
    if (isLayout(o.wide)) saved.wide = o.wide;
    return saved;
  } catch {
    return null;
  }
}

export const LAYOUT_KEY = "walkmycode.layout";

/** localStorage['walkmycode.layout'] (or the old 'lantern.layout'), every access guarded (private mode, blocked storage). */
export const localLayoutStorage: LayoutStorage = {
  async load() {
    try {
      return parseSaved(readPref(window.localStorage, LAYOUT_KEY));
    } catch {
      return null;
    }
  },
  async save(l) {
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* storage full or blocked: the layout just isn't remembered */
    }
  },
  async clear() {
    try {
      removePref(window.localStorage, LAYOUT_KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

// ── sanitise ──

/** Thrown when nothing of a saved layout survives; the caller builds a preset instead. */
export class EmptyLayout extends Error {
  constructor() {
    super("The saved layout has no panels left.");
    this.name = "EmptyLayout";
  }
}

interface LeafData {
  views: string[];
  activeView?: string;
  id: string;
  tabGroups?: { panelIds: string[] }[];
  [k: string]: unknown;
}
interface GridNode {
  type: "leaf" | "branch";
  data: LeafData | GridNode[];
  size?: number;
  visible?: boolean;
}

/** One group's view state, keeping only panels that survive. Null when it ends up empty. */
function filterLeafData(d: LeafData, keep: (id: string) => boolean): LeafData | null {
  const views = (Array.isArray(d.views) ? d.views : []).filter(keep);
  if (!views.length) return null;
  const out: LeafData = { ...d, views, activeView: d.activeView && views.includes(d.activeView) ? d.activeView : views[0] };
  if (Array.isArray(d.tabGroups)) {
    out.tabGroups = d.tabGroups.map((g) => ({ ...g, panelIds: (g.panelIds ?? []).filter(keep) })).filter((g) => g.panelIds.length);
  }
  return out;
}

/** A grid node with dead panels removed, empty leaves and branches dropped, and
 * a branch of one child collapsed into that child (keeping the parent's size). */
function filterNode(n: GridNode, keep: (id: string) => boolean): GridNode | null {
  if (!n || typeof n !== "object") return null;
  if (n.type === "leaf") {
    const data = filterLeafData(n.data as LeafData, keep);
    return data ? { ...n, data } : null;
  }
  const kids = (Array.isArray(n.data) ? n.data : []).map((c) => filterNode(c, keep)).filter((c): c is GridNode => !!c);
  if (!kids.length) return null;
  if (kids.length === 1) return { ...kids[0], size: n.size ?? kids[0].size };
  return { ...n, data: kids };
}

/** The root must stay a branch for dockview's gridview. */
function filterRoot(root: GridNode, keep: (id: string) => boolean): GridNode | null {
  const n = filterNode(root, keep);
  if (!n) return null;
  if (n.type === "leaf") return { type: "branch", data: [{ ...n, size: undefined }], size: root.size };
  return n;
}

function groupIds(n: GridNode | null | undefined, out: Set<string>) {
  if (!n) return out;
  if (n.type === "leaf") out.add((n.data as LeafData).id);
  else for (const c of n.data as GridNode[]) groupIds(c, out);
  return out;
}

type Windowed = { data?: LeafData; grid?: { root: GridNode; [k: string]: unknown }; [k: string]: unknown };

/** A floating or popout entry in either serialized form (single group `data`, or nested `grid`). */
function filterWindowed<T extends Windowed>(w: T, keep: (id: string) => boolean, ids: Set<string>): T | null {
  if (w.grid && typeof w.grid === "object") {
    const root = filterRoot(w.grid.root, keep);
    if (!root) return null;
    groupIds(root, ids);
    return { ...w, grid: { ...w.grid, root } };
  }
  if (w.data) {
    const data = filterLeafData(w.data, keep);
    if (!data) return null;
    ids.add(data.id);
    return { ...w, data };
  }
  return null;
}

export interface SanitiseOptions {
  popoutAllowed: boolean;
  /** The window, to keep a popout turned floating inside it. */
  viewport?: { width: number; height: number };
}

/** A saved layout made safe to restore: no editors (files are per repo), no
 * unknown components, groups and branches fixed up, pop-outs turned into
 * floating groups when this build can't open windows. Throws EmptyLayout. */
export function sanitise(layout: SerializedDockview, opts: SanitiseOptions): SerializedDockview {
  const panels: SerializedDockview["panels"] = {};
  for (const [key, p] of Object.entries(layout.panels ?? {})) {
    if (isEditorId(key)) continue;
    if (!p || !p.contentComponent || !KNOWN_COMPONENTS.has(p.contentComponent)) continue;
    panels[key] = p;
  }
  const keep = (id: string) => Object.prototype.hasOwnProperty.call(panels, id);

  const root = filterRoot(layout.grid.root as unknown as GridNode, keep);
  if (!root || !groupIds(root, new Set()).size) throw new EmptyLayout();
  const ids = groupIds(root, new Set());
  const grid = { ...layout.grid, root: root as unknown as SerializedDockview["grid"]["root"] };
  delete (grid as { maximizedNode?: unknown }).maximizedNode;

  const floating: Windowed[] = [];
  for (const f of (layout.floatingGroups ?? []) as unknown as Windowed[]) {
    const g = filterWindowed(f, keep, ids);
    if (g) floating.push(g);
  }
  const popouts: Windowed[] = [];
  for (const p of (layout.popoutGroups ?? []) as unknown as Windowed[]) {
    const g = filterWindowed(p, keep, ids);
    if (!g) continue;
    if (opts.popoutAllowed) {
      popouts.push(g);
      continue;
    }
    // No windows here: the same box, floating in the page.
    const box = (g.position ?? null) as { left?: number; top?: number; width?: number; height?: number } | null;
    const vw = opts.viewport?.width ?? Infinity;
    const vh = opts.viewport?.height ?? Infinity;
    const width = Math.min(box?.width ?? 400, vw);
    const height = Math.min(box?.height ?? 300, vh);
    const left = Math.max(0, Math.min(box?.left ?? 40, vw - width));
    const top = Math.max(0, Math.min(box?.top ?? 40, vh - height));
    const floatingEntry: Windowed = { position: { left, top, width, height } };
    if (g.grid) floatingEntry.grid = g.grid;
    else floatingEntry.data = g.data;
    floating.push(floatingEntry);
  }

  const out: SerializedDockview = { grid, panels };
  if (floating.length) out.floatingGroups = floating as unknown as SerializedDockview["floatingGroups"];
  if (popouts.length) out.popoutGroups = popouts as unknown as SerializedDockview["popoutGroups"];
  if (layout.activeGroup && ids.has(layout.activeGroup)) out.activeGroup = layout.activeGroup;
  // Edge groups are never used by WalkMyCode; a stray one is dropped.
  return out;
}

/** What makes a layout "this preset": which panels sit where, not the sizes or
 * which tab is showing. Resizing or switching tabs keeps the preset's name. */
export function fingerprint(json: SerializedDockview): string {
  const strip = (n: GridNode): unknown =>
    n.type === "leaf" ? { views: [...(n.data as LeafData).views] } : { b: (n.data as GridNode[]).map(strip) };
  const win = (w: Windowed) => (w.grid ? strip(w.grid.root) : w.data ? { views: [...w.data.views] } : null);
  return JSON.stringify({
    grid: strip(json.grid.root as unknown as GridNode),
    o: json.grid.orientation,
    f: ((json.floatingGroups ?? []) as unknown as Windowed[]).map(win),
    p: ((json.popoutGroups ?? []) as unknown as Windowed[]).map(win),
  });
}
