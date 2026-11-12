// The dockable workspace (docs/SHELL.md): no enterprise-gated dockview option
// is ever passed, presets lay out what §5.1 says, saved layouts are made safe
// before they are restored, and the keyboard table picks the right command.
// (tests/layout.test.ts is the map's lane layout, not the dock.)
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { SerializedDockview } from "dockview-react";
import { DOCK_OPTIONS, lanternTheme } from "../src/shell/theme";
import { EmptyLayout, buildPreset, fingerprint, parseSaved, pickDefault, sanitise, type PresetApi } from "../src/shell/layout";
import { PANELS, editorPath, isEditorId, panelForShortcut } from "../src/shell/panels";
import { commandFor, type Chord } from "../src/shell/keys";

const root = process.cwd();

// ── enterprise guard ──

describe("dockview enterprise guard", () => {
  const bundle = readFileSync(join(root, "node_modules/dockview-core/dist/package/main.esm.mjs"), "utf8");
  const block = (name: string) => {
    const at = bundle.indexOf(`const ${name} =`);
    assert.ok(at >= 0, `${name} not found in the installed dockview-core: the guard needs updating`);
    return bundle.slice(at, bundle.indexOf("];", at) + 2);
  };
  const modules = new Set([...block("ENTERPRISE_MODULE_NAMES").matchAll(/"(\w+)"/g)].map((m) => m[1]));
  const rules = [...block("OPTION_MODULE_RULES").matchAll(/optionKey:\s*"(\w+)"[\s\S]*?moduleName:\s*"(\w+)"/g)].map((m) => ({ key: m[1], module: m[2] }));
  const gated = new Set(rules.filter((r) => modules.has(r.module)).map((r) => r.key));

  it("reads both lists from the installed bundle", () => {
    assert.ok(modules.has("KeyboardNavigation") && modules.has("SmartGuides"), "enterprise module names parsed");
    for (const k of ["keyboardNavigation", "overflow", "smartGuides", "pinnedTabs", "layoutHistory", "autoHideEdgeGroups", "dockToEdgeGroups", "dndCompass"]) {
      assert.ok(gated.has(k), `${k} is gated`);
    }
  });

  it("passes no gated option in DOCK_OPTIONS or the theme", () => {
    for (const k of Object.keys(DOCK_OPTIONS)) assert.ok(!gated.has(k), `DOCK_OPTIONS.${k} needs dockview-enterprise`);
    for (const k of Object.keys(lanternTheme)) assert.ok(!gated.has(k), `lanternTheme.${k} needs dockview-enterprise`);
  });

  it("passes no gated option anywhere in the shell's source", () => {
    const dir = join(root, "src/shell");
    const files = [...readdirSync(dir).map((f) => join(dir, f)), ...readdirSync(join(dir, "panels")).map((f) => join(dir, "panels", f))].filter((f) => /\.tsx?$/.test(f));
    const workspace = readFileSync(join(dir, "Workspace.tsx"), "utf8");
    const dock = workspace.slice(workspace.indexOf("<DockviewReact"));
    const props = [...dock.slice(0, dock.indexOf("/>")).matchAll(/\s(\w+)=\{/g)].map((m) => m[1]);
    assert.ok(props.includes("onReady"), "found the DockviewReact props");
    for (const p of props) assert.ok(!gated.has(p), `<DockviewReact ${p}> needs dockview-enterprise`);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // `overflow` is only gated for some values (and is a CSS property too): checked by value below.
      for (const k of gated) if (k !== "overflow") assert.ok(!new RegExp(`\\b${k}\\s*[:=]`).test(src), `${f} sets ${k}`);
      assert.ok(!/mode:\s*["']wrap|maxRows\s*:|\bsearch\s*:\s*true|\bmru\s*:/.test(src), `${f} sets a gated overflow option`);
      assert.ok(!/["']pin["']/.test(src), `${f} uses the enterprise 'pin' tab menu item`);
    }
  });
});

// ── registry ──

describe("panel registry", () => {
  it("tells editors from the code home", () => {
    assert.ok(isEditorId("code:src/a.ts"));
    assert.ok(!isEditorId("code:home"));
    assert.equal(editorPath("code:web/src/a.ts"), "web/src/a.ts");
  });
  it("maps Alt+<n> to a panel, with Map, Code and Guide pinned", () => {
    assert.equal(panelForShortcut(1), "map");
    assert.equal(panelForShortcut(4), "details");
    assert.equal(panelForShortcut(9), undefined);
    assert.deepEqual(
      Object.keys(PANELS).filter((id) => PANELS[id].pinned),
      ["map", "code:home", "guide"],
    );
  });
});

// ── presets ──

interface Added {
  id: string;
  component: string;
  position?: { referencePanel?: string; direction?: string };
  inactive?: boolean;
  initialWidth?: number;
}
function fakeApi() {
  const added: Added[] = [];
  let cleared = 0;
  let active = "";
  const api = {
    clear: () => {
      cleared++;
      added.length = 0;
    },
    addPanel: (o: Added) => {
      added.push(o);
      return { api: { setActive: () => (active = o.id) } };
    },
    getPanel: (id: string) => (added.some((a) => a.id === id) ? { api: { setActive: () => (active = id) } } : undefined),
  } as unknown as PresetApi;
  return { api, added, cleared: () => cleared, active: () => active };
}

describe("presets", () => {
  it("first-runs narrow frames into Stack", () => {
    assert.equal(pickDefault(800), "stack");
    assert.equal(pickDefault(1440), "explore");
  });

  it("Explore is Map | Code | Guide with Details and Files behind it", () => {
    const f = fakeApi();
    buildPreset(f.api, "explore", 1000);
    assert.equal(f.cleared(), 1);
    assert.deepEqual(
      f.added.map((a) => [a.id, a.position?.referencePanel ?? null, a.position?.direction ?? null]),
      [
        ["map", null, null],
        ["code:home", "map", "right"],
        ["guide", "code:home", "right"],
        ["details", "guide", "within"],
        ["files", "guide", "within"],
      ],
    );
    assert.equal(f.added[1].initialWidth, 340);
    assert.ok(f.added[3].inactive && f.added[4].inactive);
    assert.equal(f.added[1].component, "codeHome");
  });

  it("Read, Tour and Stack place every core panel and never an editor", () => {
    for (const name of ["read", "tour", "stack"] as const) {
      const f = fakeApi();
      buildPreset(f.api, name, 1200);
      const ids = f.added.map((a) => a.id);
      for (const id of ["map", "code:home", "guide", "details"]) assert.ok(ids.includes(id), `${name} has ${id}`);
      assert.ok(!ids.some(isEditorId), `${name} adds no editor`);
    }
    const s = fakeApi();
    buildPreset(s.api, "stack", 700);
    assert.ok(s.added.slice(1).every((a) => a.position?.direction === "within" && a.position.referencePanel === "map"));
    assert.equal(s.active(), "map");
  });
});

// ── saved layouts ──

const panel = (id: string, contentComponent: string, extra: object = {}) => ({ id, contentComponent, title: id, ...extra });
const leaf = (id: string, views: string[], activeView = views[0], size = 100) => ({ type: "leaf" as const, data: { id, views, activeView }, size });
const branch = (data: unknown[], size = 100) => ({ type: "branch" as const, data, size });

function sample(): SerializedDockview {
  return {
    grid: {
      root: branch([leaf("g1", ["map"]), leaf("g2", ["code:home", "code:src/a.ts", "code:src/b.ts"], "code:src/b.ts"), branch([leaf("g3", ["guide", "details", "files"]), leaf("g4", ["gone"])], 400)]),
      width: 1400,
      height: 800,
      orientation: "HORIZONTAL",
    },
    panels: {
      map: panel("map", "map"),
      "code:home": panel("code:home", "codeHome"),
      "code:src/a.ts": panel("code:src/a.ts", "code", { params: { path: "src/a.ts" } }),
      "code:src/b.ts": panel("code:src/b.ts", "code", { params: { path: "src/b.ts" } }),
      guide: panel("guide", "guide"),
      details: panel("details", "details"),
      files: panel("files", "files"),
      gone: panel("gone", "renamedLongAgo"),
    },
    activeGroup: "g4",
  } as unknown as SerializedDockview;
}

const leaves = (n: { type: string; data: unknown }): { id: string; views: string[]; activeView?: string }[] =>
  n.type === "leaf" ? [n.data as { id: string; views: string[]; activeView?: string }] : (n.data as { type: string; data: unknown }[]).flatMap(leaves);

describe("sanitise", () => {
  it("drops every editor and every unknown component", () => {
    const out = sanitise(sample(), { popoutAllowed: true });
    assert.deepEqual(Object.keys(out.panels).sort(), ["code:home", "details", "files", "guide", "map"]);
    assert.ok(!leaves(out.grid.root).some((l) => l.views.some(isEditorId)));
  });

  it("fixes an activeView that was removed", () => {
    const out = sanitise(sample(), { popoutAllowed: true });
    const g2 = leaves(out.grid.root).find((l) => l.id === "g2")!;
    assert.deepEqual(g2.views, ["code:home"]);
    assert.equal(g2.activeView, "code:home");
  });

  it("drops empty groups and collapses a branch left with one child into it, keeping the branch's size", () => {
    const out = sanitise(sample(), { popoutAllowed: true });
    const root = out.grid.root as unknown as { type: string; data: { type: string; size?: number; data: unknown }[] };
    assert.equal(root.type, "branch");
    assert.equal(root.data.length, 3);
    assert.equal(root.data[2].type, "leaf", "the guide branch collapsed into its one leaf");
    assert.equal(root.data[2].size, 400);
    assert.ok(!leaves(out.grid.root).some((l) => l.id === "g4"));
    assert.equal(out.activeGroup, undefined, "the active group no longer exists");
  });

  it("keeps the root a branch even when one group survives", () => {
    const l = sample();
    (l.grid.root as unknown as { data: unknown[] }).data = [leaf("g1", ["map"]), leaf("g9", ["code:src/z.ts"])];
    const out = sanitise(l, { popoutAllowed: true });
    const root = out.grid.root as unknown as { type: string; data: unknown[] };
    assert.equal(root.type, "branch");
    assert.equal(root.data.length, 1);
  });

  it("throws EmptyLayout when nothing in the grid survives", () => {
    const l = sample();
    (l.grid.root as unknown as { data: unknown[] }).data = [leaf("g9", ["code:src/z.ts", "gone"])];
    assert.throws(() => sanitise(l, { popoutAllowed: true }), EmptyLayout);
  });

  it("filters floating and popout groups in both serialized forms", () => {
    const l = sample();
    l.floatingGroups = [
      { data: { id: "f1", views: ["details", "code:src/a.ts"], activeView: "code:src/a.ts" }, position: { left: 10, top: 10, width: 300, height: 200 } },
      { data: { id: "f2", views: ["code:src/a.ts"] }, position: { left: 0, top: 0, width: 300, height: 200 } },
      { grid: { root: branch([leaf("f3a", ["files"]), leaf("f3b", ["gone"])]), width: 300, height: 200, orientation: "HORIZONTAL" }, position: { left: 5, top: 5, width: 300, height: 200 } },
    ] as unknown as SerializedDockview["floatingGroups"];
    l.popoutGroups = [{ data: { id: "p1", views: ["files"] }, position: { left: 900, top: 50, width: 400, height: 300 }, url: "/popout.html" }] as unknown as SerializedDockview["popoutGroups"];
    const out = sanitise(l, { popoutAllowed: true });
    const fl = out.floatingGroups as unknown as { data?: { views: string[]; activeView?: string }; grid?: { root: { type: string; data: unknown } } }[];
    assert.equal(fl.length, 2, "the editor-only floating group is gone");
    assert.deepEqual(fl[0].data?.views, ["details"]);
    assert.equal(fl[0].data?.activeView, "details");
    assert.deepEqual(leaves(fl[1].grid!.root).map((x) => x.id), ["f3a"]);
    assert.equal(out.popoutGroups?.length, 1);
  });

  it("turns pop-outs into floating groups where windows can't open, in both forms, inside the viewport", () => {
    const l = sample();
    l.popoutGroups = [
      { data: { id: "p1", views: ["files"] }, position: { left: 2000, top: 50, width: 400, height: 300 } },
      { grid: { root: branch([leaf("p2", ["details"])]), width: 300, height: 200, orientation: "HORIZONTAL" }, position: null },
    ] as unknown as SerializedDockview["popoutGroups"];
    const out = sanitise(l, { popoutAllowed: false, viewport: { width: 1280, height: 800 } });
    assert.equal(out.popoutGroups, undefined);
    const fl = out.floatingGroups as unknown as { data?: { views: string[] }; grid?: unknown; position: { left: number; top: number; width: number; height: number } }[];
    assert.equal(fl.length, 2);
    assert.deepEqual(fl[0].data?.views, ["files"]);
    assert.deepEqual(fl[0].position, { left: 880, top: 50, width: 400, height: 300 });
    assert.ok(fl[1].grid, "the nested form stays nested");
    assert.ok(fl[1].position.left >= 0 && fl[1].position.top >= 0);
  });
});

describe("saved layout versions", () => {
  const good = JSON.stringify({ v: 1, preset: "read", layout: sample(), savedAt: 5 });
  it("reads a layout of this version", () => {
    const s = parseSaved(good);
    assert.equal(s?.preset, "read");
    assert.equal(s?.savedAt, 5);
  });
  it("drops other versions, corrupt JSON and wrong shapes", () => {
    assert.equal(parseSaved(null), null);
    assert.equal(parseSaved("{not json"), null);
    assert.equal(parseSaved(JSON.stringify({ v: 2, preset: "read", layout: sample() })), null);
    assert.equal(parseSaved(JSON.stringify({ v: 1, preset: "weird", layout: sample() })), null);
    assert.equal(parseSaved(JSON.stringify({ v: 1, preset: "read", layout: { panels: {} } })), null);
    assert.equal(parseSaved("null"), null);
  });
  it("keeps the wide arrangement saved while the window was narrow, and drops a broken one", () => {
    const kept = parseSaved(JSON.stringify({ v: 1, preset: "stack", layout: sample(), savedAt: 5, wide: sample() }));
    assert.equal(kept?.preset, "stack");
    assert.ok(kept?.wide?.grid.root);
    const broken = parseSaved(JSON.stringify({ v: 1, preset: "stack", layout: sample(), savedAt: 5, wide: { panels: {} } }));
    assert.ok(broken);
    assert.equal(broken.wide, undefined);
  });
});

describe("fingerprint", () => {
  it("ignores sizes and which tab is showing, but not where panels sit", () => {
    const a = sample();
    const b = sample();
    (b.grid.root as unknown as { data: { size: number; data: { activeView: string } }[] }).data[1].size = 999;
    (b.grid.root as unknown as { data: { data: { activeView: string } }[] }).data[1].data.activeView = "code:home";
    b.grid.width = 10;
    assert.equal(fingerprint(a), fingerprint(b));
    const c = sample();
    (c.grid.root as unknown as { data: { data: { views: string[] } }[] }).data[0].data.views = ["map", "files"];
    assert.notEqual(fingerprint(a), fingerprint(c));
  });
});

// ── keys ──

const chord = (key: string, code: string, mods: Partial<Chord> = {}): Chord => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("keyboard table", () => {
  const on = { popout: true };
  it("reveals panels with Alt+<n>, by key code (Alt changes the key on a Mac)", () => {
    assert.deepEqual(commandFor(chord("¡", "Digit1", { altKey: true }), on), { do: "reveal", id: "map" });
    assert.deepEqual(commandFor(chord("5", "Digit5", { altKey: true }), on), { do: "reveal", id: "files" });
    assert.equal(commandFor(chord("9", "Digit9", { altKey: true }), on), null);
  });
  it("leaves browser-reserved chords alone", () => {
    assert.equal(commandFor(chord("1", "Digit1", { ctrlKey: true }), on), null);
    assert.equal(commandFor(chord("w", "KeyW", { ctrlKey: true }), on), null);
    assert.equal(commandFor(chord("P", "KeyP", { ctrlKey: true, shiftKey: true }), on), null);
  });
  it("maps the dock chords", () => {
    assert.deepEqual(commandFor(chord("]", "BracketRight", { ctrlKey: true }), on), { do: "tab", dir: 1 });
    assert.deepEqual(commandFor(chord("{", "BracketLeft", { ctrlKey: true, shiftKey: true }), on), { do: "group", dir: -1 });
    assert.deepEqual(commandFor(chord("F", "KeyF", { ctrlKey: true, shiftKey: true }), on), { do: "float" });
    assert.deepEqual(commandFor(chord("O", "KeyO", { ctrlKey: true, shiftKey: true }), on), { do: "popout" });
    assert.equal(commandFor(chord("O", "KeyO", { ctrlKey: true, shiftKey: true }), { popout: false }), null, "no pop-out in Lite");
    assert.deepEqual(commandFor(chord("D", "KeyD", { ctrlKey: true, shiftKey: true }), on), { do: "dock" });
    assert.deepEqual(commandFor(chord("M", "KeyM", { ctrlKey: true, shiftKey: true }), on), { do: "maximise" });
    assert.deepEqual(commandFor(chord("L", "KeyL", { ctrlKey: true, shiftKey: true }), on), { do: "layoutMenu" });
    assert.deepEqual(commandFor(chord(")", "Digit0", { ctrlKey: true, shiftKey: true }), on), { do: "reset" });
    assert.deepEqual(commandFor(chord("ArrowLeft", "ArrowLeft", { altKey: true, shiftKey: true }), on), { do: "resize", dx: -40, dy: 0 });
    assert.deepEqual(commandFor(chord("ArrowDown", "ArrowDown", { altKey: true, shiftKey: true }), on), { do: "resize", dx: 0, dy: 40 });
    assert.deepEqual(commandFor(chord("Escape", "Escape"), on), { do: "escape" });
    assert.deepEqual(commandFor(chord("k", "KeyK", { metaKey: true }), on), { do: "palette" });
  });
});
