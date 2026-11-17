"use client";
// Everything the Explore room knows (docs/SHELL.md §4): the selection, the
// open files, the trace, the tour, the guide's current job, and the dock's
// own actions. Panels read it with useShell(), wherever they are docked,
// floating or popped out: dockview renders each panel through a React portal,
// so this context reaches a panel in another window too.
//
// The open files are the truth for the editors; dockview is kept in step with
// them (an editor tab closed by the user closes the file, a preset or restore
// re-adds every open file).
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview-react";
import type { CodeMap, MapEdge, MapNode, ServiceDef, ServiceLink } from "@/analyzer/types";
import type { Lit } from "@/components/MapView";
import { checkView, defaultView, hasSystem, hashOf, isOpenable, parseHash, viewFor, type MapViewState } from "@/components/mapLayout";
import type { Selection } from "@/ide/Editor";
import { kindWord } from "@/components/Inspector";
import type { Job } from "@/components/Guide";
import type { GoOn, Hit } from "@/components/Palette";
import { edgesOf, nodeAt, nodeById, trace, traceService, type Repo } from "@/lib/store";
import { indexOf } from "@/lib/mapIndex";
import type { RepoView, Tour } from "@/lib/claude/tools";
import type { AskImage, PageRequest, RequestContext } from "@/lib/bridge/protocol";
import { MCP } from "@/lib/adapters/target";
import { FLY_REQUEST, IMPACT_REQUEST } from "@/lib/claude/prompts";
import { fnAt, impactContext, impactLit, impactName, impactOf, impactTour, type ImpactAsk, type Reach } from "@/lib/impact";
import { flyThrough, type FlyRoom } from "@/lib/flythrough";
import { causeQuestion, walkLit, walkTrace, type WalkState } from "@/lib/stackTrace";
import { changeLit as litOfChange, storyAsk, type TouredChange } from "@/lib/diffTour";
import { PANELS, basename, editorId, isEditorId, type PanelId } from "./panels";
import type { PresetName } from "./layout";
import { parseDeepLink, resolveDeepLink, withoutDeepLink } from "./deeplink";
import { bindKeys, type Command, type ShellCommands } from "./keys";
import { capabilities } from "./theme";
import { claimTab, tourMayShowGuide, tourTabStep } from "./tourTabs";
import { emptyLog, groupViews, pickTarget, pressed, watchFocus, type FocusLog } from "./openTarget";
import { debugAt } from "@/ide/debugAt";
import { cycleGroup, cycleTab, dockGroup, floatGroup, groupOf, maximiseGroup, popoutGroup, resizeGroup, type GroupTarget } from "./actions";

export interface OpenFile {
  path: string;
  highlight: [number, number] | null;
}

export type Detail = { kind: "edge"; edge: MapEdge } | { kind: "links"; links: ServiceLink[] } | null;

/** What Workspace.tsx lends the provider once dockview is up. */
export interface DockHandlers {
  applyPreset(name: PresetName): void;
  reset(): void;
}

export interface Shell {
  api: React.RefObject<DockviewApi | null>;
  /** True while a preset is built or a layout restored: dockview's remove events are not the user's. */
  restoring: React.RefObject<boolean>;
  /** Workspace.tsx lends its preset and reset here once dockview is up. */
  setHandlers(h: DockHandlers | null): void;
  commands: ShellCommands;
  /** Show a panel: re-add it if it was closed, then make it the visible tab. Never focuses a pop-out window.
   * `why: "tour"` when a playing tour asks for the Guide, which then leaves an open Settings alone. */
  reveal(id: PanelId, why?: "tour"): void;
  float(target?: GroupTarget): void;
  popout(target?: GroupTarget): Promise<boolean>;
  dock(target?: GroupTarget): void;
  maximise(target?: GroupTarget): void;
  preset(name: PresetName): void;
  reset(): void;
  /** Show or hide a closable panel (the Layout menu). */
  toggle(id: PanelId): void;
  /** Add an editor tab for every open file that has none (after a preset or restore), then any pending reveal. */
  syncEditors(api: DockviewApi): void;
  /** The file behind an editor tab the user closed. */
  closeFileState(path: string): void;
  setActivePath(path: string | null): void;
  presetName: PresetName | "custom";
  setPresetName(p: PresetName | "custom"): void;
  layoutMenu: boolean;
  setLayoutMenu(open: boolean): void;
  /** Ids of the panels in the dock now (for the Layout menu's show/hide ticks). */
  present: string[];
  setPresent(ids: string[]): void;
}

export interface WorkspaceState {
  repo: Repo;
  map: CodeMap;
  repoView: RepoView;
  /** The level on screen (a checked view). */
  view: MapViewState;
  changeView(v: MapViewState): void;
  selected: string | null;
  selectNode(id: string | null): void;
  jumpTo(id: string): void;
  focus: string | null;
  setFocus(id: string | null): void;
  showImports: boolean;
  toggleImports(): void;
  mapReveal: { id: string; at: number } | null;
  lit: Lit | null;
  setLit(l: Lit | null): void;
  tour: Tour | null;
  setTour(t: Tour | null): void;
  step: number;
  setStep(i: number): void;
  job: Job | null;
  detail: Detail;
  files: OpenFile[];
  activePath: string | null;
  openAt(path: string, start?: number, end?: number): void;
  closeFile(path: string): void;
  onEdge(e: MapEdge): void;
  onLinks(links: ServiceLink[]): void;
  explainSelection(sel: Selection): void;
  /** "Explain this history" (src/ide/localrun/git/LineStory.tsx): the guide tells how these lines got
   * here, from their commits. `shown` is what the guide shows as asked; `question` carries the commits. */
  explainHistory(o: { path: string; from: number; shown: string; question: string }): void;
  explainNode(n: MapNode): void;
  explainService(s: ServiceDef): void;
  traceNode(n: MapNode): void;
  traceSvc(s: ServiceDef): void;
  tourNode(n: MapNode): void;
  tourLinks(links: ServiceLink[]): void;
  /** "Tour a change" (src/lib/diffTour.ts): the change on screen, marked on the map while its tour plays. */
  change: TouredChange | null;
  /** Start touring a change (its tour from the first step), or stop (null). */
  startChange(c: TouredChange | null): void;
  /** Ask the guide to tell the change as a story, step by step, and review it. */
  explainChange(): void;
  askFree(q: string, images?: AskImage[]): void;
  /** The change impact last asked for, or null. */
  impact: ImpactAsk | null;
  /** Work out a card's impact; `light`: show it on the map (false puts its light out). */
  showImpact(a: { id: string; fn?: string; reach: Reach; light: boolean }): void;
  /** "Show impact of the selection": the card that owns the lines, narrowed to the function they are in.
   * False when no card on the map owns them. */
  impactSelection(sel: Selection): boolean;
  /** "Tour the impact": a tour written from the map, played by the guide (no AI). */
  tourImpact(a: { id: string; fn?: string; reach: Reach }): void;
  /** "Explain the risks": the guide is asked, with the impact's lists. */
  explainImpact(a: { id: string; fn?: string; reach: Reach }): void;
  /** "Walk an error" (src/lib/stackTrace.ts): the error walked last, while the Guide shows it. */
  walk: WalkState | null;
  /** Walk a pasted error: light its path on the map, open where it threw, ask the guide for the likely cause. */
  walkError(text: string): void;
  /** Put the walk away, and its lights with it. */
  endWalk(): void;
  /** Hotspots' "Why is it hot?": the guide reads the file, with the commits that changed it in the span
   * (src/lib/hotspots.ts, whyHotContext), and says what keeps changing, citing lines. */
  askWhyHot(path: string, commits: string): void;
  /** A question said out loud (WalkMyCode for Claude: a spoken request to the user's Claude). */
  /** A question said out loud; `continues`: the unanswered one before it with more said after, which it replaces. */
  askSpoken(q: string, opts?: { continues?: boolean }): void;
  palette: { initial: string } | null;
  openPalette(initial: string): void;
  closePalette(): void;
  /** The go-to bar picked a card, a service or a file: the map flies there. */
  onPick(h: Hit): void;
  /** The go-to bar's "A to B" (flown along the real arrows) or question (the guide flies the map). */
  onGo(go: GoOn, spoken: boolean): void;
  shell: Shell;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function useShell(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell() outside <WorkspaceProvider>");
  return v;
}

/** The workspace's state, or null on a page without one (the home page's "New project" sheet). */
export function useShellOptional(): WorkspaceState | null {
  return useContext(Ctx);
}

interface Initial {
  view: MapViewState;
  selected: string | null;
  focus: string | null;
  files: OpenFile[];
  activePath: string | null;
  mapReveal: { id: string; at: number } | null;
  panel: PanelId | null;
}

const toHighlight = (start?: number, end?: number): [number, number] | null => (start ? [start, end ?? start] : null);

/** ", YOU TOLD WALKMYCODE: VITE_API_URL → backend" when an arrow rests on the user's answer, not on code. */
const toldTail = (e: MapEdge): string => {
  const told = e.evidence.filter((v) => v.role === "user").map((v) => v.text.replace(/^you told (?:WalkMyCode|Lantern): /, ""));
  return told.length ? `, YOU TOLD WALKMYCODE: ${told.join("; ")}` : "";
};

/** Where the room starts: a deep link (?focus= / ?node=), else the URL hash, else the map's default level. */
function initialFrom(map: CodeMap): Initial {
  const out: Initial = { view: defaultView(map), selected: null, focus: null, files: [], activePath: null, mapReveal: null, panel: null };
  if (typeof window === "undefined") return out;
  const link = parseDeepLink(window.location.search, window.location.hash);
  const hit = link ? resolveDeepLink(map, link) : null;
  if (hit) {
    if (hit.path) {
      out.files = [{ path: hit.path, highlight: toHighlight(hit.start, hit.end) }];
      out.activePath = hit.path;
    }
    if (hit.nodeId) {
      const dest = viewFor(map, hit.nodeId, out.view);
      const n = nodeById(map, hit.nodeId);
      const target = dest.kind === "system" && n?.internal && n.service ? n.service : hit.nodeId;
      out.view = checkView(map, dest);
      out.selected = target;
      // The owning card's neighbourhood (the lanes only: the system view has no focus).
      if (out.view.kind !== "system" && n) out.focus = n.id;
      out.mapReveal = { id: target, at: Date.now() };
      out.panel = "details";
    }
    return out;
  }
  const p = parseHash(map, window.location.hash);
  if (p) {
    out.view = p.view;
    if (p.selected) {
      out.selected = p.selected;
      const n = nodeById(map, p.selected);
      const s = n ? undefined : map.services.find((x) => x.id === p.selected);
      const at = n?.file ? { path: n.file, start: n.line, end: n.endLine } : s?.entry ? { path: s.entry.file, start: s.entry.line, end: s.entry.line } : null;
      if (at) {
        out.files = [{ path: at.path, highlight: toHighlight(at.start, at.end) }];
        out.activePath = at.path;
      }
      out.panel = "details";
    }
  }
  return out;
}

export default function WorkspaceProvider({ repo, children }: { repo: Repo; children: React.ReactNode }) {
  const map = repo.map;
  const [init] = useState(() => initialFrom(map));
  const [selected, setSelected] = useState<string | null>(init.selected);
  const [focus, setFocus] = useState<string | null>(init.focus);
  const [showImports, setShowImports] = useState(false);
  const [lit, setLit] = useState<Lit | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [walk, setWalk] = useState<WalkState | null>(null);
  const [step, setStep] = useState(0);
  // The change impact asked for, with the light it put on the map (null while it isn't shown).
  const [impactState, setImpactState] = useState<{ id: string; fn?: string; reach: Reach; lit: Lit | null } | null>(null);
  const [change, setChange] = useState<TouredChange | null>(null);
  const [view, setViewState] = useState<MapViewState>(init.view);
  const [detail, setDetail] = useState<Detail>(null);
  const [mapReveal, setMapReveal] = useState<{ id: string; at: number } | null>(init.mapReveal);
  const [palette, setPalette] = useState<{ initial: string } | null>(null);
  const [files, setFiles] = useState<OpenFile[]>(init.files);
  const [activePath, setActivePathState] = useState<string | null>(init.activePath);
  // Asks for the dock, carried out in an effect (they can come from a render, like a tour step).
  // `group`: where a file the user opened goes (./openTarget.ts); none puts it beside the Code tab.
  const [editorReq, setEditorReq] = useState<{ path: string; n: number; group?: string } | null>(init.activePath ? { path: init.activePath, n: 0 } : null);
  // `tour`: asked for by a playing tour, which gives way to an open Settings (./tourTabs.ts).
  const [panelReq, setPanelReq] = useState<{ id: PanelId; n: number; tour?: boolean } | null>(init.panel ? { id: init.panel, n: 0 } : null);
  const [presetName, setPresetName] = useState<PresetName | "custom">("explore");
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [present, setPresent] = useState<string[]>([]);
  // The code tabs the tour on screen opened itself (./tourTabs.ts), and the one to close next.
  const [tourOwned, setTourOwned] = useState<string[]>([]);
  const [tourClose, setTourClose] = useState<{ path: string; n: number } | null>(null);

  const api = useRef<DockviewApi | null>(null);
  const restoring = useRef(false);
  // The groups the user last pressed in, for where the next file they open goes (./openTarget.ts).
  const focusLog = useRef<FocusLog>(emptyLog());
  useEffect(() => watchFocus(() => api.current, (p) => (focusLog.current = pressed(focusLog.current, p))), []);
  const handlers = useRef<DockHandlers | null>(null);
  const filesRef = useRef(files);
  const viewRef = useRef(view);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const repoView = useMemo<RepoView>(() => ({ map: repo.map, files: repo.files }), [repo]);

  // ── the dock ──

  const revealPanel = useCallback((id: PanelId, why?: "tour") => setPanelReq((r) => ({ id, n: (r?.n ?? 0) + 1, ...(why === "tour" ? { tour: true } : {}) })), []);

  /** Where a closed panel comes back: beside the guide, else right of the first grid group. */
  const addHome = useCallback((a: DockviewApi, id: string) => {
    const def = PANELS[id];
    if (!def) return undefined;
    const guide = a.getPanel("guide");
    const firstGrid = a.groups.find((g) => g.api.location.type === "grid");
    const position =
      guide && id !== "guide" && id !== "map" && id !== "code:home"
        ? ({ referencePanel: "guide", direction: "within" } as const)
        : firstGrid
          ? ({ referenceGroup: firstGrid, direction: "right" } as const)
          : undefined;
    return a.addPanel({ id, component: def.key, title: def.title, renderer: def.renderer, ...(position ? { position } : {}) });
  }, []);

  const doReveal = useCallback(
    (id: PanelId, tour = false) => {
      const a = api.current;
      if (!a) return;
      const def = PANELS[id];
      if (def && !def.available) return;
      if (tour && id === "guide" && !tourMayShowGuide(a.getPanel("guide")?.group?.activePanel?.id)) return;
      const p = a.getPanel(id) ?? addHome(a, id);
      // A group the tool strip hid comes back first.
      if (p && p.group.api.location.type === "grid" && !p.group.api.isVisible) p.group.api.setVisible(true);
      // setActive only shows the tab; a panel in a pop-out never pulls that window forward.
      p?.api.setActive();
    },
    [addHome],
  );

  const syncEditors = useCallback(
    (a: DockviewApi, activate?: string | null, group?: string) => {
      // A new tab goes beside the Code tab (or the last file, when Code is closed), unless the user
      // opened it into a group of their own (./openTarget.ts).
      if (!a.getPanel("code:home") && ![...a.panels].some((p) => isEditorId(p.id))) addHome(a, "code:home");
      const home = (a.getPanel("code:home") ?? [...a.panels].reverse().find((p) => isEditorId(p.id)))?.group.id;
      const target = group && a.getGroup(group) ? group : undefined;
      for (const f of filesRef.current) {
        const id = editorId(f.path);
        if (a.getPanel(id)) continue;
        const into = (f.path === activate && target) || home;
        a.addPanel({
          id,
          component: "code",
          title: basename(f.path),
          params: { path: f.path },
          renderer: "always",
          inactive: true,
          ...(into ? { position: { referenceGroup: into, direction: "within" as const } } : {}),
        });
      }
      if (activate) {
        const p = a.getPanel(editorId(activate));
        // A file shown while the strip has its group hidden: the group comes back with it.
        if (p && p.group.api.location.type === "grid" && !p.group.api.isVisible) p.group.api.setVisible(true);
        p?.api.setActive();
      }
    },
    [addHome],
  );

  // Open files → editor tabs, then the requested panel (in that order, so a tour step shows the guide).
  const handledEditor = useRef(-1);
  useEffect(() => {
    const a = api.current;
    if (!a || restoring.current) return;
    const fresh = editorReq && editorReq.n !== handledEditor.current ? editorReq : null;
    if (editorReq) handledEditor.current = editorReq.n;
    syncEditors(a, fresh?.path ?? null, fresh?.group);
  }, [files, editorReq, syncEditors]);
  const handledPanel = useRef(-1);
  useEffect(() => {
    if (!panelReq || panelReq.n === handledPanel.current || !api.current || restoring.current) return;
    handledPanel.current = panelReq.n;
    doReveal(panelReq.id, panelReq.tour);
  }, [panelReq, doReveal]);

  const shellSync = useCallback(
    (a: DockviewApi) => {
      const fresh = editorReq && editorReq.n !== handledEditor.current ? editorReq : null;
      const want = fresh ? fresh.path : filesRef.current.length ? activePath : null;
      if (editorReq) handledEditor.current = editorReq.n;
      syncEditors(a, want, fresh?.group);
      if (panelReq && panelReq.n !== handledPanel.current) {
        handledPanel.current = panelReq.n;
        doReveal(panelReq.id, panelReq.tour);
      }
    },
    [editorReq, panelReq, activePath, syncEditors, doReveal],
  );

  const closeFileState = useCallback((path: string) => {
    setFiles((fs) => fs.filter((f) => f.path !== path));
    setActivePathState((p) => (p === path ? null : p));
  }, []);

  const closeFile = useCallback(
    (path: string) => {
      closeFileState(path);
      api.current?.getPanel(editorId(path))?.api.close();
    },
    [closeFileState],
  );

  const setActivePath = useCallback((path: string | null) => setActivePathState(path), []);

  /** Open a file at lines (a tour step opens through this one directly). */
  const openFile = useCallback((path: string, start?: number, end?: number, group?: string) => {
    const highlight = toHighlight(start, end);
    setFiles((fs) => (fs.some((f) => f.path === path) ? fs.map((f) => (f.path === path ? { ...f, highlight } : f)) : [...fs, { path, highlight }]));
    setActivePathState(path);
    setEditorReq((r) => ({ path, n: (r?.n ?? 0) + 1, ...(group ? { group } : {}) }));
  }, []);
  /** The user opens a file (a card, a citation, the file tree): if a tour had opened it, it is theirs now. */
  const openAt = useCallback(
    (path: string, start?: number, end?: number) => {
      setTourOwned((o) => claimTab(o, path));
      // Into the group the user was working in (./openTarget.ts). A tour step opens through openFile
      // directly, so the tour's code stays beside the Code tab while the map and the guide play.
      const a = api.current;
      const group = a ? (pickTarget(focusLog.current, groupViews(a), performance.now()) ?? undefined) : undefined;
      openFile(path, start, end, group);
    },
    [openFile],
  );
  // The live debugger stopped in a file (src/ide/debugAt.ts): open it at that line. When a debug first stops,
  // or stops in another file, the Files panel comes forward too and its tree points at the file (FileTree:
  // the folders open, the rail draws, the row lights with the stopped line), as an IDE's project view does.
  // Steps within the same file leave the panels where the user put them.
  const debugFile = useRef<string | null>(null);
  useEffect(
    () =>
      debugAt.subscribe(() => {
        const at = debugAt.get();
        if (!at) return;
        const moved = debugFile.current !== at.path;
        debugFile.current = at.path;
        if (moved) revealPanel("files");
        openAt(at.path, at.line, at.line);
      }),
    [openAt, revealPanel],
  );
  // The previous step's tab, when the tour opened it and nobody has taken it over (its file
  // has already left the open files; this closes its tab in the dock).
  useEffect(() => {
    if (tourClose) api.current?.getPanel(editorId(tourClose.path))?.api.close();
  }, [tourClose]);

  // ── the map ──

  const changeView = useCallback((v: MapViewState) => {
    viewRef.current = v;
    setViewState(v);
    setFocus(null);
  }, []);

  /** Select a card (a node, or a service on the system view) and open its code. */
  const selectNode = useCallback(
    (id: string | null) => {
      setSelected(id);
      setDetail(null);
      if (!id) return;
      const n = nodeById(map, id);
      const s = n ? undefined : map.services.find((x) => x.id === id);
      // The ring on the map comes first; opening the code (a new editor) can
      // follow a frame later without holding the click up.
      startTransition(() => {
        if (n?.file) openAt(n.file, n.line, n.endLine);
        else if (s?.entry) openAt(s.entry.file, s.entry.line, s.entry.line);
        revealPanel("details");
      });
    },
    [map, openAt, revealPanel],
  );

  // The level and the selection follow the URL hash (systems of services only).
  useEffect(() => {
    const onHash = () => {
      const p = parseHash(map, window.location.hash);
      changeView(p?.view ?? defaultView(map));
      if (p?.selected) selectNode(p.selected);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [map, changeView, selectNode]);
  // A deep link is used once: take it out of the address bar.
  useEffect(() => {
    if (parseDeepLink(window.location.search, window.location.hash)) window.history.replaceState(null, "", withoutDeepLink(window.location.href));
  }, []);
  useEffect(() => {
    if (!hasSystem(map)) return;
    const h = `#${hashOf(checkView(map, view), selected)}`;
    if (window.location.hash !== h) window.history.replaceState(null, "", window.location.pathname + window.location.search + h);
  }, [map, view, selected]);

  /** Go to a node or service: switch to the view it is drawn in, select it, and fit on it. */
  const jumpTo = useCallback(
    (id: string) => {
      const dest = viewFor(map, id, viewRef.current);
      const n = nodeById(map, id);
      const target = dest.kind === "system" && n?.internal && n.service ? n.service : id;
      if (JSON.stringify(dest) !== JSON.stringify(viewRef.current)) changeView(dest);
      selectNode(target);
      setMapReveal({ id: target, at: Date.now() });
    },
    [map, changeView, selectNode],
  );

  // A tour step lights its lines and its nodes, and moves to the level they
  // live on. Done while rendering, once per change of step (or of the tour or
  // map under it), rather than in an effect.
  const [shownStep, setShownStep] = useState<{ tour: Tour; step: number; map: CodeMap } | null>(null);
  if (tour && tour.steps[step] && (shownStep?.tour !== tour || shownStep.step !== step || shownStep.map !== map)) {
    const s = tour.steps[step];
    // One code tab for the tour: the step before's file goes when the tour opened it (./tourTabs.ts).
    const sameTour = shownStep?.tour === tour && shownStep.map === map;
    const prevFile = sameTour ? (tour.steps[shownStep.step]?.file ?? null) : null;
    const tabs = tourTabStep({ prev: prevFile, next: s.file, open: files.map((f) => f.path), owned: sameTour ? tourOwned : [] });
    setTourOwned(tabs.owned);
    if (tabs.close) {
      const close = tabs.close;
      setFiles((fs) => fs.filter((f) => f.path !== close));
      setTourClose((c) => ({ path: close, n: (c?.n ?? 0) + 1 }));
    }
    setShownStep({ tour, step, map });
    openFile(s.file, s.start_line, s.end_line);
    const named = s.node_ids.filter((id) => nodeById(map, id));
    const nodes = new Set(named);
    const owner = nodeAt(map, s.file, s.start_line);
    if (owner) nodes.add(owner.id);
    if (tour.change && change) {
      // A change's tour: the whole change stays marked (what changed, what uses it), this step's cards ringed.
      setLit(litOfChange(map, change.plan, [...nodes]));
    } else {
      const edges = new Set(map.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id));
      const services = new Set<string>();
      for (const id of nodes) {
        const sv = nodeById(map, id)?.service;
        if (sv) services.add(sv);
      }
      setLit({ nodes, edges, services });
    }
    // As a tour: an open Settings stays open (./tourTabs.ts).
    revealPanel("guide", "tour");
    if (hasSystem(map)) {
      let next: MapViewState | null = null;
      if (named.length && named.every((id) => id.startsWith("svc-int:") || id.startsWith("svc:"))) {
        if (view.kind !== "system") next = { kind: "system" };
      } else if (view.kind !== "all") {
        const homes = [...nodes].map((id) => nodeById(map, id)?.service).filter((x): x is string => !!x && isOpenable(map.services.find((v) => v.id === x)));
        if (homes.length && (view.kind === "system" || !homes.includes(view.id))) next = { kind: "service", id: homes[0] };
      }
      // viewRef catches up in its effect after this render commits.
      if (next) {
        setViewState(next);
        setFocus(null);
      }
    }
  }

  // Each step's camera (MOTION.md §4.7): a glide to the step's card at a zoom where it can be
  // read, framing the card before it when both fit (src/lib/flythrough.ts focus). After the
  // render that switched the view, so the card is drawn where the camera is going.
  const tourCard = useRef<string | null>(null);
  useEffect(() => {
    const st = shownStep?.tour.steps[shownStep.step];
    if (!shownStep || !st) return;
    const m = shownStep.map;
    const target = st.node_ids.find((id) => nodeById(m, id)) ?? nodeAt(m, st.file, st.start_line)?.id;
    if (!target) return;
    flyThrough.focus(target, shownStep.step > 0 ? tourCard.current : null);
    tourCard.current = target;
  }, [shownStep]);

  // ── the guide ──

  // What is on screen, read at ask time (so the actions below keep their identity across
  // clicks): the guide's context in words, and, on WalkMyCode for Claude's page, the context
  // every bridge request carries (the file and lines, the card, the view, the tour step).
  const askState = useRef({ selected, activePath, files, view, tour, step });
  useEffect(() => {
    askState.current = { selected, activePath, files, view, tour, step };
  }, [selected, activePath, files, view, tour, step]);
  const onScreen = useCallback((): RequestContext => {
    const { selected, activePath, files, view, tour, step } = askState.current;
    const open = activePath ? files.find((f) => f.path === activePath) : undefined;
    const v = checkView(map, view);
    return {
      ...(open ? { file: open.path } : {}),
      ...(open?.highlight ? { lines: { from: open.highlight[0], to: open.highlight[1] } } : {}),
      ...(selected ? { nodeId: selected } : {}),
      ...(tour ? { tourStep: step + 1 } : {}),
      view: v.kind,
      ...(v.kind === "service" ? { service: v.id } : {}),
    };
  }, [map]);
  /** A bridge request with what is on screen (only the MCP page sends it; elsewhere it is not made). */
  const withScreen = useCallback((r: PageRequest): PageRequest | undefined => (MCP ? { ...r, context: onScreen() } : undefined), [onScreen]);

  const contextFor = useCallback(
    (n: MapNode | undefined, extra?: string) => {
      const lines: string[] = [];
      if (n) {
        lines.push(`Selected on the map: ${n.name} [${n.id}] — ${kindWord(n, map)}${n.file ? `, at ${n.file}:${n.line ?? 1}` : ""}.`);
        const { in: ins, out: outs } = edgesOf(map, n.id);
        for (const e of outs.slice(0, 12)) lines.push(`- it ${e.kind} → ${nodeById(map, e.to)?.name ?? e.to} (${e.evidence[0].file}:${e.evidence[0].line}${e.confidence === "likely" ? ", GUESS" : ""}${toldTail(e)})`);
        for (const e of ins.slice(0, 12)) lines.push(`- ${nodeById(map, e.from)?.name ?? e.from} ${e.kind} → it (${e.evidence[0].file}:${e.evidence[0].line}${e.evidence[0].trigger ? `, via the ${e.evidence[0].trigger.element} "${e.evidence[0].trigger.label ?? ""}"` : ""})`);
      }
      if (extra) lines.push(extra);
      return lines.join("\n");
    },
    [map],
  );

  /** What the guide is told about a service: where it runs, how it starts, who it talks to, with lines. */
  const serviceContext = useCallback(
    (s: ServiceDef) => {
      const name = (id: string) => map.services.find((x) => x.id === id)?.name ?? nodeById(map, id)?.name ?? id;
      const lines = [`Selected on the system view: the ${s.name} service [${s.id}] — ${s.kind}${s.framework ? `, ${s.framework}` : ""}${s.areas.length ? `, code in ${s.areas.join(", ")}` : ""}.`];
      if (s.hostnames.length) lines.push(`Hosts: ${s.hostnames.join(", ")}.`);
      if (s.entry) lines.push(`Starts with: ${s.entry.text} (${s.entry.file}:${s.entry.line}).`);
      for (const l of map.system.links.filter((x) => x.from === s.id || x.to === s.id).slice(0, 16)) {
        const e = map.edges.find((x) => x.id === l.edgeIds[0]);
        const ev = e?.evidence.map((v) => `${v.file}:${v.line}`).join(", ");
        lines.push(`- ${name(l.from)} ${l.kind} → ${name(l.to)}${l.count ? ` ×${l.count}` : ""}${ev ? ` (${ev})` : l.note ? ` (${l.note})` : ""}${l.confidence === "likely" ? ", GUESS" : ""}`);
      }
      return lines.join("\n");
    },
    [map],
  );

  const explainSelection = useCallback(
    (sel: Selection) => {
      const owner = nodeAt(map, sel.path, sel.start);
      const numbered = sel.text
        .split("\n")
        .map((l, i) => `${sel.start + i}| ${l}`)
        .join("\n");
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: `Explain ${sel.path}:${sel.start}${sel.end !== sel.start ? `–${sel.end}` : ""}`,
        user: `${contextFor(owner)}\n\nExplain these lines to me (from ${sel.path}:${sel.start}-${sel.end}). Say what they do, who triggers them, and what they reach out to. Read around them if you need to.\n\n${numbered}`,
        request: withScreen({ kind: "explain", payload: { path: sel.path, from: sel.start, to: Math.max(sel.start, sel.end), ...(sel.text.trim() ? { text: sel.text.slice(0, 20_000) } : {}), ...(owner ? { nodeId: owner.id } : {}) } }),
      });
      revealPanel("guide");
    },
    [map, contextFor, revealPanel, withScreen],
  );

  const explainHistory = useCallback(
    (o: { path: string; from: number; shown: string; question: string }) => {
      const owner = nodeAt(map, o.path, o.from);
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: o.shown,
        user: `${contextFor(owner)}\n\n${o.question}`,
        request: withScreen({ kind: "question", payload: { text: o.question.slice(0, 20_000) } }),
      });
      revealPanel("guide");
    },
    [map, contextFor, revealPanel, withScreen],
  );

  const explainNode = useCallback(
    (n: MapNode) => {
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: `What is ${n.name}?`,
        user: `${contextFor(n)}\n\nExplain what ${n.name} is for and how it fits in. Read its code first.`,
        request: withScreen({ kind: "explain", payload: { nodeId: n.id, ...(n.file ? { path: n.file } : {}), ...(n.line ? { from: n.line, to: Math.max(n.line, n.endLine ?? n.line) } : {}) } }),
      });
      revealPanel("guide");
    },
    [contextFor, revealPanel, withScreen],
  );

  const explainService = useCallback(
    (s: ServiceDef) => {
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: `What does the ${s.name} service do?`,
        user: `${serviceContext(s)}\n\nExplain what the ${s.name} service does, how it starts, and how it talks to the other services. Read its entry file first.`,
        request: withScreen({ kind: "explain", payload: { nodeId: s.id, ...(s.entry ? { path: s.entry.file, from: s.entry.line, to: s.entry.line } : {}) } }),
      });
      revealPanel("guide");
    },
    [serviceContext, revealPanel, withScreen],
  );

  const traceNode = useCallback(
    (n: MapNode) => {
      const t = trace(map, n.id);
      // A trace takes the lights over from a fly-through.
      flyThrough.close({ clear: false });
      setLit({ nodes: new Set(t.nodes), edges: new Set(t.edges), services: new Set(t.services), origin: n.id });
      setTour(null);
      // WalkMyCode for Claude: the path lights at once, and Claude walks it out loud.
      const request = withScreen({ kind: "trace", payload: { from: n.id } });
      if (request) {
        setJob({ id: Date.now(), mode: "ask", shown: `Trace ${n.name}`, user: `${contextFor(n)}\n\nTrace where ${n.name} leads, hop by hop.`, request });
        revealPanel("guide");
      }
    },
    [map, contextFor, revealPanel, withScreen],
  );

  // Ending a tour also puts its lights out (MOTION.md §4.7): the glow was the tour's. A change is
  // marked only while its own tour (or the guide's telling of it) is on screen.
  const changeTour = useCallback((t: Tour | null) => {
    if (t) flyThrough.close({ clear: false });
    setTour(t);
    if (!t) setLit(null);
    if (!t?.change) setChange(null);
  }, []);

  const startChange = useCallback(
    (c: TouredChange | null) => {
      if (!c) return changeTour(null);
      flyThrough.close({ clear: false });
      setChange(c);
      setTour(c.tour);
      setStep(0);
      revealPanel("guide");
    },
    [changeTour, revealPanel],
  );

  const explainChange = useCallback(() => {
    if (!change) return;
    const user = storyAsk(change, map);
    setJob({
      id: Date.now(),
      mode: "tour",
      shown: `Explain and review: ${change.label}`,
      user,
      change: change.tour,
      request: withScreen({ kind: "question", payload: { text: user.slice(0, 20_000) } }),
    });
    revealPanel("guide");
  }, [change, map, revealPanel, withScreen]);

  /** "Clear trace" also ends a fly-through, whose lights they are. */
  const changeLit = useCallback((l: Lit | null) => {
    if (!l) flyThrough.close({ clear: false });
    setLit(l);
  }, []);

  const traceSvc = useCallback(
    (s: ServiceDef) => {
      const t = traceService(map, s.id);
      flyThrough.close({ clear: false });
      setLit({ nodes: new Set(t.nodes), edges: new Set(t.edges), services: new Set(t.services) });
      setTour(null);
      const request = withScreen({ kind: "trace", payload: { from: s.id } });
      if (request) {
        setJob({ id: Date.now(), mode: "ask", shown: `Trace the ${s.name} service`, user: `${serviceContext(s)}\n\nTrace how the ${s.name} service talks to the others.`, request });
        revealPanel("guide");
      }
    },
    [map, serviceContext, revealPanel, withScreen],
  );

  const tourNode = useCallback(
    (n: MapNode) => {
      setJob({
        id: Date.now(),
        mode: "tour",
        shown: `Tour: how does ${n.name} work?`,
        user: `${contextFor(n)}\n\nGive me a guided tour of how ${n.name} works, from what the user does, through the request and the logic, to the data.`,
        request: withScreen({ kind: "tour", payload: { topic: `How ${n.name} [${n.id}] works, from what the user does, through the request and the logic, to the data` } }),
      });
      revealPanel("guide");
    },
    [contextFor, revealPanel, withScreen],
  );

  /** "Tour how A talks to B", seeded with the lines behind the link. */
  const tourLinks = useCallback(
    (links: ServiceLink[]) => {
      if (!links.length) return;
      const name = (id: string) => map.services.find((x) => x.id === id)?.name ?? nodeById(map, id)?.name ?? id;
      const a = name(links[0].from);
      const b = name(links[0].to);
      const lines = [`The link on the system view: ${a} → ${b}.`];
      for (const l of links) {
        for (const id of l.edgeIds.slice(0, 12)) {
          const e = map.edges.find((x) => x.id === id);
          if (!e) continue;
          lines.push(`- ${nodeById(map, e.from)?.name ?? e.from} ${e.kind} → ${nodeById(map, e.to)?.name ?? e.to} (${e.evidence.filter((v) => v.role !== "user").map((v) => `${v.file}:${v.line}${v.role === "config" ? " config" : ""}`).join(", ")}${e.confidence === "likely" ? ", GUESS" : ""}${toldTail(e)})`);
        }
      }
      setJob({
        id: Date.now(),
        mode: "tour",
        shown: `Tour: how does ${a} talk to ${b}?`,
        user: `${lines.join("\n")}\n\nGive me a guided tour of how the ${a} service talks to the ${b} service: start at the code in ${a} that sends it, show the config line that points it at ${b} when there is one, and end at the code in ${b} that answers. Say which service each step is in.`,
        request: withScreen({ kind: "tour", payload: { topic: `How the ${a} service talks to the ${b} service: from the code in ${a} that sends it, through the config line that points it at ${b}, to the code in ${b} that answers` } }),
      });
      revealPanel("guide");
    },
    [map, revealPanel, withScreen],
  );

  const askFree = useCallback(
    (question: string, images?: AskImage[]) => {
      const { selected, activePath, files } = askState.current;
      const n = selected ? nodeById(map, selected) : undefined;
      const wantsTour = /^(tour|walk me through|show me how|how does .* work)/i.test(question);
      const open = activePath ? files.find((f) => f.path === activePath) : undefined;
      const looking = open ? `The user is looking at ${open.path}${open.highlight ? `:${open.highlight[0]}` : ""}.` : undefined;
      // To Claude a typed question is a question; it decides whether a tour answers it best.
      // Attached images go with it: to the app's model as image parts, to Claude as images in next_request.
      const pics = images?.length ? images : undefined;
      setJob({ id: Date.now(), mode: pics ? "ask" : wantsTour ? "tour" : "ask", shown: question, user: `${contextFor(n, looking)}\n\n${question}`, request: withScreen({ kind: "question", payload: { text: question.slice(0, 20_000), ...(pics ? { images: pics } : {}) } }), ...(pics ? { images: pics } : {}) });
    },
    [map, contextFor, withScreen],
  );

  // ── change impact (src/lib/impact.ts) ──

  const impactRef = useRef(impactState);
  useEffect(() => {
    impactRef.current = impactState;
  }, [impactState]);
  const showImpact = useCallback(
    (a: { id: string; fn?: string; reach: Reach; light: boolean }) => {
      const l = a.light ? impactLit(map, impactOf(map, a.id, { fn: a.fn }), a.reach) : null;
      if (l) {
        // The impact takes the lights over from a trace, a tour or a fly-through.
        flyThrough.close({ clear: false });
        setTour(null);
        setLit(l);
      } else {
        const was = impactRef.current?.lit;
        setLit((cur) => (cur && cur === was ? null : cur));
      }
      setImpactState({ id: a.id, ...(a.fn ? { fn: a.fn } : {}), reach: a.reach, lit: l });
    },
    [map],
  );

  const impactSelection = useCallback(
    (sel: Selection) => {
      const owner = nodeAt(map, sel.path, sel.start);
      if (!owner) return false;
      const fn = owner.kind === "route" ? undefined : fnAt(map, sel.path, sel.start);
      // Selected without opening its code again: the lines the user picked stay picked.
      setSelected(owner.id);
      setDetail(null);
      showImpact({ id: owner.id, fn, reach: impactRef.current?.reach ?? 2, light: true });
      revealPanel("details");
      return true;
    },
    [map, showImpact, revealPanel],
  );

  const tourImpact = useCallback(
    (a: { id: string; fn?: string; reach: Reach }) => {
      const t = impactTour(map, impactOf(map, a.id, { fn: a.fn, files: repo.files }), a.reach, repo.files);
      if (!t) return;
      changeTour(t);
      setStep(0);
      revealPanel("guide", "tour");
    },
    [map, repo.files, changeTour, revealPanel],
  );

  const explainImpact = useCallback(
    (a: { id: string; fn?: string; reach: Reach }) => {
      const imp = impactOf(map, a.id, { fn: a.fn, files: repo.files });
      const text = `${impactContext(map, imp, a.reach)}

${IMPACT_REQUEST}`;
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: `What could break if I change ${impactName(map, imp)}?`,
        user: text,
        request: withScreen({ kind: "question", payload: { text: text.slice(0, 20_000) } }),
      });
      revealPanel("guide");
    },
    [map, repo.files, revealPanel, withScreen],
  );
  // "Walk an error": the lights the walk put on, so putting it away leaves a later trace's alone.
  const walkLights = useRef<Lit | null>(null);
  const walkError = useCallback(
    (text: string) => {
      const result = walkTrace(text, Object.keys(repo.files));
      const id = Date.now();
      setWalk({ id, text, result });
      // The walk before goes out first, even when this one finds nothing to walk.
      const before = walkLights.current;
      walkLights.current = null;
      if (!result.frames.length) {
        setLit((l) => (l && l === before ? null : l));
        return;
      }
      // The path lights as a trace does: it takes the lights over from a fly-through or a tour.
      const l = walkLit(map, result.frames);
      walkLights.current = l;
      flyThrough.close({ clear: false });
      setTour(null);
      setLit(l);
      const first = result.frames[0];
      openAt(first.file, first.line, first.line);
      // The likely cause is the guide's answer, asked as any question is (so it works through every route).
      const question = causeQuestion(result, repo.files);
      setJob({ id, mode: "ask", walk: id, shown: "What most likely caused this error?", user: question, request: withScreen({ kind: "question", payload: { text: question.slice(0, 20_000) } }) });
    },
    [map, repo.files, openAt, withScreen],
  );
  const endWalk = useCallback(() => {
    setWalk(null);
    setLit((l) => (l && l === walkLights.current ? null : l));
    walkLights.current = null;
  }, []);

  const askWhyHot = useCallback(
    (path: string, commits: string) => {
      const n = map.nodes.find((x) => x.file === path && x.id === askState.current.selected) ?? map.nodes.find((x) => x.file === path);
      const shown = `Why is ${path} a hotspot?`;
      setJob({
        id: Date.now(),
        mode: "ask",
        shown,
        user: `${contextFor(n, commits)}\n\nWhy does ${path} change so often? Read it first. From its code and these commit messages, say in plain words what keeps changing in it and why, citing path:line for each claim, and what to watch for when reviewing or testing it. Say so if the commit messages don't tell.`,
        request: withScreen({ kind: "question", payload: { text: `${shown}\n\n${commits}`.slice(0, 20_000) } }),
      });
      revealPanel("guide");
    },
    [map, contextFor, revealPanel, withScreen],
  );

  const askSpoken = useCallback(
    (question: string, opts?: { continues?: boolean }) => {
      const { selected } = askState.current;
      const n = selected ? nodeById(map, selected) : undefined;
      const continues = !!opts?.continues;
      setJob({
        id: Date.now(),
        mode: "ask",
        shown: `(said) ${question}`,
        user: `${contextFor(n)}\n\n${question}`,
        request: withScreen({ kind: "spoken", payload: { text: question.slice(0, 20_000), ...(continues ? { continues } : {}) } }),
        ...(continues ? { replaces: true } : {}),
      });
      revealPanel("guide");
    },
    [map, contextFor, revealPanel, withScreen],
  );

  const onEdge = useCallback(
    (e: MapEdge) => {
      const ev = e.evidence[0];
      openAt(ev.file, ev.line, ev.line);
      setSelected(e.from);
      setDetail({ kind: "edge", edge: e });
      revealPanel("details");
    },
    [openAt, revealPanel],
  );

  const onLinks = useCallback(
    (links: ServiceLink[]) => {
      if (!links.length) return;
      const first = map.edges.find((e) => e.id === links[0].edgeIds[0])?.evidence[0];
      if (first) openAt(first.file, first.line, first.line);
      setDetail({ kind: "links", links });
      revealPanel("details");
    },
    [map, openAt, revealPanel],
  );

  // ── the fly-through (src/lib/flythrough.ts) ──

  /** Open a file at lines for a hop without taking the tab from the map when the code
   * shares its group (the narrow "stack" layout): the map must stay in view. */
  const openBeside = useCallback(
    (path: string, start?: number, end?: number) => {
      const a = api.current;
      const map = a?.getPanel("map");
      const ed = a?.getPanel(editorId(path)) ?? a?.getPanel("code:home");
      if (map && ed && map.group === ed.group && map.api.isVisible) {
        const highlight = toHighlight(start, end);
        setFiles((fs) => (fs.some((f) => f.path === path) ? fs.map((f) => (f.path === path ? { ...f, highlight } : f)) : [...fs, { path, highlight }]));
        setActivePathState(path);
      } else openAt(path, start, end);
    },
    [openAt],
  );

  // The room as the fly-through sees it, made once and reading the latest state.
  const roomState = useRef({ map, files: repo.files, changeView, openBeside, revealPanel, focus });
  useEffect(() => {
    roomState.current = { map, files: repo.files, changeView, openBeside, revealPanel, focus };
  });
  const [room] = useState<FlyRoom>(() => ({
    map: () => roomState.current.map,
    files: () => roomState.current.files,
    show: (id, wide) => {
      const r = roomState.current;
      const cur = viewRef.current;
      const dest: MapViewState = hasSystem(r.map) ? (wide && cur.kind === "service" ? { kind: "all" } : viewFor(r.map, id, cur)) : { kind: "all" };
      if (JSON.stringify(dest) !== JSON.stringify(cur)) r.changeView(dest);
      else if (r.focus) setFocus(null); // focused on a neighbourhood the card is not in
    },
    light: (l) => setLit(l),
    open: (path, start, end) => startTransition(() => roomState.current.openBeside(path, start, end)),
    select: (id) => {
      const r = roomState.current;
      const dest = viewFor(r.map, id, viewRef.current);
      const n = nodeById(r.map, id);
      const target = dest.kind === "system" && n?.internal && n.service ? n.service : id;
      if (JSON.stringify(dest) !== JSON.stringify(viewRef.current)) r.changeView(dest);
      // The ring now; the code opens when the camera has arrived (flythrough.ts).
      setSelected(target);
      setDetail(null);
      return target;
    },
    tour: (t) => {
      setTour(t);
      setStep(0);
      roomState.current.revealPanel("guide", "tour");
    },
    reveal: () => roomState.current.revealPanel("map"),
  }));
  useEffect(() => flyThrough.attachRoom(room), [room]);

  /** A question from the go-to bar: the guide answers by flying the map, hop by hop. */
  const flyAsk = useCallback(
    (question: string, spoken: boolean) => {
      const id = Date.now();
      // The bar is on screen at once ("finding the way"); the guide's fly_step calls fill it.
      flyThrough.begin({ title: question, live: true, key: id, voice: spoken || undefined });
      const { selected, activePath, files } = askState.current;
      const n = selected ? nodeById(map, selected) : undefined;
      const open = activePath ? files.find((f) => f.path === activePath) : undefined;
      const looking = open ? `The user is looking at ${open.path}${open.highlight ? `:${open.highlight[0]}` : ""}.` : undefined;
      setJob({ id, mode: "ask", fly: true, shown: question, user: `${contextFor(n, looking)}\n\n${FLY_REQUEST}\n\nThe question: ${question}` });
    },
    [map, contextFor],
  );

  const onPick = useCallback(
    (h: Hit) => {
      if (h.kind === "file") openAt(h.id);
      // The map flies there (and falls back to the old jump when it is not mounted yet).
      else if (!flyThrough.flyTo(h.id)) jumpTo(h.id);
    },
    [openAt, jumpTo],
  );

  const onGo = useCallback(
    (go: GoOn, spoken: boolean) => {
      if (go.kind === "path") flyThrough.between(go.from.id, go.to.id, { title: `${go.from.label} → ${go.to.label}`, voice: spoken || undefined });
      else flyAsk(go.question, spoken);
    },
    [flyAsk],
  );

  // ── shell actions and shortcuts ──

  const toggle = useCallback(
    (id: PanelId) => {
      const p = api.current?.getPanel(id);
      if (p && !PANELS[id]?.pinned) p.api.close();
      else doReveal(id);
    },
    [doReveal],
  );

  const commands = useMemo<ShellCommands>(() => {
    const run = (c: Command): boolean | void => {
      const a = api.current;
      switch (c.do) {
        case "palette":
          setPalette({ initial: "" });
          return;
        case "layoutMenu":
          setLayoutMenu(true);
          return;
        case "reset":
          handlers.current?.reset();
          return;
        case "reveal":
          if (!PANELS[c.id]?.available) return false;
          doReveal(c.id as PanelId);
          return;
        case "escape": {
          // Esc stops a fly-through (its path stays drawn); once stopped, Esc puts it away.
          const f = flyThrough.state;
          if (f.status === "idle" || document.querySelector(".palette-wrap, [role='menu']")) break;
          if (f.status === "done") flyThrough.close();
          else flyThrough.stop();
          return;
        }
      }
      if (!a) return false;
      switch (c.do) {
        case "tab":
          return cycleTab(a, c.dir);
        case "group":
          return cycleGroup(a, c.dir);
        case "float":
          return floatGroup(a, a.activeGroup);
        case "popout":
          void popoutGroup(a, a.activeGroup);
          return;
        case "dock":
          return dockGroup(a, a.activeGroup) ? undefined : false;
        case "escape":
          // Escape docks a floating group; anywhere else (or with the search or a menu open) it is left to the page.
          if (a.activeGroup?.api.location.type !== "floating" || document.querySelector(".palette-wrap, [role='menu']")) return false;
          return dockGroup(a, a.activeGroup) ? undefined : false;
        case "maximise":
          return maximiseGroup(a.activeGroup);
        case "resize":
          return resizeGroup(a, c.dx, c.dy);
      }
    };
    const commands: ShellCommands = { run };
    return commands;
  }, [doReveal]);

  useEffect(() => bindKeys(document, commands, { popout: capabilities.popout }), [commands]);

  // "Open settings" from an error on the board, or anywhere else.
  useEffect(() => {
    const onOpen = () => revealPanel("settings");
    window.addEventListener("open-settings", onOpen);
    return () => window.removeEventListener("open-settings", onOpen);
  }, [revealPanel]);

  const shell = useMemo<Shell>(
    () => ({
      api,
      restoring,
      setHandlers: (h) => {
        handlers.current = h;
      },
      commands,
      reveal: revealPanel,
      float: (t = "active") => api.current && floatGroup(api.current, groupOf(api.current, t)),
      popout: async (t = "active") => (api.current ? popoutGroup(api.current, groupOf(api.current, t)) : false),
      dock: (t = "active") => {
        if (api.current) dockGroup(api.current, groupOf(api.current, t));
      },
      maximise: (t = "active") => api.current && maximiseGroup(groupOf(api.current, t)),
      preset: (name) => handlers.current?.applyPreset(name),
      reset: () => handlers.current?.reset(),
      toggle,
      syncEditors: shellSync,
      closeFileState,
      setActivePath,
      presetName,
      setPresetName,
      layoutMenu,
      setLayoutMenu,
      present,
      setPresent,
    }),
    [commands, revealPanel, toggle, shellSync, closeFileState, setActivePath, presetName, layoutMenu, present],
  );

  // Kept while map and view stay: on a map with no services checkView makes a new default view
  // each call, and a new view makes the map lay out every card afresh (a file opening redrew it).
  const shownView = useMemo(() => checkView(map, view), [map, view]);
  // When the map is drawn again (an answer to "Where does this point?"), the arrow or link in
  // Details is looked up afresh by id, so it shows its new evidence.
  const shownDetail = useMemo<Detail>(() => {
    if (!detail) return null;
    if (detail.kind === "edge") {
      const e = indexOf(map).edge.get(detail.edge.id);
      return e === detail.edge ? detail : e ? { kind: "edge", edge: e } : null;
    }
    const links = detail.links.map((l) => map.system.links.find((x) => x.id === l.id) ?? l);
    return links.every((l, i) => l === detail.links[i]) ? detail : { kind: "links", links };
  }, [detail, map]);
  // On while the map's light is the one the impact put there (a trace, a tour or "Clear trace" ends it).
  const shownImpact = useMemo<ImpactAsk | null>(
    () => (impactState ? { id: impactState.id, ...(impactState.fn ? { fn: impactState.fn } : {}), reach: impactState.reach, on: !!impactState.lit && impactState.lit === lit } : null),
    [impactState, lit],
  );
  const value = useMemo<WorkspaceState>(
    () => ({
      repo,
      map,
      repoView,
      view: shownView,
      changeView,
      selected,
      selectNode,
      jumpTo,
      focus,
      setFocus,
      showImports,
      toggleImports: () => setShowImports((v) => !v),
      mapReveal,
      lit,
      setLit: changeLit,
      tour,
      setTour: changeTour,
      step,
      setStep,
      job,
      detail: shownDetail,
      files,
      activePath,
      openAt,
      closeFile,
      onEdge,
      onLinks,
      explainSelection,
      explainHistory,
      explainNode,
      explainService,
      traceNode,
      traceSvc,
      tourNode,
      tourLinks,
      change,
      startChange,
      explainChange,
      askFree,
      impact: shownImpact,
      showImpact,
      impactSelection,
      tourImpact,
      explainImpact,
      askWhyHot,
      askSpoken,
      walk,
      walkError,
      endWalk,
      palette,
      openPalette: (initial) => setPalette({ initial }),
      closePalette: () => setPalette(null),
      onPick,
      onGo,
      shell,
    }),
    [
      repo,
      map,
      repoView,
      shownView,
      changeView,
      selected,
      selectNode,
      jumpTo,
      focus,
      showImports,
      mapReveal,
      lit,
      changeLit,
      tour,
      changeTour,
      step,
      job,
      shownDetail,
      files,
      activePath,
      openAt,
      closeFile,
      onEdge,
      onLinks,
      explainSelection,
      explainHistory,
      explainNode,
      explainService,
      traceNode,
      traceSvc,
      tourNode,
      tourLinks,
      change,
      startChange,
      explainChange,
      askFree,
      shownImpact,
      showImpact,
      impactSelection,
      tourImpact,
      explainImpact,
      askWhyHot,
      askSpoken,
      walk,
      walkError,
      endWalk,
      palette,
      onPick,
      onGo,
      shell,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
