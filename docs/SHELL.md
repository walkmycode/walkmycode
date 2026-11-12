# docs/SHELL.md — the dockable workspace (final spec, rev. 2)

Owner requirement (2) — "all the interfaces should support docking and undocking as well as width resizing for ease of view" — is met by this document. Requirement (1) (monolith or microservice repos) touches the shell only through the Map panel's content (§13); requirement (3) (registration) touches it only through `LayoutStorage` and the top-bar user pill (§13, `docs/ACCOUNTS.md` owns the rest).

Changes from rev. 1, all from the verifier's verdict: `keyboardNavigation` removed (enterprise-gated) and tab navigation owned by `keys.ts` (§9); open editors made the source of truth so presets/restore no longer close files (§4, §5); async `onReady` made cancellation-safe under StrictMode (§5.3); React Flow `checkVisibility()` staleness handled (§7); popout stylesheet copying described as it is in 8.3.1 (§6); the light (§8) and motion tokens (§10) decoupled from MOTION.md so tasks 1–7 ship first (§0.2, §12); `preparePopout` copies only font classes (§6); Lite popout gating stated as policy (§11); float fallback and the ↗ button gated correctly (§6).

---

## 0. Decision

### 0.1 One dockview instance

Replace the fixed `.work` CSS grid (`src/app/globals.css:118-120`, `src/app/map/page.tsx:186-246`) with one **dockview-react 8.3.1** instance filling the area under the `.top` bar. In one core it provides: drag-to-redock, split, tab, floating groups, pop-out to a real browser window, sash resizing, and `toJSON()/fromJSON()` for persistence.

Verified facts about the package (read from the shipped `.d.ts` and bundle, not the docs site): MIT; dependency chain `dockview-react → dockview → dockview-core`, no third-party runtime deps; React 19 peer; `dockview-react` does `export * from 'dockview'`. Every API this spec uses exists with the stated shape: `addFloatingGroup(item, {x,y,width,height})`, `addPopoutGroup(item, {position?: Box, popoutUrl, onDidOpen({id, window}), onWillClose}) → Promise<boolean>` (type is `position`, not the docs page's `box`; cite `dockviewComponent.d.ts:33-52`), `popoutRestorationPromise`, `getPopouts()`, `onDidOpenPopoutWindowFail`, `onDidPopoutGroupSizeChange`, `AddPanelOptions.initialWidth/initialHeight/inactive/renderer`, `DockviewDefaultTab hideClose`, `DockviewTheme{name,className,colorScheme,gap,dndOverlayMounting,dndPanelOverlay}` (`className` is split on spaces), `dndEdges:{size:{value,type:'pixels'}}`, `fromJSON` throws on an unknown component after calling `clear()`.

This supersedes MOTION.md §4.13/§4.14 and tasks 12/13 (the hand-rolled `Dock.tsx`). The motion contract they define (beacon on an undocked panel, "Escape docks", the light follows the panel, no scale distortion, direct manipulation while resizing) is kept and re-expressed in §8/§10; the FLIP on undock is dropped (dockview reparents the element; a Motion `layout` FLIP cannot track it) and replaced by a 200 ms `@starting-style` rise on the floating box.

Install:
```
npm i dockview-react@8.3.1
```
Do **not** install `dockview` or `dockview-core` directly.

**Enterprise-gated options — never pass them** (they `console.error` and no-op, or watermark, without a licence; the list is `ENTERPRISE_MODULE_NAMES` in `dockview-core/dist/esm/main.esm.mjs` ~12470-12482 and `OPTION_MODULE_RULES` ~12740): `keyboardNavigation`, `overflow: { mode: 'wrap' }`, `smartGuides`, `pinnedTabs`, `layoutHistory`, `autoHideEdgeGroups`, `dockToEdgeGroups`, `dndCompass`. Task 1 adds a grep of those two arrays to `tests/layout.test.ts` (reads the installed bundle and asserts none of our option keys appear) so an upgrade cannot silently re-gate something we use.

### 0.2 Dependency on MOTION.md — decoupled

`src/lib/light.ts`, `src/components/LanternLight.tsx`, `src/lib/motion.ts` and the `motion` package do **not** exist in the repo yet (src/lib has `claude/`, `cost.ts`, `localFolder.ts`, `providers/`, `store.ts`; `motion` is not in `package.json`). Therefore:

- The shell's own CSS (§10) uses **local tokens** `--sh-t-move: 200ms; --sh-t-tap: 120ms; --sh-ease-out; --sh-ease-settle` with a local reduced-motion block. When MOTION.md task 1 lands, these become aliases of `--t-move` etc. in one line each. Tasks 1–7 and 9 have **no** MOTION.md prerequisite.
- The light contract (§8) is written against the MOTION.md §5 store API and ships as **SHELL task 8, which requires MOTION.md tasks 1, 8 and 10**. Until then, undocked panels are marked by CSS beacons only (§10), which need no JS.
- MOTION.md §4.10's tab-ink `layoutId` is replaced by an `inset` box-shadow transition (tabs are dockview's DOM), so MOTION.md task 9's ink part is also superseded.

---

## 1. Files

```
public/popout.html                       empty same-origin document for pop-outs
src/shell/Workspace.tsx                  'use client' DockviewReact host: onReady, restore, presets, save, editor re-add
src/shell/WorkspaceProvider.tsx          page state (selected/open files/lit/tour/…) as context + shell actions
src/shell/panels.ts                      panel registry (ids, components, titles, pinned, availability, shortcut)
src/shell/panels/MapPanel.tsx            wraps MapView; key by location; visibility + popout-size hooks
src/shell/panels/CodeHomePanel.tsx       pinned placeholder that anchors the code group
src/shell/panels/CodePanel.tsx           one editor per file (id code:<path>) + its own selbar; setRoot on move
src/shell/panels/GuidePanel.tsx          wraps Guide
src/shell/panels/DetailsPanel.tsx        wraps Inspector
src/shell/panels/FilesPanel.tsx          wraps FileTree
src/shell/panels/SettingsPanel.tsx       motion toggle + shortcut list now; provider/model picker when PROVIDERS.md lands
src/shell/panels/CodeRoomPanel.tsx       stub ("coming soon"), registry available:false
src/shell/LanternTab.tsx                 DockviewDefaultTab with hideClose for pinned panels
src/shell/GroupActions.tsx               rightHeaderActionsComponent: float / window / dock / maximise
src/shell/LayoutMenu.tsx                 top-bar "Layout ▾": presets, reset, show/hide panels, shortcut footer
src/shell/Watermark.tsx                  empty-group message
src/shell/Toast.tsx                      one-line transient message (pop-up blocked, etc.)
src/shell/layout.ts                      PURE: presets (builders), SavedLayout, sanitise, LayoutStorage + local adapter
src/shell/keys.ts                        keyboard shortcut table + binder, bound per window document
src/shell/theme.ts                       lanternTheme (DockviewTheme) + capabilities
src/shell/popout.ts                      preparePopout(win): fonts, colour scheme, title, keys, (later) light slot
src/app/map/page.tsx                     header stays; body becomes <WorkspaceProvider><Workspace/></WorkspaceProvider>
src/app/globals.css                      dockview.css import + .walkmycode variables + local shell tokens; remove .work/.tabs
src/components/MapView.tsx               own-realm ResizeObserver; refit(); onMove hook; null key codes
src/components/CodeView.tsx              onReady(view) prop
src/lib/light.ts                         (task 8, after MOTION.md task 10) per-window light slots
tests/layout.test.ts                     sanitise / version / presets / enterprise-option guard, tsx --test
```

`src/lib/store.ts` is unchanged (repo store). Layout persistence lives in `src/shell/layout.ts`.

---

## 2. Exact imports and CSS

```ts
// src/shell/Workspace.tsx
'use client';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewHeaderActionsProps,
  type SerializedDockview,
  type AddPanelOptions,
} from 'dockview-react';
import { lanternTheme, capabilities } from './theme';
import { PANELS, components } from './panels';
import { buildPreset, sanitise, localLayoutStorage, type SavedLayout, type PresetName } from './layout';
```

```css
/* src/app/globals.css — first line, before :root.
   dockview.css must be in document.styleSheets at startup: pop-outs copy the
   main document's stylesheets ONCE, at open time (see §6). */
@import 'dockview-react/dist/styles/dockview.css';
```

`@xyflow/react/dist/style.css` stays imported at module level in `MapView.tsx`. A stylesheet added after a popout opened reaches it through `syncStyles` (§6), but keep CSS at module level where you can: it is there before the window opens.

Mounting from the page. `src/app/map/page.tsx` is already `'use client'`, so `ssr:false` is allowed (Next 16 rejects it in Server Components):
```tsx
const Workspace = dynamic(() => import('@/shell/Workspace'), {
  ssr: false,
  loading: () => <p className="note" style={{ padding: 20 }}>Loading…</p>,
});
```
Rendering stays gated by the existing `ready` flag (IndexedDB restore) so the map exists before the first panel mounts.

`public/popout.html` (no scripts; dockview validates it is same-origin):
```html
<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WalkMyCode</title></head><body></body></html>
```

---

## 3. Panel registry (`src/shell/panels.ts`)

```ts
export type PanelId = 'map' | 'code:home' | `code:${string}` | 'guide' | 'details' | 'files' | 'settings' | 'coderoom';

export interface PanelDef {
  key: string;                       // component key in DockviewReact `components`
  title: string;
  icon: string;                      // tab glyph, plain text
  pinned?: boolean;                  // no close button (map, code:home, guide)
  available: boolean;                // false = hidden from the Layout menu (coderoom until built)
  renderer: 'always' | 'onlyWhenVisible';
  shortcut: number;                  // Alt+<n> reveals it (§9)
}

export const PANELS: Record<string, PanelDef> = {
  map:         { key: 'map',      title: 'Map',       icon: '▦',  pinned: true, available: true,  renderer: 'always',          shortcut: 1 },
  'code:home': { key: 'codeHome', title: 'Code',      icon: '‹›', pinned: true, available: true,  renderer: 'always',          shortcut: 2 },
  guide:       { key: 'guide',    title: 'Guide',     icon: '▭',  pinned: true, available: true,  renderer: 'always',          shortcut: 3 },
  details:     { key: 'details',  title: 'Details',   icon: 'ⓘ',                available: true,  renderer: 'always',          shortcut: 4 },
  files:       { key: 'files',    title: 'Files',     icon: '▤',                available: true,  renderer: 'always',          shortcut: 5 },
  settings:    { key: 'settings', title: 'Settings',  icon: '⚙',                available: true,  renderer: 'onlyWhenVisible', shortcut: 6 },
  coderoom:    { key: 'coderoom', title: 'Code room', icon: '▶',                available: false, renderer: 'onlyWhenVisible', shortcut: 7 },
};

/** Dynamic editors: id `code:<path>`, component 'code', params { path }. Not in PANELS. */
export const CODE_COMPONENT = 'code';
export const isEditorId = (id: string) => id.startsWith('code:') && id !== 'code:home';
export const editorPath = (id: string) => id.slice('code:'.length);

export const components = {
  map: MapPanel, codeHome: CodeHomePanel, code: CodePanel, guide: GuidePanel,
  details: DetailsPanel, files: FilesPanel, settings: SettingsPanel, coderoom: CodeRoomPanel,
};
```

- **Code is several panels, one per file.** `code:home` is a pinned placeholder ("Pick a card or a file to read its code.") anchoring the *code group* so it can never disappear. Editors are `code:<path>` panels added with `position: { referencePanel: <last editor or 'code:home'>, direction: 'within' }` so they tab together wherever the user has put the code group. Title = basename; `panel.api.setTitle(basename)`, tooltip = full path via the tab's `title` attribute (LanternTab reads `params.path`). Each CodePanel owns its selbar (Explain this / Trace it), so `selection` is per panel and the page-level `selection` state (page.tsx:29) goes away.
- `renderer: 'always'` for map, code, guide, details, files: the default `onlyWhenVisible` removes a hidden tab's DOM, which would lose React Flow's viewport and CodeMirror's scroll/selection on every tab switch. Settings/Code room use the default.
- `LanternTab` = `DockviewDefaultTab` with `hideClose={PANELS[id]?.pinned ?? false}`; renders `icon + title`.

---

## 4. State wiring (`src/shell/WorkspaceProvider.tsx`)

All state `map/page.tsx` holds today (lines 24-146) moves into a provider that wraps `<Workspace/>`; panels read it with `useWorkspace()`. Dockview renders every panel through `ReactDOM.createPortal` into a `div.dv-react-part` it owns and moves that element between groups, floating boxes and popout documents (dockview-react `main.esm.mjs:155`); React attaches listeners to the portal container, so the React tree, this context, and event handling are the same wherever a panel goes, including another window.

```ts
export interface OpenFile { path: string; highlight: [number, number] | null }

interface WorkspaceState {
  repo: Repo; map: CodeMap; repoView: RepoView;
  selected: string | null; focus: string | null; showImports: boolean;
  lit: Lit | null; tour: Tour | null; step: number; job: Job | null;
  files: OpenFile[];            // SOURCE OF TRUTH for open editors (not dockview)
  activePath: string | null;    // the editor the user last touched
}

interface WorkspaceActions {
  selectNode(id: string | null): void;                      // as today + shell.reveal('details')
  openAt(path: string, start?: number, end?: number): void;  // add-or-reveal code:<path>, set highlight
  closeFile(path: string): void;                            // removes from files[] AND removes the panel if present
  setActivePath(path: string | null): void;
  onEdge(e: MapEdge): void; setFocus; toggleImports; setLit; setTour; setStep; setJob;
  explainSelection(path: string, sel: Selection): void; explainNode; traceNode; tourNode; askFree;
  shell: {
    api: React.RefObject<DockviewApi | null>;
    reveal(id: PanelId): void;          // replaces setTab(): re-add if closed, then panel.api.setActive(); never focuses a pop-out window
    float(target: 'active' | string): void;
    popout(target: 'active' | string): Promise<boolean>;
    dock(target: 'active' | string): void;
    maximise(target: 'active' | string): void;
    preset(name: PresetName): void; reset(): void; toggle(id: PanelId): void;
    restoring: React.RefObject<boolean>;   // true while buildPreset / fromJSON run (see §5.2)
  };
}
```

Call-site mapping: every `setTab('guide'|'details')` (page.tsx:57, 66, 100, 106, 124, 143) → `shell.reveal(...)`; `setOpen(...)` (43, 51, 65) → `openAt(...)`; the tour effect (47-58) stays verbatim in the provider; the `content`/`highlight` memos (148-149) move into `CodePanel`, keyed by `params.path`.

**Editors ↔ dockview, both directions, with `files[]` as the truth:**

- `openAt(path, s, e)`: if `files` lacks `path`, append `{path, highlight}`; else update `highlight` only. Then `ensureEditorPanel(path)`: `api.getPanel('code:'+path)` exists → `setActive()`; else `api.addPanel({ id: 'code:'+path, component: 'code', title: basename(path), params: { path }, renderer: 'always', position: { referencePanel: lastEditorId() ?? 'code:home', direction: 'within' } })`. Set `activePath = path`. The CodePanel's existing highlight effect (CodeView.tsx:131-140) does the scroll.
- `api.onDidRemovePanel(p => { if (shell.restoring.current) return; if (isEditorId(p.id)) closeFileState(editorPath(p.id)) })` — the guard is what stops `api.clear()` / `fromJSON()` (both fire `onDidRemovePanel` for every panel; `fromJSON` calls `this.clear()`, `main.esm.mjs:16953ff`) from wiping `files[]`.
- `closeFile(path)` (from the Files tree or a shortcut): remove from `files[]`, then `api.getPanel('code:'+path)?.api.close()` (which re-enters `onDidRemovePanel`; idempotent because the path is already gone).
- `reAddEditors(api)` (called by Workspace after every preset build and restore, §5): for each `files[]` entry in order, `ensureEditorPanel(path)`; finally `activePath` last so it is the active tab.
- `reveal(id)`: `api.getPanel(id) ?? api.addPanel({...PANELS[id], position: sensibleHome(id)})`, then `panel.api.setActive()`. If `panel.api.location.type === 'popout'`, do **not** call `panel.api.getWindow().focus()` (it would yank focus); the beacon/light carries attention (§8). `sensibleHome`: details/files → `within` the guide group if it exists; settings/coderoom → `within` the guide group; otherwise `right` of the first grid group.

---

## 5. Default layout, presets, persistence (`src/shell/layout.ts`, `Workspace.tsx`)

### 5.1 Presets are builder functions

```ts
export type PresetName = 'explore' | 'read' | 'tour' | 'stack';
export const pickDefault = (w: number): PresetName => (w < 900 ? 'stack' : 'explore');

export function buildPreset(api: DockviewApi, name: PresetName, width: number) {
  api.clear();     // caller sets shell.restoring = true around this call (§5.2)
  const add = (id: string, o: Partial<AddPanelOptions> = {}) =>
    api.addPanel({ id, component: PANELS[id].key, title: PANELS[id].title, renderer: PANELS[id].renderer, ...o } as AddPanelOptions);
  switch (name) {
    case 'explore':   // today's arrangement: Map | Code | Guide,Details,Files
      add('map');
      add('code:home', { position: { referencePanel: 'map', direction: 'right' }, initialWidth: Math.round(width * 0.34) });
      add('guide',     { position: { referencePanel: 'code:home', direction: 'right' }, initialWidth: 400 });
      add('details',   { position: { referencePanel: 'guide', direction: 'within' }, inactive: true });
      add('files',     { position: { referencePanel: 'guide', direction: 'within' }, inactive: true });
      break;
    case 'read':      // Files | Code (wide) | Guide over Map
      add('code:home');
      add('files',     { position: { referencePanel: 'code:home', direction: 'left' }, initialWidth: 260 });
      add('guide',     { position: { referencePanel: 'code:home', direction: 'right' }, initialWidth: 380 });
      add('map',       { position: { referencePanel: 'guide', direction: 'below' }, initialHeight: 260 });
      add('details',   { position: { referencePanel: 'guide', direction: 'within' }, inactive: true });
      break;
    case 'tour':      // Guide (wide chalkboard) | Map over Code
      add('guide');
      add('map',       { position: { referencePanel: 'guide', direction: 'right' }, initialWidth: Math.round(width * 0.55) });
      add('code:home', { position: { referencePanel: 'map', direction: 'below' } });
      add('details',   { position: { referencePanel: 'guide', direction: 'within' }, inactive: true });
      add('files',     { position: { referencePanel: 'guide', direction: 'within' }, inactive: true });
      break;
    case 'stack':     // narrow frames (< 900 px, Lite): everything tabbed in one group
      add('map');
      for (const id of ['code:home', 'guide', 'details', 'files'])
        add(id, { position: { referencePanel: 'map', direction: 'within' }, inactive: true });
      api.getPanel('map')!.api.setActive();
  }
}
```
`initialWidth/initialHeight` are `AddPanelOptions` fields in 8.3.1 (verified). Editors are **not** built here; `Workspace` calls `reAddEditors(api)` right after (§4), so choosing Read/Tour/Reset keeps every open file.

### 5.2 Saved shape and rules

```ts
export interface SavedLayout { v: 1; preset: PresetName | 'custom'; layout: SerializedDockview; savedAt: number }
export interface LayoutStorage {
  load(): Promise<SavedLayout | null>;
  save(l: SavedLayout): Promise<void>;
  clear(): Promise<void>;
}
export const localLayoutStorage: LayoutStorage;   // localStorage['walkmycode.layout'], try/catch on every access
export function sanitise(layout: SerializedDockview, opts: { popoutAllowed: boolean }): SerializedDockview;
```

**`sanitise` (pure, tested)** walks the whole serialized tree:
1. `layout.panels`: delete every key where `isEditorId(key)` or where `panels[key].contentComponent` is not one of `Object.values(PANELS).map(p => p.key)` (renamed/unknown components). Files are per repo, layouts are per user, so editors are never restored.
2. `layout.grid.root` recursively: a branch is `{ type: 'branch', data: Node[] , size }`, a leaf is `{ type: 'leaf', data: { views: string[], activeView: string, id: string }, size }` (`gridview.d.ts:56-61`). Filter each leaf's `views` to surviving panel ids; if `activeView` was removed set it to `views[0]`; drop leaves with no views; drop branches whose `data` becomes empty; collapse a branch with one child into that child (keeping the parent's `size`).
3. `floatingGroups[]` and `popoutGroups[]` (`SerializedFloatingGroup` / `SerializedPopoutGroup`, `dockviewComponent.d.ts:70-95`): each has either the legacy single-group form `data: { views, activeView, id }` **or** a nested gridview `data: { grid, ... }`; handle both with the same leaf/branch filter. Remove an entry whose group ends up empty.
4. When `!opts.popoutAllowed`, convert each `popoutGroups[i]` into a `floatingGroups` entry with the same `position` box (clamped to `{ x ≥ 0, y ≥ 0, width ≤ innerWidth, height ≤ innerHeight }` by the caller, since sanitise is pure).
5. If `layout.activeGroup` no longer exists, delete it.
6. If after all this the grid has no leaves, return `null`-equivalent by throwing `EmptyLayout` — the caller rebuilds the default preset.

**Save:** `api.onDidLayoutChange` (fires on every sash move, activation and structural change) → ignored while `restoring` → debounce 500 ms → `storage.save({ v: 1, preset, layout: api.toJSON(), savedAt: Date.now() })`. `preset` flips to `'custom'` on the first structural change after a preset was applied: compute `fingerprint = JSON.stringify({ grid: json.grid, f: json.floatingGroups?.map(g => g.position), p: json.popoutGroups?.map(g => g.position) })` and compare with the one captured after the preset was built; activation-only changes leave the fingerprint equal and do not flip it. (The preset label is informational — it drives the radio in the Layout menu — so an occasional over-eager flip is harmless.)

**Reset:** Layout ▾ → "Reset layout" (`await storage.clear(); applyPreset('explore')`), also `Ctrl+Shift+0`.

### 5.3 `onReady` — restore, cancellation-safe under StrictMode

`DockviewReact` creates and disposes the component in an effect (`dockview-react/main.esm.mjs:514-536`), so under StrictMode `onReady` fires twice with **two different `DockviewApi` instances**, and the first is disposed while our `await storage.load()` is pending; calling `fromJSON`/`addPanel` on it throws `'resource is already disposed'` (`main.esm.mjs:130`). Pattern:

```ts
const apiRef = shell.api;                       // React.RefObject<DockviewApi | null>
const subs = useRef<{ dispose(): void }[]>([]);

async function onReady({ api }: DockviewReadyEvent) {
  apiRef.current = api;
  const mine = api;
  const alive = () => apiRef.current === mine;

  // subscriptions belong to THIS instance; disposed in the cleanup below
  subs.current.forEach(d => d.dispose()); subs.current = [];
  subs.current.push(
    api.onDidLayoutChange(() => { if (!shell.restoring.current) scheduleSave() }),
    api.onDidRemovePanel(p => { if (!shell.restoring.current && isEditorId(p.id)) closeFileState(editorPath(p.id)) }),
    api.onDidOpenPopoutWindowFail(() => floatAllPopouts(api, 'Pop-ups are blocked here — floated instead.')),
    api.onDidPopoutGroupSizeChange(() => window.dispatchEvent(new Event('resize'))),
  );

  shell.restoring.current = true;
  try {
    const saved = await storage.load();
    if (!alive()) return;
    let restored = false;
    if (saved?.v === 1) {
      try {
        api.fromJSON(sanitise(saved.layout, { popoutAllowed: capabilities.popout }));
        await api.popoutRestorationPromise;
        if (!alive()) return;
        restored = api.totalPanels > 0;
        presetRef.current = saved.preset;
      } catch { if (alive()) api.clear(); }
    }
    if (!restored) { buildPreset(api, pickDefault(window.innerWidth), window.innerWidth); presetRef.current = pickDefault(window.innerWidth); }
    reAddEditors(api);                                       // §4 — open files survive
    fingerprintRef.current = fingerprint(api.toJSON());
  } finally {
    if (alive()) shell.restoring.current = false;
  }
}

useEffect(() => () => {                                       // DockviewReact unmount (route change, StrictMode)
  clearTimeout(saveTimer.current);                            // the first StrictMode instance never saves
  subs.current.forEach(d => d.dispose()); subs.current = [];
  apiRef.current?.getPopouts().forEach(p => p.window?.close?.());   // belt-and-braces; dockview's own dispose also closes them — task 6 verifies one is enough
  apiRef.current = null;
}, []);
```
`applyPreset(name)` (Layout menu) uses the same `restoring` bracket: `restoring = true; buildPreset(...); reAddEditors(api); fingerprint; restoring = false; scheduleSave()`.

Popouts restore only if the browser allows `window.open` without a gesture (it usually does not) → `onDidOpenPopoutWindowFail` → `floatAllPopouts`: for each `api.getPopouts()` whose window is null, `api.addFloatingGroup(group, savedBox)` guarded by `api.getGroup(group.id)` still existing, then toast.

### 5.4 Per-account storage (later, requirement 3)

`LayoutStorage` is the `storage` adapter seam from PLAN.md (`src/adapters/storage`): hosted → `PUT/GET /api/layout` backed by a D1 table `layouts(account_id TEXT, name TEXT, json TEXT, v INTEGER, updated_at INTEGER, PRIMARY KEY(account_id, name))` keyed by the iReliabee-style `accounts.id` from the `web_sessions` cookie; BYOK → IndexedDB `kv['layout']` in `store.ts`; Lite → `claude.use('db')` at `data/users/<id>/layout.json`. Only `Workspace.tsx`'s one `storage` import changes. Save is last-write-wins; the local copy is kept as a cache so first paint never waits on the network (load local → paint → load remote → if `savedAt` newer, apply with the same `restoring` bracket).

---

## 6. Float, pop out, dock back (`GroupActions.tsx`, `Workspace.tsx`, `popout.ts`)

```tsx
<DockviewReact
  theme={lanternTheme}
  components={components}
  defaultTabComponent={LanternTab}
  rightHeaderActionsComponent={GroupActions}
  watermarkComponent={Watermark}
  onReady={onReady}
  popoutUrl="/popout.html"
  floatingGroupBounds="boundedWithinViewport"   // a floating panel can never be lost off-screen
  floatingGroupDragHandle="titlebar"
  defaultRenderer="onlyWhenVisible"             // per-panel overrides in the registry
  dndEdges={{ size: { value: 80, type: 'pixels' } }}
/>
```
(No `keyboardNavigation` — §0.1.)

`GroupActions` receives `IDockviewHeaderActionsProps` = `{ api: groupApi, containerApi, group, activePanel, panels, isGroupActive, location }` (`framework.d.ts:25-34`). Use the **`location` prop** in render, never `group.api.location`. Buttons are 28 px targets with `aria-label` and `title`, using the existing `:focus-visible` yellow ring:

- **Float** ⧉ (`Ctrl+Shift+F`), shown when `location.type === 'grid'`: `containerApi.addFloatingGroup(group, { width: group.width, height: group.height, x: 40, y: 40 })`. Users can also shift-drag a tab to float it.
- **Window** ↗ (`Ctrl+Shift+O`), shown when `capabilities.popout && (location.type === 'grid' || location.type === 'floating')`:
  ```ts
  const box = { width: group.width, height: group.height };
  const ok = await containerApi.addPopoutGroup(group, {
    popoutUrl: '/popout.html',
    position: { left: window.screenX + 60, top: window.screenY + 60, ...box },
  });                                                               // no onDidOpen: see preparePopout below
  if (!ok && containerApi.getGroup(group.id)) {                     // a failed addPopoutGroup may already have moved the group
    containerApi.addFloatingGroup(group, { x: 40, y: 40, ...box });
    toast('This browser blocked the window — floated instead.');
  }
  ```
  The click is a user gesture, so the popup blocker normally allows it. `addPopoutGroup` resolves `false` (never throws) on a blocked or immediately closed window (`main.esm.mjs:14364-14375`) and also fires `onDidOpenPopoutWindowFail` (`:16292`); the `onReady` subscription handles the restore case, this handler the interactive one — guard both with `getGroup(group.id)` so a group is never floated twice.
- **Dock** ⧈ (`Ctrl+Shift+D`), shown when `location.type !== 'grid'`: `group.api.moveTo({ group: firstGridGroup, position: 'right' })` where `firstGridGroup = containerApi.groups.find(g => g.api.location.type === 'grid')`; if none exists (everything floated), `moveTo({ position: 'right' })` with no target (dockview creates a root grid group). Users can also drag the floating titlebar back over the grid.
- **Maximise** ⛶ (`Ctrl+Shift+M`), shown when `location.type === 'grid'` (floating and popout groups cannot maximise): toggles `containerApi.maximizeGroup(group)` / `containerApi.exitMaximizedGroup()`.
- On mount and on `group.api.onDidLocationChange`, set `group.element.dataset.location = group.api.location.type` so CSS (beacons, rise) can target `[data-location="floating"|"popout"]`.

**`preparePopout(win, title)`** (`src/shell/popout.ts`):
```ts
export function preparePopout(win: Window, title: string) {
  const root = document.querySelector('.root');
  const fontClasses = [...(root?.classList ?? [])].filter(c => c.startsWith('__variable'));  // next/font only
  win.document.body.classList.add(...fontClasses);           // NOT the whole .root class (it sets height:100vh; display:flex; font)
  win.document.documentElement.style.colorScheme = 'dark';   // scrollbars match
  win.document.body.style.margin = '0';
  win.document.body.style.background = 'var(--wall)';
  win.document.title = 'WalkMyCode — ' + title;
  bindKeys(win.document, shell);                             // §9
  light?.mount(win, ...);                                    // §8, task 8
}
```
Why the font classes: the `__variable_…` classes that define `--font-sans/--font-mono/--font-hand/--font-title` live on `div.root` (`layout.tsx:21`), and the popped-out panel is appended to `<body>` of the new document.

**When it runs:** from `api.onDidAddPopoutGroup` (Workspace), never from `addPopoutGroup`'s `onDidOpen`. dockview calls `onDidOpen` straight after `window.open`, while the window still holds its first, blank document; loading `/popout.html` then replaces that document, so everything set there (font classes, keys, the light) was lost and the pop-out fell back to Times New Roman and dockview's abyss blues. `onDidAddPopoutGroup` fires after the load, for user pop-outs and restored ones alike. It also adds the theme's own class (`lantern`) to the pop-out's `#dv-popout-window` container: dockview copies only the `dockview-theme-*` class there, so without it no `.lantern` rule (dock colours, tab font) applies.

**Stylesheets in the popout — as 8.3.1 actually behaves:** dockview copies `document.styleSheets` once, on the pop-out's load (`addStyles`, `main.esm.mjs:422-450`): `<link>` sheets are re-linked by `href`, inline rules are copied by `cssText`. That covers `globals.css` (with `dockview.css` imported), React Flow's CSS and next/font's `@font-face`. It misses a `<link>` still loading at that moment, a lazy chunk's CSS added later (the editor's `ide.css` arrives with `Ide`, which is `dynamic`) and dev-server hot updates, so `preparePopout` also runs `syncStyles` (`src/shell/popoutStyles.ts`): a MutationObserver on the main `<head>` mirrors every `<link rel=stylesheet>`/`<style>` added, swapped, rewritten or removed, with each URL (hrefs, `url()`, `@import`) made absolute against the main window. CodeMirror's runtime StyleModules are handled by `EditorView.setRoot` (§7).

**Route change:** Next client navigation does not fire `beforeunload`; `Workspace`'s unmount cleanup (§5.3) closes popout windows.

---

## 7. React Flow and CodeMirror inside floating and popout panels

Floating groups are ordinary DOM in the main document (absolutely positioned `.dv-resize-container`); only resize handling applies to them. Pop-outs move the panel's `div.dv-react-part` into another document.

### React Flow (`@xyflow/react` 12.12.0) — `MapPanel.tsx` + `MapView.tsx`
1. `useResizeHandler` binds `window.resize` on the **main** window and creates its `ResizeObserver` in the main realm (`dist/esm/index.mjs ~1282-1284`); a popout resize never reaches it. Fixes: (a) `MapPanel` remounts the flow with `key={locationType}` (from `props.api.onDidLocationChange`) and calls `refit()` 30 ms after; (b) `Workspace` subscribes `onDidPopoutGroupSizeChange → window.dispatchEvent(new Event('resize'))` so `updateDimensions` re-reads `getBoundingClientRect()` (works cross-document); (c) `MapView` replaces its own `window.resize` listener (MapView.tsx:146-154) with a `ResizeObserver` created in the host element's realm — `new (host.ownerDocument.defaultView as typeof globalThis).ResizeObserver(() => refit())`, re-created on location change. This also fixes the pre-existing bug that dragging a divider never refit the map.
2. **Hidden `always` panels go stale:** `updateDimensions` early-returns when `domNode.checkVisibility()` is false (`index.mjs:1271-1273`) and dockview hides inactive `always` tabs with `visibility:hidden`, so a map group resized while its tab is hidden keeps the old store width/height on re-show and the ResizeObserver will not re-fire. `MapPanel` subscribes `props.api.onDidVisibilityChange(e => { if (e.isVisible) { window.dispatchEvent(new Event('resize')); refit(0) } })`.
3. `useKeyPress` listens on the main `document`, so Delete/selection shortcuts would not work in a popout. WalkMyCode's map is read-only: pass `deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}` to make that explicit.
4. Pan/zoom/drag are d3 listeners on the element itself and travel with it — nothing to do.
5. `.maptools` and `.legend` are `position:absolute` inside `.fill` (globals.css:139, 141) and travel with the panel; change `.maptools { top: 10px }` because the 46 px `.panel > header` no longer exists.
6. `<ReactFlow onMove={onMove}>` where `MapPanel` passes `() => light?.hide()` (no-op until task 8).

`refit(duration = 300)` = `fitView({ padding: 0.15, duration })`.

### CodeMirror 6 (`@codemirror/view` 6.43.13) — `CodePanel.tsx` + `CodeView.tsx`
1. CodeMirror injects styles at runtime (style-mod) into the *current* root, so an editor moved to a popout renders unstyled. `CodeView` gains `onReady?(view: EditorView)`; `CodePanel` calls `view.setRoot(host.ownerDocument)` on mount and inside `props.api.onDidLocationChange`. `setRoot` (`index.d.ts:1116`, documented for "moving the editor's existing DOM to a new window") re-mounts the StyleModules and rebinds resize/scroll/selectionchange listeners to the new `defaultView`; style-mod mounts once per root, so repeated calls are idempotent.
2. `CodeView` rebuilds the editor on `[path, content]` (CodeView.tsx:91-129). Dockview never remounts the React tree on move, so the editor instance, scroll and selection survive float/dock/pop-out — provided `CodePanel` does **not** key `CodeView` by location (unlike the map).
3. `.cm-lit-line` moves from `EditorView.theme` into globals.css (MOTION.md §4.4) — it then lives in a copied stylesheet and is present in popouts.
4. `EditorView.coordsAtPos` returns coordinates in the editor's own window's viewport — exactly what that window's light needs (§8).

**Guide, Details, Files**: plain DOM + React; nothing document-bound. Guide's `boardRef.scrollTo` and `abort` work in any window.

CSP: no style-src policy today; if one is added, pass `nonce` to DockviewReact and `EditorView.cspNonce`.

---

## 8. The light across docked, floating and popped-out panels (task 8; needs MOTION.md tasks 1, 8, 10)

MOTION.md §5's single travelling dot is a `position:fixed` element driven by `getBoundingClientRect()` of its target. Shell rules:

- **Docked and floating panels — nothing changes.** Both are in the main document; the target rect already includes React Flow's transform, CodeMirror's scroll, dockview's offsets and a floating box's position. The dot's `z-index: 1000` stays above dockview's overlays via `--dv-overlay-z-index: 900` (§10). During drags the targets move: `api.onWillDragGroup`/`onWillDragPanel` → `light.hide()`; `onDidDrop`/`onDidMovePanel` → `light.park()`. Beacons are pseudo-elements on the surfaces, so nothing stale is ever visible.
- **Pop-out — one light per window.** `light.ts` gains window slots: `light.mount(win, el)` (called by `LanternLight` on mount; main window at app start, each popout through a portal created in `preparePopout`) and `light.dropWindow(win)`. `light.to(t)` resolves `win = (t.el?.ownerDocument ?? document).defaultView ?? t.win`. If `win === current`, fly as today. Otherwise (cross-window hop): the current window's dot does the 120 ms `handoff` fade, then the destination window's dot **starts from that panel's tab beacon** (`[data-location="popout"] > .dv-tabs-and-actions-container::before`) and springs to the target inside its own viewport. Explicit `x/y` targets must carry `win` (`light.to({ x, y, win: view.dom.ownerDocument.defaultView })`), which `CodePanel` does. No `screenX/screenY` maths is ever attempted — the two viewports are independent, so the hop is a fade-out/fade-in pair. Reduced motion: jumps and fades only.
- **Beacon targets**: MOTION.md §5's list with `.panel.float header::before` replaced by `.walkmycode [data-location="floating"] > .dv-tabs-and-actions-container::before` and the `popout` variant.
- `light.park()` finds `[data-light="home"]` in the **main** document (the brand in the top bar), so parking always returns to the main window.
- Until task 8 lands, every `light?.` call site in the shell is a guarded no-op (`const light = (globalThis as any).__lanternLight`), replaced by the real import in task 8.

---

## 9. Keyboard access (`src/shell/keys.ts`)

`keyboardNavigation` is enterprise-only, so the shell owns its shortcuts. One table, bound once per window document (main on mount, each popout in `preparePopout`), with `preventDefault` on match; ignored when focus is in `input`, `textarea`, `[contenteditable=true]` or `.cm-content` — except `Escape`, which is always honoured. Browser-reserved chords are avoided on purpose: Chrome/Firefox-on-Windows reserve `Ctrl+1…9` for tabs, Firefox reserves `Ctrl+Shift+P` (private window); the reveal chords therefore use `Alt` and pop-out uses `O`. (Firefox on Linux uses `Alt+1…8` for tabs — documented limitation; the Layout menu is the mouse path.)

| Chord | Action |
|---|---|
| `Alt+1…7` | reveal Map / Code / Guide / Details / Files / Settings / Code room (registry `shortcut`) |
| `Ctrl+]` / `Ctrl+[` | next / previous tab in the active group: `group.panels[(i ± 1) mod n].api.setActive()` |
| `Ctrl+Shift+]` / `Ctrl+Shift+[` | next / previous group (grid groups first, then floating, then popouts): `group.api.setActive()` |
| `Ctrl+Shift+F` | float the active group |
| `Ctrl+Shift+O` | pop the active group out (hidden when `!capabilities.popout`) |
| `Ctrl+Shift+D` | dock the active group back |
| `Escape` | dock the active group if it is floating (MOTION.md's "Escape docks"); otherwise falls through |
| `Ctrl+Shift+M` | maximise / restore the active grid group |
| `Alt+Shift+← → ↑ ↓` | resize the active group by 40 px: `group.api.setSize({ width: group.width ± 40 })` / `{ height }` — sashes are pointer-only, so this is the keyboard path to width resizing |
| `Ctrl+Shift+L` | open Layout ▾ |
| `Ctrl+Shift+0` | reset layout |
| `Ctrl+W` is **not** bound (browser-reserved); close a closable panel with the tab's × or its context menu |

Tabs: dockview's tab elements are focusable DOM buttons (`.dv-tab[tabindex]`); task 5 verifies in the browser that `Tab` reaches them and `Enter`/`Space` activates; if a tab is not natively focusable in 8.3.1, `LanternTab` adds `tabIndex={0}` and an `onKeyDown` Enter/Space handler. Tab context menu: if `getTabContextMenuItems` is present and **not** listed in the enterprise arrays (checked by the task 1 grep), use it for Close / Float / Window / Dock / Maximise; otherwise `LanternTab` renders its own `onContextMenu` menu. The header action buttons remain the primary path.

`Layout ▾` is a real `<button aria-haspopup="menu" aria-expanded>` + `<div role="menu">` with `role="menuitemradio" aria-checked` for presets (Explore / Read / Tour / Stack), `role="menuitemcheckbox"` for show/hide of `available` panels, `menuitem` for Reset, arrow-key navigation, Escape closes. Shortcuts are listed in the Settings panel and in the menu's footer.

---

## 10. Lecture Hall theme on the dock chrome (`src/shell/theme.ts`, globals.css)

```ts
// src/shell/theme.ts
import type { DockviewTheme } from 'dockview-react';
export const lanternTheme: DockviewTheme = {
  name: 'lantern', className: 'dockview-theme-abyss lantern', colorScheme: 'dark',
  gap: 8, dndOverlayMounting: 'absolute', dndPanelOverlay: 'group',
};
export const capabilities = {
  popout: process.env.NEXT_PUBLIC_WALKMYCODE_TARGET !== 'lite' && typeof window !== 'undefined' && typeof window.open === 'function',
};
```
`gap: 8` reproduces the old gutters between rounded panels. CSS (globals.css) — delete `.work`, `.work > *`, `.tabs`, `.tabs button`, `.tabs button.on`, `.panel > header` uses on the workspace, and the `@media (max-width:1200px)` rule; add:

```css
/* shell motion tokens — local until MOTION.md task 1 lands, then: --sh-t-move: var(--t-move) etc. */
:root { --sh-t-move: 200ms; --sh-t-tap: 120ms; --sh-ease-out: cubic-bezier(.2,.7,.2,1); --sh-ease-settle: cubic-bezier(.3,1.4,.4,1); }
@media (prefers-reduced-motion: reduce) { :root:not([data-motion="on"]) { --sh-t-move: 0ms; --sh-t-tap: 0ms; } }
:root[data-motion="off"] { --sh-t-move: 0ms; --sh-t-tap: 0ms; }

.shell { flex: 1; min-height: 0; padding: 10px; }
.walkmycode {
  --dv-group-view-background-color: var(--ui);
  --dv-tabs-and-actions-container-background-color: var(--ui);
  --dv-tabs-and-actions-container-height: 34px;
  --dv-tabs-and-actions-container-font-size: 13px; --dv-tab-font-size: 13px;
  --dv-activegroup-visiblepanel-tab-background-color: var(--ui-2);   --dv-activegroup-visiblepanel-tab-color: var(--yellow);
  --dv-activegroup-hiddenpanel-tab-background-color: var(--ui);      --dv-activegroup-hiddenpanel-tab-color: var(--ui-dim);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--ui-2); --dv-inactivegroup-visiblepanel-tab-color: var(--ui-text);
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--ui);    --dv-inactivegroup-hiddenpanel-tab-color: var(--ui-dim);
  --dv-tab-divider-color: var(--ui-line);
  --dv-separator-border: transparent;                 /* the gap is the divider */
  --dv-sash-color: transparent; --dv-active-sash-color: var(--yellow);
  --dv-active-sash-transition-duration: var(--sh-t-tap); --dv-active-sash-transition-delay: 0s;
  --dv-drag-over-background-color: rgba(243,215,122,.12); --dv-drag-over-border-color: var(--yellow);
  --dv-floating-box-shadow: 0 30px 60px rgba(0,0,0,.55); --dv-floating-border: 1px solid var(--ui-line);
  --dv-floating-group-border: 1px solid var(--ui-line);
  --dv-floating-titlebar-height: 22px; --dv-floating-titlebar-background-color: var(--wall-2); --dv-floating-titlebar-border-bottom: 1px solid var(--ui-line);
  --dv-border-radius: 12px; --dv-tab-border-radius: 8px 8px 0 0;
  --dv-overlay-z-index: 900;                          /* below the light (1000) */
  --dv-scrollbar-background-color: var(--ui-line);
  --dv-icon-hover-background-color: var(--ui-2);
  --dv-context-menu-background-color: var(--ui-2); --dv-context-menu-color: var(--ui-text);
  font-family: var(--sans);
}
.walkmycode .dv-groupview { border: 1px solid var(--ui-line); border-radius: 12px; overflow: hidden; }   /* = old .panel */
.walkmycode .dv-tab { font: 600 13px var(--sans); box-shadow: inset 0 0 0 transparent; transition: box-shadow var(--sh-t-tap) var(--sh-ease-out), color var(--sh-t-tap); }
.walkmycode .dv-tab.dv-active-tab { box-shadow: inset 0 -2px 0 var(--yellow); }                          /* = old .tabs .on ink */
.walkmycode [data-location="floating"] > .dv-tabs-and-actions-container::before,
.walkmycode [data-location="popout"]   > .dv-tabs-and-actions-container::before {
  content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--yellow);
  box-shadow: 0 0 0 4px rgba(243,215,122,.18); margin: 0 4px 0 8px; align-self: center; }              /* undocked beacon */
.walkmycode .dv-resize-container {                                                                      /* floating rise */
  transition: opacity var(--sh-t-move) var(--sh-ease-out), transform var(--sh-t-move) var(--sh-ease-settle);
  @starting-style { opacity: 0; transform: translateY(6px); } }
.walkmycode .dv-sash:hover, .walkmycode .dv-sash.dv-active { background: var(--yellow); }                   /* the 2 px yellow line */
.walkmycode .dv-resize-container.dv-active-sash * , .walkmycode.dv-dragging * { transition: none !important; } /* direct manipulation: 1:1 while resizing/dragging */
.hdr-act { width: 28px; height: 28px; border: 0; background: none; color: var(--ui-dim); border-radius: 6px; cursor: pointer; }
.hdr-act:hover { background: var(--ui-2); color: var(--ui-text); }
.maptools { top: 10px; }
```
Everything else in MOTION.md (cards, arrows, chalk, tour pill, cost meter, toggle, light) is untouched.

---

## 11. Lite (Claude artifact)

- Same `Workspace`. `capabilities.popout` is `false` under `NEXT_PUBLIC_WALKMYCODE_TARGET=lite` — a **policy choice**, not a verified sandbox fact: the artifact runtime contract (0.2.66) lists capabilities, not iframe `sandbox` flags. The safety net for any environment is the verified `addPopoutGroup → false → float + toast` path (§6) and `onDidOpenPopoutWindowFail`, so nothing crashes if a popout is ever attempted. In Lite the ↗ button and `Ctrl+Shift+O` are hidden, `sanitise({ popoutAllowed:false })` turns saved popout groups into floating groups, `popoutUrl` is still passed (harmless).
- Floating groups are pure DOM and work in the artifact iframe; `floatingGroupBounds="boundedWithinViewport"` keeps them inside the frame.
- The artifact frame is usually < 900 px → first run uses `stack`; `explore` above 900 px. Crossing 900 px switches between Stack and the wide layout. Narrow, everything stacks, because groups side by side would be a few words wide. An arrangement of the user's own is not lost: it is kept (in the saved layout's `wide`) and comes back when the window is wide again. A preset picked from Layout ▾ replaces it.
- Persistence: `LayoutStorage` = `claude.use('db')` at `data/users/<id>/layout.json` when the adapter lands; localStorage until then.
- Packaging: `dockview-react/dist/styles/dockview.css` is bundled by Next's CSS pipeline into `_next/static/css`, which `scripts-pack.mjs` already rewrites; `popout.html` may be excluded from the Lite file list.

---

## 12. Ordered task list (each verifiable alone in the browser)

Prerequisite for tasks 1–7, 9: none. Prerequisite for task 8: MOTION.md tasks 1 (tokens + bookend), 8 (motion + MotionRoot) and 10 (light store). Task 10 (docs) can be written at any time after 7.

1. **Install + skeleton** — `npm i dockview-react@8.3.1`; `public/popout.html`; `globals.css` `@import` + §10 CSS; `src/shell/theme.ts`; `src/shell/panels.ts` (five current panels + `code:home`); `src/shell/Workspace.tsx` rendering `explore` with stub panel bodies and the §5.3 `onReady` skeleton (no storage yet); `map/page.tsx` renders `<Workspace/>` via `next/dynamic({ ssr:false })` under the existing header; `tests/layout.test.ts` enterprise-option grep. *Verify:* three groups in Lecture Hall colours; sashes drag with the yellow line; tabs re-order; StrictMode double-mount creates no duplicate panels and no console error; `npm test` passes the grep.
2. **State to context** — `WorkspaceProvider.tsx`; move every `useState`/callback from `map/page.tsx:24-146`; `setTab` → `shell.reveal`; `MapPanel/GuidePanel/DetailsPanel/FilesPanel` read `useWorkspace()`. Delete `.work`, `.tabs`, the 1200 px rule. *Verify:* select a card → Details activates with the node; ask → Guide; tour steps light nodes and open code exactly as before.
3. **Code panels per file** — `CodeHomePanel.tsx`, `CodePanel.tsx` (`code:<path>`, own selbar, title/tooltip), `files[]` + `openAt` add-or-reveal, guarded `onDidRemovePanel` → `closeFile`, `reAddEditors`; `CodeView` gains `onReady(view)`. *Verify:* three citations to three files open three tabs in the code group; closing one removes it from `files[]`; re-citing an open file only scrolls/highlights; closing from the Files tree closes the tab.
4. **Map fits its container** — `MapView`: own-realm `ResizeObserver` replaces the window listener; `refit()`; null key codes; `.maptools` top; `MapPanel` `onDidVisibilityChange` hook. *Verify:* dragging the map's sash refits the graph; hide the Map tab, resize its group via a sash on a sibling, re-show → the graph fills the new size; tab away and back keeps the viewport.
5. **Float / dock / maximise + keyboard** — `GroupActions.tsx` (`location` prop), `LanternTab.tsx` (`hideClose`), `keys.ts` (main window), `data-location`, beacon CSS, floating rise, `Toast.tsx`. *Verify:* float Code → editor keeps scroll and selection, beacon shows on its tab bar, Escape docks it; Alt+Shift+arrows resize; Alt+1…5 reveal; Ctrl+]/[ cycle tabs; Ctrl+Shift+]/[ cycle groups; pinned tabs have no ×; Tab key reaches tab buttons; reduced-motion → rise collapses.
6. **Pop out** — `popout.ts` (`preparePopout`: font classes, colour scheme, title, keys), `CodePanel` `setRoot` on mount + location change, `MapPanel` `key={locationType}` + refit, `onDidPopoutGroupSizeChange → resize`, fallback-to-float on `false` with the `getGroup` guard, dispose on route change. *Verify in Chrome, Firefox, Safari:* pop out Code → chalk theme, JetBrains Mono, highlight bar all present; pop out Map → pan/zoom work, resizing the window refits; leave `/map` → the window closes (confirm whether dockview's dispose alone suffices; keep the belt-and-braces if not); block pop-ups → floats with the toast; ↗ hidden on an already popped-out group.
7. **Persistence, presets, reset** — `layout.ts` (`SavedLayout`, recursive `sanitise` for both floating/popout shapes, `buildPreset`, `localLayoutStorage`), debounced save with the `restoring` guard and the fingerprint `custom` flip, restore with `popoutRestorationPromise` + `onDidOpenPopoutWindowFail`, `LayoutMenu.tsx`, `Watermark.tsx`; `tests/layout.test.ts` for `sanitise` (drops `code:*`, drops unknown component keys, fixes `activeView`, collapses empty branches, converts popouts in both serialized forms, throws `EmptyLayout`) and version handling. *Verify:* rearrange, reload → same layout, open editors re-added from `files[]`; corrupt `localStorage['walkmycode.layout']` → clean default; switch Read/Tour with three files open → all three still open; Reset returns to Explore; the first StrictMode instance writes nothing (breakpoint in `save`).
8. **The light across the shell** *(after MOTION.md 1, 8, 10)* — `light.ts` window slots + `win` target + cross-window handoff; `LanternLight` portal per popout; drag/drop hide/park hooks; replace the guarded `light?.` stubs. *Verify:* cite a line while Code is floating → the dot lands on the line; while Code is popped out → main dot fades at the brand, the popout's dot rises from its tab beacon to the line; park always returns to the brand in the main window; never two dots in one window.
9. **Settings + Code room panels, Lite flags** — `SettingsPanel.tsx` (motion toggle if present, shortcut list), `CodeRoomPanel.tsx` stub (`available:false`), `capabilities.popout`, `stack` under 900 px, `LayoutStorage` adapter seam (`src/adapters/storage` when PLAN's adapter layer lands). *Verify:* `NEXT_PUBLIC_WALKMYCODE_TARGET=lite next build` hides the Window button and restores a saved popout as a floating group; an 800 px-wide window first-runs into Stack.
10. **Docs** — write `docs/SHELL.md` from this spec; in `docs/MOTION.md` mark §4.13/§4.14, §4.10's ink, and tasks 12/13 as superseded by SHELL.md (keep beacon and Escape rules; note task 9's ink part is dropped); in `docs/PLAN.md:66` change "Design in progress → `docs/SHELL.md`" to "Designed → `docs/SHELL.md`".

---

## 13. Touch points with the other two owner requirements

- **Monolith or microservices (requirement 1):** the shell is shape-agnostic. A multi-area repo renders inside the same `map` panel (service bands per MOTION.md §4.15 / `docs/SERVICES.md`); if a separate system view is wanted it is a one-line registry addition `system: { key:'system', title:'System', icon:'⬡', available: areas.length > 1, renderer:'always', shortcut: 8 }` plus a `SystemPanel` wrapping a second React Flow graph, with the same MapPanel hooks (§7). `available` may be a function of the loaded map so the Layout menu only offers it for multi-service repos.
- **Registration (requirement 3):** only `LayoutStorage` (§5.4) and the top-bar user pill (next to Layout ▾) are affected. Layouts are per account, editors per repo, so a signed-in user gets the same arrangement on every machine and every repo. `docs/ACCOUNTS.md` owns sign-in (iReliabee-style email code, `accounts`/`web_sessions`).

---

## 14. Verification checklist (running app)

Run at 1440 px and 800 px, Chrome + Firefox + Safari, with OS reduce-motion on and off.

Layout and resizing
- [ ] First run at ≥ 900 px = Explore (Map | Code | Guide/Details/Files); at < 900 px = Stack.
- [ ] Every sash drags; the map refits on release; CodeMirror wraps to the new width; no transitions fire while dragging.
- [ ] `Alt+Shift+←/→` changes the active group's width by 40 px; `↑/↓` its height when it has a vertical neighbour.
- [ ] Reload preserves the arrangement; corrupt storage falls back cleanly; Reset → Explore; `Ctrl+Shift+0` same.
- [ ] Read / Tour / Stack presets match §5.1; switching with editors open keeps them open, active one on top.

Docking and undocking
- [ ] Float via button, `Ctrl+Shift+F`, and shift-drag of a tab; the box rises 200 ms; beacon visible on its tab bar; stays inside the viewport when dragged to an edge.
- [ ] Escape docks a floating group; Dock button and `Ctrl+Shift+D` too; dragging the titlebar over the grid docks it.
- [ ] Maximise/restore on grid groups only; the button is absent on floating/popout groups.
- [ ] Pop out: fonts (Inter / JetBrains Mono), chalk theme, gutters, highlight bar, map pan/zoom and refit-on-resize all correct; window title "WalkMyCode — <panel>"; dark scrollbars.
- [ ] Pop-ups blocked → floats with the toast; group never duplicated; ↗ button absent on a popout group and in Lite.
- [ ] Leaving `/map` closes every popout window.

Panels and state
- [ ] Select card → Details; ask → Guide; tour → nodes light and code opens; Trace it from a CodePanel selbar works in a floating and a popped-out editor.
- [ ] Pinned tabs (Map, Code, Guide) have no ×; closing Details/Files then `Alt+4/5` re-adds them in the guide group.
- [ ] Hidden Map tab resized via a sibling sash, then re-shown → fills its group.

Keyboard and a11y
- [ ] Tab key reaches tab buttons and header actions; focus ring is the yellow `:focus-visible` ring; every action has an `aria-label`.
- [ ] `Ctrl+]/[` and `Ctrl+Shift+]/[` cycle tabs/groups; `Alt+1…7` reveal; Layout ▾ is a real menu (arrow keys, Escape, `menuitemradio` checked state).
- [ ] No shell chord hijacks a browser-reserved shortcut (spot-check `Ctrl+1`, `Ctrl+W`, `Ctrl+Shift+P` still do their browser thing).

Motion and the light
- [ ] Reduce-motion (OS or in-app toggle) collapses the floating rise, sash transition and tab ink to 0 ms.
- [ ] (After task 8) One dot per window, never two; floating panel: dot lands on the cited line; popout: main dot fades, popout dot rises from the beacon; park returns to the brand in the main window; pan the map mid-flight → dot hides.

Console
- [ ] No dockview enterprise warnings; no "resource is already disposed"; no React key warnings across float/dock/pop-out; `npm test` and `npm run typecheck` pass.

---

## Research notes

## WalkMyCode analyzer/UI
# WalkMyCode analyzer & map model — audit for monolith + microservice support

Scope read in full: src/analyzer/{types,parser,facts,build}.ts, src/analyzer/extract/{common,js,py}.ts, src/lib/store.ts, src/components/MapView.tsx, src/app/map/page.tsx, scripts/index.ts, docs/PLAN.md, plus src/lib/localFolder.ts, src/lib/claude/{tools,prompts,client}.ts, src/components/{Inspector,Guide,FileTree,CodeView}.tsx, src/app/page.tsx, src/app/api/{claude,demo}/route.ts, globals.css. Findings marked CONFIRMED were reproduced by running the real `buildMap`/extractors on a two-service fixture (web + services/users + services/orders, each with its own package.json) and by inspecting the indexed iReliabee map (.walkmycode/ireliabee.map.json).

## 1. How areas are detected (build.ts)
- `MANIFESTS` (build.ts:27) = package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, composer.json, Gemfile. `manifestDirs` = directory of every manifest not under `SKIP_DIRS` (build.ts:132-133).
- `areaOf(path)` = the *longest* manifest dir that prefixes the path (build.ts:134-138). Files under no manifest dir get `opts.name` when there is a root manifest (or none at all), else the literal `"root"` (build.ts:137). `map.areas` = sorted set of areas of *parsed* files only (build.ts:369-374, 616).
- Area is used for: `@/`/`~/` alias resolution to `${area}/src | ${area} | ${area}/app` (build.ts:236-244); Python absolute-import roots (build.ts:267-270); `frontendAreas` (any JSX file in the area, or a package.json mentioning react/vue/svelte/next/angular/solid — build.ts:369-381); `layerOfFile` heuristics (build.ts:390-405); display name strips the area prefix (build.ts:384-389); `node.area` (build.ts:413, 419, 429); the ambiguity note when hits span >1 area (build.ts:565, 572). Nothing in route matching, table naming or service naming is area-aware.
- What never reaches the analyzer: the folder readers keep only `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.py/.sql/.prisma` plus package.json/pyproject.toml/requirements.txt/Cargo.toml/go.mod (localFolder.ts:6, scripts/index.ts:13). So composer.json/Gemfile in MANIFESTS never arrive, and docker-compose.yml, Kubernetes/Helm YAML, wrangler.toml, Dockerfile, `.proto`, openapi.json/yaml, `.env.example` are never read; even if passed in, `langOf()` returns null and they are dropped before parsing (build.ts:152). CONFIRMED: the fixture's docker-compose.yml with `users-service`/`orders-service` had no effect.
- iReliabee (indexed): areas = backend, frontend, root, website; "root" holds 4 nodes of loose scripts. Areas are *package* boundaries, not service boundaries: a repo with one root package.json and `services/*` without per-service manifests collapses into one area; a nested `frontend/src-tauri/Cargo.toml` would split one app into two areas.

## 2. Cross-area HTTP calls → routes
Extraction (facts.ts:40-48 `HttpCallFact{url with * per interpolation, method?, fromVariable}`):
- JS (js.ts:344-349): `obj.get/post/put/patch/delete/del/request/fetch(url…)` where url starts with `/`, `http(s)://`, `ws(s)://` or `*`; bare helpers matching `HELPER_RE` (js.ts:8: fetch, *fetch*, api*, request*, http*, call*, hosted*, get/post/put/patch/del/delete, ky, got) at js.ts:352-361; `new WebSocket/EventSource` js.ts:363-370. URL text via `urlText` js.ts:20-44 (template substitutions → `*`, string concatenation handled).
- Python (py.ts:230-237): `requests|httpx|aiohttp|session|client|http|urllib3|_client|self.client` `.get/post/put/patch/delete/request/stream/head`, plus `urlopen/Request` (py.ts:245-248); `urlOf` py.ts:28-58 handles f-strings, concatenation, `.format`.
Matching (build.ts:523-582):
- `callSegments(url)` (build.ts:84-100): pulls `host` = anything after `scheme://` up to `/?#` (lowercased) — *any* host, including `users-service:8080` or `*`; splits the path on `/`, drops the query, any segment containing `*` → `*`.
- `routeSegments(path)` (build.ts:74-78): `{x}`, `[x]`, `:x`, `<x>`, `*x` → `*`.
- `leadingVar = h.fromVariable || !!host` (build.ts:540): every absolute URL is treated as "starts with a variable".
- `matchRoute(callSegs, routeSegs, leadingVar)` (build.ts:102-123): if leadingVar, try dropping 0..min(len,3) leading call segments (suffix alignment); lengths must then be equal; literal==literal +2, `*` on either side +1, mismatch fails; needs score>0; returns score−drop.
- Candidates = **all `routeNodes` in the whole map** (build.ts:543), filtered only by method (build.ts:544; `ANY` routes and method-less calls match everything). Best score wins, ties keep every hit (build.ts:547-551). Then: no hits → §3; `distinctPaths>1 || areasHit>1` → `likely` + note (build.ts:563-577); calls whose segments are all `*` are dropped silently (build.ts:578); one `calls-route` edge per hit (build.ts:579). Edge ids are `${kind}:${from}->${to}` (build.ts:438) so several call sites merge into one edge with appended evidence.
- CONFIRMED fan-out: `fetch("/health")` in web drew two dashed arrows, to users-service `GET /health` *and* orders-service `GET /health` ("More than one route matches this path"). Any shared path (`/health`, `/metrics`, `/api/v1/...`) fans out to every service. iReliabee only looks clean because it has 0 route paths shared across areas (281 cross-area calls-route edges; 143 marked likely for "couldn't tell the HTTP method").
- CONFIRMED misleading note: a literal internal host (`"http://users-service:8080/users/" + id`) matched users-service `GET /users/:id` but only as `likely` with the note "The URL starts with a variable" because `leadingVar` is also true for any host (build.ts:540, 568-571).
- CONFIRMED bug (js.ts:26-32): in `urlText` for template literals the first child is the opening backtick, which sets `first=false` before the substitution is seen, so `` `${process.env.USERS_SERVICE_URL}/users/${id}` `` yields `fromVariable:false`. Then no suffix alignment is tried, `["*","users","*"]` vs `["users","*"]` differ in length, and the call is reported "matched no route". Python f-strings (py.ts:12-26) and JS concatenation are correct. This is the canonical microservice call shape.
- No gateway/rewrite model: `/api/users/1` (client) vs users-service route `/users/:id` can never match without a leading variable (no drop → length mismatch). iReliabee's own client helper strips `/api` (frontend/src/lib/api.ts:75-80); nginx/ingress/Next `rewrites` are invisible.
- Container of a call (`containerAt`, build.ts:454-468): the route whose line span covers the call, else the file node. Express routes span only the `app.get(...)` statement (js.ts:302-309), and a route-only file whose handlers are non-exported named functions gets **no file node** (build.ts:412), so HTTP/SQL facts in `function createOrder(){…}` are dropped with `if (!from) continue` (build.ts:529, 587, 599). CONFIRMED: first fixture run produced zero edges out of the handlers; inline arrow handlers work. FastAPI is unaffected because py.ts:185 spans the whole decorated function — which is why iReliabee looks complete.

## 3. How unknown hosts become service nodes
- Known third parties: `HOST_SERVICES` (common.ts:45-80, `serviceForHost` 154-158), `PACKAGE_SERVICES` via imports (common.ts:82-129; js.ts:116-117, 141-142; py.ts:111-118, 134-135), `ENV_SERVICES` via env reads (common.ts:131-152; js.ts:389-402; py.ts:239-244, 250-256; env-only → `likely` with a note, build.ts:596-603). `hostsIn` (common.ts:174-179) requires a dotted host with a ≥2-letter TLD, so bare container names (`ireliabee-web:8002`, `users-service`) are never seen as hosts in string scanning.
- In the HTTP path: known host → `uses-service` certain and skip route matching (build.ts:532-539). Unknown host → try routes (with leadingVar); if nothing matches and the host is not localhost/127.0.0.1/0.0.0.0 (build.ts:553) → **a new external service node named by the raw host** (`svc:users-service-8080`, name `users-service:8080`, area `""`, build.ts:555-556). CONFIRMED on the fixture. Inspector then calls it "outside service — another company's API" (Inspector.tsx:26), MapView puts it in the Outside services lane, and `mapSummary` lists it under "Outside services" for Claude (prompts.ts:35). localhost calls with no route are only counted as unmatched (build.ts:557-560). Service nodes are global with `area:""` (build.ts:536, 555, 600).
- `USERS_SERVICE_URL`-style env vars produce no fact at all (CONFIRMED `services: []`): `serviceForEnv` only knows the third-party prefixes.

## 4. What CodeMap can and cannot express (types.ts)
- `MapNode` (types.ts:30-46): `layer` ∈ ui|api|logic|data|external (types.ts:4), `kind` ∈ component|module|route|table|service (types.ts:33), one `area: string` (types.ts:37), file/line, route method/path/handler. No `service`, `repo`, `host`, `port`, `env`, no "internal service" kind, no grouping/hierarchy, no system-level node.
- `MapEdge` (types.ts:48-61) kinds imports|calls|calls-route|reads|writes|defines|uses-service (types.ts:12-19). No publishes/consumes (queues, topics), no rpc (gRPC), no proxies/rewrites (gateway), no "same DB" evidence; `Evidence.file` is a bare repo-relative path (types.ts:22, 87).
- `CodeMap` (types.ts:74-84): single `name`, flat `areas: string[]`, `files[]` with `area`; `version: 1`.
- Can express today: a monorepo of packages, and a call from a route/component in area A to a route in area B (the client can infer "cross-area" from `node.area` on both ends).
- Cannot express: which areas are services vs shared libraries; hostnames/ports/env names per service; a service's own database — tables are global `table:${name.toLowerCase()}` (build.ts:424) with `area` = whichever file mentioned it first (build.ts:364-368, 429). CONFIRMED false shared-DB arrow: orders-service's `INSERT INTO users` drew a `writes` edge to users-service's `users` table. Cannot express several repos: `file:${path}` ids (build.ts:383), `nodeAt` (store.ts:87-94), `read_file`/`search` (tools.ts:118-145) and citations (Guide.tsx:29) all key on the bare path, so `src/index.ts` in two repos collides. Route ids `route:${file}#${METHOD} ${path}` (build.ts:418) are per-file, so same paths in different services do *not* collide (good).

## 5. Layout / lanes
- `LANES` fixed at five (MapView.tsx:40-46); constants CARD_W 220, CARD_H 46, GAP_X 260, LANE_GAP 90, PER_COLUMN 40 (MapView.tsx:47-51).
- Per lane (MapView.tsx:112-125): nodes with that layer, sorted by area then name (113); `cols = clamp(ceil(n/40),1,3)` (114); `rows = ceil(n/cols)`; card at `x = laneX + col*260, y = row*56` (122); lane header at y −60 (116); next lane `x += cols*260 − 40 + 90` (124). Pure column stacking: no swimlane per area, no compound/group nodes, no service boundary; `area` shows only in the card subtitle (MapView.tsx:69) and sort order. Edges are smoothstep (135); dashed when `likely` (137).
- Visibility: focus = 2-hop `neighbourhood` (MapView.tsx:96-100, store.ts:97-120); imports hidden unless toggled (104). `trace` (store.ts:123-145) walks by layer order ui0/api1/logic2/data3/external3 with depth ≤4 (store.ts:129) — a UI→gateway→svcA→svcB→module→table chain exceeds it.
- Workspace: `.work` is a fixed CSS grid `minmax(0,1.25fr) minmax(0,1fr) minmax(320px,420px)` (globals.css:118), collapsing to two columns under 1200px with the guide across the bottom at 40vh (globals.css:120). page.tsx hard-codes three `<section>`s (page.tsx:186-246); Guide/Details/Files is a `tab` state (page.tsx:31, 233-245). No resize handles, docking, floating, pop-out or persisted arrangement. MapView refits only on `window` resize (MapView.tsx:146-154), not on container resize — a dockable shell needs a ResizeObserver. `.maptools`/`.legend` are absolutely positioned inside the map panel (globals.css:139, 141).

## 6. Every place that assumes "one repo, one app"
- store.ts:7-11 `Repo = {map, files, source:{kind:"local"|"demo", label}}` — one map, one file dict; single IndexedDB slot `"repo"` (store.ts:52-55, 59-77).
- localFolder.ts:16-28 one directory handle; MAX_FILES 4000 total (line 8); the webkitdirectory fallback strips the first path segment as "the folder" (localFolder.ts:52-55).
- src/app/page.tsx:26-48 `analyse(name, files)` → one `buildMap` → `setRepo`; label = folder name (42); `loadDemo(name)` one indexed repo (59-70); map page header shows one `repo.source.label` and "change repo" replaces rather than adds (map/page.tsx:171, 182).
- scripts/index.ts:33-36 one dir, one name → `.walkmycode/<name>.map.json` + `.files.json` (48-55); api/demo/route.ts:10-19 serves one name.
- build.ts:11-16 `BuildOptions.name` single; fallback area = `opts.name` (137); `map.name` (612-616); `SourceFile.path` repo-relative with no repo prefix (types.ts:86-89); file-based route detection matches `app/**/route.ts`, `pages/api/**`, `functions/**` anywhere (build.ts:201-228), so two Next apps in one monorepo produce identical route paths that fan out; `@/` alias assumes one `src` root per area (236-244).
- prompts.ts:28-30 "# Repo: name / Areas (packages)"; tools.ts:21 example path, 35 `path_prefix`, 52 `list_files` from "/"; Guide.tsx:29 citation regex is path-only.
- MapView.tsx:40-46 five lanes, no system view; Inspector.tsx:19-32 has no wording for an internal service.
- README.md:3,7 and PLAN.md "Connect" (line 20-21) describe one folder/repo. Accounts: none anywhere — api/claude/route.ts:14-18 accepts any POST on the server key; cost.ts is per-tab memory; store.ts per-browser.

## 7. Concrete gaps for microservice codebases (ordered by impact)
1. No service-boundary source: compose/k8s/wrangler/Dockerfile/.proto/openapi files are neither read (localFolder.ts:6, scripts/index.ts:13) nor parsed (build.ts:152). Needs a `ServiceFact {name, dir/area, hostAliases, ports, envVars}` extractor and a `services` section in CodeMap.
2. Internal hosts become "outside services" in the External lane with third-party wording (build.ts:553-556; Inspector.tsx:26; prompts.ts:35). Needs an internal-service kind (or `area` resolution from host alias) and a distinct lane/colour.
3. Env-var base URLs are invisible (js.ts:389-402, py.ts:239-244 only know third-party prefixes) and the template-literal `fromVariable` bug (js.ts:26-32) makes `` `${BASE}/path` `` unmatched. Fix the bug (test `first` before the backtick iteration) and record `*_URL`/`*_HOST`/`*_ENDPOINT` env reads as base-URL facts tied to a service.
4. Route matching has no service affinity (build.ts:543-551): with a known host/env/service, restrict candidates to that service's routes and grade `certain`; only fan out when the target is truly unknown. Also drop the "starts with a variable" note for literal hosts (build.ts:540, 568-571).
5. Tables are global (build.ts:424-431) → false shared-database arrows across services. Scope table ids by area/database (e.g. `table:${area}/${name}`) unless a shared schema/connection string proves sharing; carry the DB identity on the node.
6. Express/Fastify named handlers lose all HTTP/SQL evidence (js.ts:302-309 route span, build.ts:412 no file node, 454-468, 529). Extend a route's span to its handler function (`handler` is already recorded) or always add the file node.
7. Gateway rewrites and prefix stripping (nginx/ingress/Next `rewrites`, client helpers like iReliabee's `apiUrl`) are not modelled in `matchRoute` (build.ts:102-123).
8. No queue/topic/gRPC edge kinds (types.ts:12-19): Kafka/RabbitMQ/SQS/BullMQ producers and consumers and `.proto` services are invisible, so async service links never appear.
9. Multi-repo workspace: ids, file dict, `nodeAt`, citations and tools all key on bare paths; the store holds one repo. Prefix each repo's paths (`<repo>/…`) or add a `repo` field, and make the store a workspace of repos (store.ts:7-11, 52).
10. No system view: MapView is lane-only. A first cut can be derived client-side by aggregating `calls-route`/`uses-service` edges by (from.area → to.area) since `area` is already on every node and the ambiguity note already flags `areasHit>1`; drill-in reuses the current lanes filtered by area. Raise the trace depth (store.ts:129).
11. Area detection from manifests only (build.ts:132-138): `services/*` without per-service manifests merge; nested manifests split. Service definitions from (1) should override/define areas.
12. `Evidence.file` and node ids carry no repo qualifier (types.ts:22, 87) — required before two repos can share a map.

Notes on the other two requirements: docking/resizing touches only page.tsx:186-246 + globals.css:118-120 today (no layout state exists to persist), and MapView.tsx:146-154 must refit on container rather than window resize. Registration has no footprint in the code yet (no accounts, sessions or per-user storage anywhere); iReliabee's email-code flow is the intended reference per PLAN.md:67-70.
Key facts:
- Areas = directories of manifest files (package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, composer.json, Gemfile) — build.ts:27, 132-138; areaOf = longest matching manifest dir, fallback opts.name or "root" (build.ts:137). Areas are package boundaries, never service boundaries.
- The folder readers only keep source files plus 5 manifest names (localFolder.ts:6, scripts/index.ts:13); docker-compose.yml, k8s YAML, wrangler.toml, Dockerfile, .proto and openapi files are never read, and build.ts:152 drops anything langOf() can't classify. CONFIRMED: a docker-compose.yml in the sources had no effect.
- HTTP-call matching (build.ts:523-582): callSegments (84-100) splits scheme://host/path; matchRoute (102-123) requires equal segment counts after dropping up to 3 leading call segments when leadingVar; leadingVar = fromVariable || !!host (540); candidates are ALL route nodes in the map (543) filtered only by method (544).
- CONFIRMED fan-out: fetch("/health") from a web area draws dashed edges to every service's GET /health ("More than one route matches this path", build.ts:572-577). iReliabee looks clean only because none of its 277 routes share a path across areas.
- CONFIRMED bug js.ts:26-32: template literals starting with ${…} report fromVariable:false because the opening backtick child sets first=false; `${process.env.USERS_SERVICE_URL}/users/${id}` therefore matches no route. Python f-strings (py.ts:12-26) and JS string concatenation are handled correctly.
- CONFIRMED: an unknown non-localhost host with no route match becomes an EXTERNAL service node named by the raw host (build.ts:553-556, e.g. svc:users-service-8080), shown in the Outside services lane and described as "another company's API" (Inspector.tsx:26) and listed to Claude under Outside services (prompts.ts:35). Known hosts/packages/env prefixes are only third parties (common.ts:45-152); hostsIn (common.ts:174-179) needs a dotted TLD so container names are never seen in strings; *_SERVICE_URL env vars produce no fact.
- CONFIRMED: tables are global ids `table:<lowercase name>` (build.ts:424-431) with area = first file that mentioned them; orders-service's INSERT INTO users drew a writes edge to users-service's table — a false shared-database arrow.
- CONFIRMED: Express routes span only the app.get(...) statement (js.ts:302-309) and a route-only file with non-exported named handlers gets no file node (build.ts:412), so containerAt (454-468) returns null and every HTTP/SQL fact in those handler bodies is dropped (build.ts:529, 587, 599). FastAPI is unaffected (py.ts:185 spans the whole decorated function).
- A literal internal host still gets the note "The URL starts with a variable" and confidence likely, because leadingVar is true for any absolute URL (build.ts:540, 568-571).
- CodeMap types (types.ts): MapNode has one `area: string`, kinds component|module|route|table|service, layers ui|api|logic|data|external; MapEdge kinds imports|calls|calls-route|reads|writes|defines|uses-service; Evidence.file is a bare repo-relative path; CodeMap has one `name` and flat `areas: string[]`. No service/repo/host/port fields, no internal-service kind, no queue/gRPC/gateway edge kinds, no grouping.
- Route ids `route:<file>#<METHOD> <path>` (build.ts:418) are per-file, so identical paths in different services do not collide — the one piece already safe for microservices. Service node ids `svc:<slug>` (build.ts:432) and table ids are global.
- Layout (MapView.tsx:108-125): five fixed lanes (40-46); per lane nodes sorted by area then name, cols = clamp(ceil(n/40),1,3), x = laneX + col*260, y = row*56, lane x advance = cols*260-40+90. No per-area swimlanes or group nodes; area only appears in the card subtitle (69). Trace depth is capped at 4 hops (store.ts:129).
- Workspace is a fixed CSS grid `minmax(0,1.25fr) minmax(0,1fr) minmax(320px,420px)` (globals.css:118; 2-column fallback at 120) with three hard-coded sections in map/page.tsx:186-246 and a tab state for Guide/Details/Files (page.tsx:31). No resize, dock, float or persisted layout; MapView refits on window resize only (MapView.tsx:146-154).
- One-repo assumptions: store.ts:7-11 Repo{map, files, source} with single IndexedDB key "repo" (52); localFolder.ts:16-28 one directory handle, MAX_FILES 4000 (8); src/app/page.tsx:26-48 analyse(name, files) → one buildMap; scripts/index.ts:33-36 one dir → .walkmycode/<name>.map.json; api/demo/route.ts:10-19 one name; build.ts BuildOptions.name (11-16), map.name (612-616); prompts.ts:28-30 "# Repo"; tools.ts:21,35,52 bare paths; Guide.tsx:29 path-only citations; map/page.tsx:171,182 one source label and "change repo".
- No accounts exist anywhere: api/claude/route.ts:14-18 accepts any POST on the server's ANTHROPIC_API_KEY, cost.ts is per-tab memory, store.ts is per-browser IndexedDB. PLAN.md:67-70 designates iReliabee's email-code sign-in as the reference.
Pitfalls:
- Do not treat `area` as a service: it is the nearest manifest directory. A repo with one root package.json and services/* subfolders is ONE area; a nested src-tauri/Cargo.toml splits one app into two.
- Fixing the js.ts:26-32 template-literal bug alone will make `${BASE}/path` calls start matching — by suffix alignment against EVERY service's routes, so without service affinity it will increase fan-out guesses, not reduce them. Ship the fix together with host/env→service resolution.
- Internal hostnames (docker service names, k8s DNS, env base URLs) currently land in the Outside services lane as 'another company's API'. Any system view must reclassify these before they teach a beginner that their own service is a third party.
- Scoping tables per service will change every table node id (`table:<name>` today); anything that persists node ids (tour node_ids in Claude history, IndexedDB-mirrored maps, .walkmycode/*.map.json) will break unless version is bumped from 1 (types.ts:75) and old maps are re-indexed.
- Express/Fastify services with `router.get('/x', handler)` and separately defined handlers lose all HTTP/SQL evidence today; a microservice test set built only on FastAPI (like iReliabee) will not reveal this. Add a Node/Express service to the hand-checked test set.
- Route matching considers every route in the map regardless of area (build.ts:543). Restricting candidates by service must fall back to the current global search when the target host is unknown, or existing monolith maps will lose edges.
- Merging several repos by concatenating SourceFile lists without prefixing paths will silently collide node ids (`file:src/index.ts`), file contents in `repo.files`, `nodeAt`, `read_file` and citations. Prefix paths or add a repo field before building a multi-repo map.
- Dropping the query string and treating any `*`-containing segment as a wildcard (build.ts:93-98) means `/api/*` catch-all calls score against everything; the all-`*` guard (578) only stops fully variable URLs.
- The dockable shell cannot just wrap the existing sections: MapView refits on window resize only (MapView.tsx:148-149) and .maptools/.legend are absolutely positioned inside the map panel (globals.css:139,141); CodeView rebuilds its editor on path/content change (CodeView.tsx:91-129) so undock/redock must keep the same React element or it loses scroll/selection.
- PLAN.md promises `docs/SERVICES.md`, `docs/SHELL.md` and `docs/ACCOUNTS.md` but the docs folder only holds PLAN.md and PROVIDERS.md — none of the three designs exists yet.
- hostsIn (common.ts:176) only recognises hosts with a dotted TLD, so a future 'internal host' detector must not reuse it; callSegments (build.ts:87) does capture bare hosts and ports and is the right hook.
- Trace depth is capped at 4 hops (store.ts:129); a UI → gateway → service A → service B → module → table path will be cut short in 'Trace it' once cross-service edges exist.

## Dock layout research
Recommendation: use **dockview-react 8.3.1** (MIT) for docking/undocking, floating groups, popout-to-new-window, sash resizing and JSON layout persistence in WalkMyCode. It is the only React-19-compatible option that ships all three of floating groups, true popout windows and serialisation in one MIT core with zero runtime dependencies, and it is actively maintained (8.3.1 released 10 Sep 2026; 8.x cadence roughly fortnightly). Packaging changed in v8: `dockview` is now the framework-agnostic package (vanilla `DockviewComponent`), and the React bindings live in **`dockview-react`**, which `export * from 'dockview'` so every core symbol (themes, `DockviewApi`, `SerializedDockview`) is importable from one place. Exact wiring: `npm i dockview-react`; in `src/app/globals.css` add `@import 'dockview-react/dist/styles/dockview.css';` (or `import 'dockview-react/dist/styles/dockview.css'` in the client component); `import { DockviewReact, themeAbyss, type DockviewReadyEvent, type DockviewApi, type IDockviewPanelProps, type SerializedDockview } from 'dockview-react'`; render `<DockviewReact theme={themeAbyss} components={{ map: MapPanel, code: CodePanel, guide: GuidePanel, details: DetailsPanel, files: FilesPanel }} onReady={(e: DockviewReadyEvent) => { apiRef.current = e.api; restoreOrDefault(e.api); }} popoutUrl="/popout.html" floatingGroupBounds="boundedWithinViewport" defaultRenderer="always" />` inside a `'use client'` file loaded with `dynamic(() => import('./Workspace'), { ssr: false })` from another client component, and add an empty `public/popout.html`. Each panel component receives `{ params, api, containerApi }` (IDockviewPanelProps); `api.setSize({width,height})`, `api.setTitle`, `api.close`, `api.moveTo`, `api.getWindow()`, `api.onDidLocationChange`, `api.onDidDimensionsChange` are the per-panel hooks; `containerApi.addFloatingGroup(panel, {x,y,width,height})` and `containerApi.addPopoutGroup(panel, {popoutUrl, position:{left,top,width,height}, onDidOpen, onWillClose})` do undock/popout; users can also shift-drag a tab to float it and shift-drag/long-press the titlebar to redock. Replace the fixed 3-column `.work` CSS grid in src/app/map/page.tsx with one DockviewReact filling that area: default layout = map (left), code (centre), guide/details/files stacked as tabs in a right group (`api.addPanel({..., position:{referencePanel:'guide', direction:'within'}})`); keep the existing page-level state (selected/open/lit/tab/job/tour) in a React context so panels read it regardless of where they are docked. Persistence: subscribe to `api.onDidLayoutChange`, debounce ~500 ms, `api.toJSON()` -> `{ v: 1, layout }`; hosted mode PUT to a new endpoint backed by a D1 table `layouts(account_id TEXT, name TEXT, json TEXT, v INTEGER, updated_at INTEGER, PRIMARY KEY(account_id,name))` keyed by the iReliabee-style `accounts.id` from the `web_sessions` cookie; Lite/BYOK mode writes the same object to IndexedDB via src/lib/store.ts. On load: `try { api.fromJSON(saved.layout) } catch { api.clear(); buildDefault(api) }` (dockview throws and resets gracefully on a corrupt layout), drop on `v` mismatch, and `await api.popoutRestorationPromise` before treating restore as done. Cross-window behaviour: dockview moves the panel's own `div.dv-react-part` (the React portal container) into the popout document via `body.appendChild`, so React state survives and React events keep working (React 17+ attaches its listeners on the portal container node, which travels with it). CodeMirror: on `api.onDidLocationChange` call `view.setRoot(api.getWindow().document)` — `setRoot` (since @codemirror/view 6.2.0, present in the installed 6.43.13) re-mounts the StyleModules into the new document and rebinds window resize/scroll listeners; without it the editor renders unstyled in the popout because CM injects styles at runtime and dockview only copies stylesheets that exist at open time. React Flow (@xyflow/react 12.12.0): pan/zoom/drag are d3 listeners on the element and follow it, but `useResizeHandler` uses the main `window.resize` plus a `ResizeObserver` created in the main window, and `useKeyPress` defaults to the main `document`; remount the flow with `key={location.type}` on `onDidLocationChange`, call `fitView` after, and forward `containerApi.onDidPopoutGroupSizeChange` to `window.dispatchEvent(new Event('resize'))` so dimensions refresh even if cross-document ResizeObserver does not fire (WPT confirms same-origin sub-document observation fires; treat popup windows as needing a manual test). Alternatives rejected: flexlayout-react 0.11.1 (MIT, 52.7 kB gz, popouts via portals + popout.html, React 18/19) is the closest runner-up but has no floating-over-grid groups and a less rich per-panel API; rc-dock 4.0.2 (Apache-2.0, 57.3 kB gz, 6 deps incl. lodash) has float + new-window but weaker typing/docs and heavier deps; react-mosaic-component 7.2.1 (Apache-2.0, 42.8 kB gz, 10 deps via react-dnd) has no popout and no floating; react-resizable-panels 4.14.1 (MIT, 19 kB gz) does resizing only — you would hand-build docking, floating and popout.
Key facts:
- dockview-react 8.3.1 (npm 'latest' as of 2026-09-30): MIT; peerDependencies react and react-dom ^16.8||^17||^18||^19; depends on dockview ^8.3.1 which depends on dockview-core ^8.3.1 (zero external deps); bundlephobia: 388,264 B min / 88,801 B gzip incl. core; unpacked 1.81 MB (dockview-core unpacked 5.1 MB, mostly maps/types). Source: registry.npmjs.org/dockview-react/latest, bundlephobia.com/api/size?package=dockview-react
- Package split in v8 (Aug 2026): 'dockview' = vanilla DockviewComponent; 'dockview-react' = React bindings and does `export * from 'dockview'` (packages/dockview-react/src/index.ts). Install ONLY dockview-react. dockview-enterprise (paid, per developer per year, 30-day trial, LicenseManager.setLicenseKey) is a superset adding multi-row tabs, pinned tabs, advanced overflow, DnD compass, smart guides, auto-hide/dock-to-edge groups, layout history (undo/redo), keyboard docking; the licence page's comparison table lists everything else — floating groups, popout groups, toJSON/fromJSON, theming, React support — in the free MIT tier ('If a feature was free in Dockview, it stays free'). Sources: dockview.dev/blog/dockview-enterprise, dockview.dev/docs/overview/licence, dockview.dev/docs/overview/enterprise-setup
- CSS: import 'dockview-react/dist/styles/dockview.css' (package exports './dist/styles/*'; sideEffects lists **/*.css). Theme is a prop object, not a class: `theme={themeAbyss}`. Exported themes (dockview-core/src/dockview/theme.ts): themeDark, themeLight, themeVisualStudio, themeAbyss, themeDracula, themeNord, themeMonokai, themeSolarizedLight, themeGithubDark, themeGithubLight, themeCatppuccinMocha, plus *Spaced variants (gap 10, dndOverlayMounting 'absolute', dndPanelOverlay 'group') and themeLightSpaced/themeAbyssSpaced. DockviewTheme fields: name, className, colorScheme, gap, edgeGroupCollapsedSize, dndOverlayMounting, dndPanelOverlay, dndTabIndicator, dndOverlayBorder, tabGroupIndicator, tabAnimation — so a WalkMyCode 'chalkboard' theme is `{ name:'lantern', className:'dockview-theme-abyss lantern', colorScheme:'dark' }` overriding CSS vars on `.walkmycode`.
- CSS variables to override for the Lecture Hall look (dockview-core/src/theme.scss): --dv-group-view-background-color, --dv-tabs-and-actions-container-background-color, --dv-tabs-and-actions-container-height, --dv-tabs-and-actions-container-font-size, --dv-tab-font-size, --dv-activegroup-visiblepanel-tab-background-color / -tab-color, --dv-activegroup-hiddenpanel-tab-*, --dv-inactivegroup-visiblepanel-tab-*, --dv-inactivegroup-hiddenpanel-tab-*, --dv-tab-divider-color, --dv-separator-border, --dv-sash-color, --dv-active-sash-color, --dv-active-sash-transition-duration/-delay, --dv-drag-over-background-color, --dv-drag-over-border-color, --dv-floating-box-shadow, --dv-floating-border, --dv-floating-group-border, --dv-floating-titlebar-height/-background-color/-border-bottom, --dv-border-radius, --dv-tab-border-radius, --dv-overlay-z-index, --dv-scrollbar-background-color, --dv-icon-hover-background-color, --dv-context-menu-background-color/-color.
- DockviewReact props = IDockviewReactProps extends DockviewOptions. React-only props: components (Record<string, FC<IDockviewPanelProps>>, required), onReady (required, receives {api: DockviewApi}), tabComponents, defaultTabComponent, watermarkComponent, leftHeaderActionsComponent, rightHeaderActionsComponent, prefixHeaderActionsComponent, groupDragGhostComponent, tabGroupChipComponent, getTabContextMenuItems, getTabGroupChipContextMenuItems, onDidDrop, onWillDrop. Core options (dockview-core.DockviewOptions typedoc): theme, className, popoutUrl, disableFloatingGroups, floatingGroupBounds ('boundedWithinViewport' | {minimumHeightWithinViewport?, minimumWidthWithinViewport?}; default 100px), floatingGroupDragHandle ('titlebar' default | 'tabbar'), transformFloatingGroupDrag, defaultRenderer ('always' | 'onlyWhenVisible'), hideBorders, singleTabMode ('fullwidth'|'default'), disableDnd, dndEdges, dndStrategy ('auto'|'pointer'|'html5'), noPanelsOverlay ('emptyGroup'|'watermark'), scrollbars ('native'|'custom'), locked, disableAutoResizing, disableTabsOverflowList, debug, nonce (CSP), announcements/announcer/messages (a11y), keyboardNavigation, defaultHeaderPosition, tabGroupColors/tabGroupAccent. Prop changes are forwarded via api.updateOptions in an effect keyed on PROPERTY_KEYS_DOCKVIEW.
- DockviewApi (typedoc dockview.dev/docs/api/dockview/overview): addPanel({id, component, params?, title?, position?:{referencePanel|referenceGroup, direction:'left'|'right'|'above'|'below'|'within'}, floating?, renderer?}), addGroup, removePanel, removeGroup, getPanel(id), getGroup(id), addFloatingGroup(item, FloatingGroupOptions{x?,y?,width?,height?,position?:AnchorPosition,dragHandle?,disableSmartGuides?}), addPopoutGroup(item, {popoutUrl?, position?:Box{left,top,width,height}, onDidOpen?({id,window}), onWillClose?({id,window})}) => Promise<boolean> (false, not throw, when blocked), getPopouts(), maximizeGroup/exitMaximizedGroup/hasMaximizedGroup, toJSON(): SerializedDockview, fromJSON(data, {reuseExistingPanels?}), clear(), layout(w,h,force), focus(), activateNext/Previous, dispose(), popoutRestorationPromise; events onDidLayoutChange, onDidLayoutFromJSON, onDidAddPanel/RemovePanel, onDidActivePanelChange, onDidMovePanel, onDidAddPopoutGroup/onDidRemovePopoutGroup, onDidOpenPopoutWindowFail, onDidPopoutGroupSizeChange, onDidPopoutGroupPositionChange, onWillDragPanel/onWillDragGroup, onWillDrop/onDidDrop, onWillMutateLayout/onDidMutateLayout, onUnhandledDragOver, onWillShowOverlay.
- DockviewPanelApi (per panel, received as props.api): properties id, title, component, width, height, isActive, isFocused, isVisible, isGroupActive, location (DockviewGroupLocation: {type:'grid'|'floating'|'popout'}), group, renderer; methods setSize({width?,height?}), setTitle, setActive, close, moveTo({group?, position?, index?}), maximize/exitMaximized/isMaximized (no-op for floating and popout groups), setRenderer, updateParameters, getParameters, setConstraints, getWindow(): Window; events onDidDimensionsChange, onDidVisibilityChange, onDidLocationChange, onDidActiveChange, onDidFocusChange, onDidGroupChange, onDidTitleChange, onDidParametersChange, onDidRendererChange. IDockviewPanelProps = { params, api: DockviewPanelApi, containerApi: DockviewApi } (reactContentPart.ts).
- Popout mechanics (dockview-core/src/popoutWindow.ts): window.open(url, target, 'top=,left=,width=,height=') to a same-origin url (default '/popout.html' — put an empty file at public/popout.html in Next); rejects javascript:, data:, blob:, vbscript:, file: and cross-origin URLs, also when restored from fromJSON; copies globalThis.document.styleSheets and adoptedStyleSheets (and shadow-root sheets) into the new document at open time; appends its container div to externalDocument.body; detects close via beforeunload plus a 250 ms `closed` poll; closes popouts on main-window beforeunload. Failure reasons: 'blocked' (popup blocker) or 'unscriptable'. Popout groups cannot be maximised; edge groups cannot be popped out. Supports nested floating/popout layouts since 7.0.2 and sash drags inside popout windows since 7.0.3.
- React inside popouts: dockview-react renders every panel with ReactDOM.createPortal(node, panelElement) into a div.dv-react-part it owns (packages/dockview-react/src/react.ts, reactContentPart.ts); the same element is moved into the popout document, so component state is preserved and synthetic events keep firing because React 17+ registers its event listeners on the portal container. Docs instruct: handlers/portals inside panels 'should not assume the document is the main window; use the element's ownerDocument' (dockview.dev/docs/core/groups/popoutGroups).
- CodeMirror 6 in a popout: EditorViewConfig.root ('If the view is going to be mounted in a shadow root or document other than the one held by the global variable document ... you should pass it here') and EditorView.setRoot(root: Document|ShadowRoot) ('only necessary when moving the editor's existing DOM to a new window or shadow root'; added in @codemirror/view 6.2.0, present in installed 6.43.13). setRoot re-runs mountStyles() = StyleModule.mount(root, styleModules.concat(baseTheme)) and observer.setWindow(root.defaultView) which rebinds resize/scroll/print/selectionchange listeners. `view.win` is derived from dom.ownerDocument.defaultView. Do: `api.onDidLocationChange(() => view.setRoot(api.getWindow().document))` and also on mount. style-mod mounts rules once per root, so mounting into the second document is idempotent.
- React Flow (@xyflow/react 12.12.0 installed) in a popout: XYPanZoom/XYDrag attach d3-zoom/d3-drag to the passed domNode (no global document use) so pan, zoom, node drag and edge interaction follow the element; BUT dist/esm/index.mjs line 1282-1284 shows useResizeHandler does `window.addEventListener('resize', ...)` on the MAIN window and `new ResizeObserver(...)` created in the main realm; node measurement also uses a main-realm ResizeObserver (line 2153); useKeyPress defaults to `document` (main) so Delete/Shift-select shortcuts will not work in the popout unless a `target` is passed. WPT resize-observer/iframe-same-origin.html asserts an outer-document observer DOES fire for a same-origin sub-document element, so cross-document observation is expected to work, but verify for window.open documents; belt-and-braces: remount ReactFlow with key=location.type and call fitView, and forward api.onDidPopoutGroupSizeChange → window.dispatchEvent(new Event('resize')) (updateDimensions reads getBoundingClientRect, which works cross-document).
- Next.js 16.3.7 (installed): dockview-react must be used from a 'use client' component; wrap the workspace in next/dynamic(..., { ssr: false }) — Next's own docs (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md) state `ssr: false` is not supported in Server Components and must be moved into a Client Component. dockview GitHub issues #659 (open, 2024) and #722 (closed) are SSR questions with no maintainer-provided SSR path: panel content is always client-rendered.
- Layout persistence: api.toJSON() → SerializedDockview (grid, panels, floating groups, popout groups incl. window boxes); api.fromJSON(json, {reuseExistingPanels}) throws and resets gracefully on invalid input; onDidLayoutChange is an aggregation of all layout mutations (debounce before saving); onDidLayoutFromJSON fires after restore; api.popoutRestorationPromise resolves when restored popouts are reopened; popouts restore only if the browser allows window.open at that moment (user-gesture rules) — check onDidOpenPopoutWindowFail. Bug #851 'Duplicate popouts when page is refreshed' (StrictMode double-mount + un-cancelled setTimeout restoration) was fixed by PR #1288 merged 16 May 2026, i.e. before 7.x/8.x — install ≥ 8.3.1. Save per user: iReliabee's D1 schema (website/schema.sql) identifies users by accounts.id ('acc_<random>') via web_sessions.token_hash; add `layouts(account_id, name, json, v, updated_at, PRIMARY KEY(account_id,name))` and reuse the same email-code sign-in for the registration requirement. In Lite/BYOK mode persist the same JSON in src/lib/store.ts (IndexedDB) and optionally localStorage.
- Alternatives (npm latest, 2026-09-30): flexlayout-react 0.11.1 — MIT, peer react ^18||^19, 208.8 kB min / 52.7 kB gz, 0 deps; imports `import { Layout, Model, Actions, DockLocation } from 'flexlayout-react'` + `import 'flexlayout-react/style/dark.css'` (also light/underline/gray/rounded/combined); Model.toJson/fromJson; popouts via React portals + popout.html with runtime style cloning and CSSOM re-sync; docs list caveats: components binding to global document need re-keying (Monaco/ag-Grid examples), timer throttling, CSP nonce issues, popup blockers degrade to floating. rc-dock 4.0.2 — Apache-2.0, peer react >=18, 187.9 kB / 57.3 kB gz, 6 deps (lodash, classnames, rc-new-window, @rc-component/menu|tabs|dropdown); `import DockLayout from 'rc-dock'` + `import 'rc-dock/dist/rc-dock.css'`; float box + new-window panels; saveLayout/loadLayout. react-mosaic-component 7.2.1 — Apache-2.0, peer react 16-19, 145.2 kB / 42.8 kB gz, 10 deps (react-dnd stack); tiling only, no floating/popout. react-resizable-panels 4.14.1 — MIT, peer react ^18||^19, 58.7 kB / 19 kB gz, 0 deps; v4 renamed PanelGroup→Group, PanelResizeHandle→Separator, direction→orientation, defaultSize now '50%'; resizing only.
- Mapping onto WalkMyCode (src/app/map/page.tsx): the fixed `.work` 3-column grid becomes one DockviewReact; five panels — 'map' (MapView), 'code' (CodeView + selbar), 'guide' (Guide), 'details' (Inspector), 'files' (FileTree) — with guide/details/files added `position:{referencePanel:'guide', direction:'within'}` so they stay a tab strip; the current `tab` state becomes `api.getPanel('details')?.api.setActive()`; the `.top` header stays outside dockview. Use defaultRenderer='always' for map and code so React Flow and CodeMirror keep DOM/state when their tab is hidden (onlyWhenVisible unmounts the DOM). Width resizing comes free from dockview sashes; expose 'Float' and 'Pop out' buttons via rightHeaderActionsComponent calling containerApi.addFloatingGroup(group) / addPopoutGroup(group).
Pitfalls:
- Install the right package: v8 moved React bindings to `dockview-react`; `dockview` alone no longer exports DockviewReact (its README shows vanilla DockviewComponent). Do not also install dockview-core directly — let dockview-react pull it.
- Server rendering: any file importing dockview-react must be a client component and should be loaded with next/dynamic({ ssr:false }) from another client component; Next 16 errors if `ssr:false` is used in a Server Component. The workspace already depends on IndexedDB restore, so gate rendering behind the existing `ready` flag too.
- popout.html must exist at a same-origin path (public/popout.html in Next; keep it minimal, no scripts). Cross-origin, data:, blob: or javascript: popoutUrl values are rejected, including inside restored layouts. Popup blockers make addPopoutGroup resolve false — surface onDidOpenPopoutWindowFail and fall back to addFloatingGroup.
- Styles in popouts are copied once at open time from document.styleSheets/adoptedStyleSheets. Anything injected later (CodeMirror StyleModules, lazily loaded CSS chunks, next/font style tags loaded on demand) will be missing: call view.setRoot(ownerDocument) for CodeMirror, and ensure React Flow CSS (@xyflow/react/dist/style.css) and dockview.css are imported globally at startup, not lazily. Web fonts (Inter/JetBrains Mono/Caveat/Kalam via next/font) rely on @font-face rules present in copied sheets; verify they render in the popout.
- React Flow in a popout: main-window `resize` listener and main-realm ResizeObserver/useKeyPress(document) do not follow the element. Remount with key on location change, call fitView, dispatch a synthetic resize on onDidPopoutGroupSizeChange, and pass a `target` to keyboard hooks or accept that Delete/Shift-select are main-window only. Test in Chrome, Firefox and Safari — the WPT covers iframes, not window.open, so cross-document ResizeObserver in popups is 'expected' rather than 'proven'.
- Floating and popout groups cannot be maximised; edge groups cannot be popped out. Floating groups default to a 100px minimum inside the viewport — set floatingGroupBounds='boundedWithinViewport' so users cannot lose a panel off-screen.
- React StrictMode double-mounts DockviewReact in dev (issues #866/#818/#851): keep onReady idempotent (check api.totalPanels === 0 before building the default layout) and always dispose via the component's own unmount; do not create panels in a separate useEffect.
- Persistence: version the saved JSON ({v, layout}) and drop it when the panel component names change — fromJSON throws (then resets) if a panel references an unregistered component. Debounce onDidLayoutChange (fires for every sash move). Restored popouts need window.open permission at restore time; await api.popoutRestorationPromise and handle onDidOpenPopoutWindowFail. Do not persist layouts with `reuseExistingPanels` unless panel ids are stable across sessions.
- Renderer choice: the default renderer is 'onlyWhenVisible', which removes hidden tabs' DOM; use 'always' for the map and code panels so React Flow's viewport and CodeMirror's scroll/selection survive tab switches (costs memory for background panels).
- Enterprise creep: smart guides, pinned tabs, multi-row tabs, DnD compass, edge/auto-hide groups and layout history/undo are in dockview-enterprise (paid per developer per year; evaluation shows a watermark). Do not enable `smartGuides`, `pinnedTabs`, `layoutHistory`, `autoHideEdgeGroups`, `dockToEdgeGroups` or `dndCompass` options without a licence key.
- Popout windows use `window.open` with a 250 ms polling loop and close on the parent's beforeunload; a Next.js client-side navigation away from /map does not fire beforeunload, so dispose the DockviewReact (unmount) on route change to close orphan windows. Timers in the main window may be throttled when it is backgrounded, which slows updates shown in a popout.
- CSP: dockview and CodeMirror inject inline <style>; if a strict style-src is ever added, pass `nonce` to DockviewReact and `EditorView.cspNonce`.
- Alternatives' hidden costs if reconsidered: rc-dock pulls lodash + rc-component UI packages (Apache-2.0, ~57 kB gz); react-mosaic drags in the whole react-dnd stack and has no popout; flexlayout-react has no in-page floating groups (only popout windows) and requires re-keying document-bound components exactly as dockview does.