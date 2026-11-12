"use client";
// The Explore room: the top bar, and under it one dock of panels (map, code,
// guide, details, files, settings) the user can split, tab, float, pop out
// and resize (docs/SHELL.md). A system of services has levels: the system
// (one card per service), one service's lanes, and the code. The level lives
// in the URL hash so a reload comes back to the same place; /map?focus= and
// /map?node= open a file or a card directly.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { RoomLink, useGoReplace } from "@/lib/adapters/nav";
import type { CodeMap } from "@/analyzer/types";
import { isOpenable } from "@/components/mapLayout";
import Palette from "@/components/Palette";
import ModelBadge from "@/components/ModelBadge";
import TopBar from "@/components/TopBar";
import { restoreRepo, useRepo, useWorkspace } from "@/lib/store";
import CostMeter from "@/components/CostMeter";
import { MCP, TARGET } from "@/lib/adapters/target";
import { pickSettings, pickVoice } from "@/lib/adapters/select";
import { useAiRoute } from "@/lib/adapters/useAiRoute";
import WorkspaceProvider, { useShell } from "@/shell/WorkspaceProvider";
import LayoutMenu from "@/shell/LayoutMenu";
import { PANELS } from "@/shell/panels";
import TerminalButton from "@/ide/localrun/TerminalButton";
import SetupPill from "@/ide/localrun/setup/SetupPill";
import SourceControl from "@/ide/localrun/git/SourceControl";
import { useStack } from "@/components/StackChips";
import ProjectChip, { type Metric } from "@/components/ProjectChip";
import Toast from "@/shell/Toast";

// WalkMyCode for Claude: Claude drives the room through the bridge, and the bar says whether Claude is listening.
const BridgeDriver = MCP ? dynamic(() => import("@/components/mcp/BridgeDriver"), { ssr: false }) : () => null;
const ClaudeStatus = MCP ? dynamic(() => import("@/components/mcp/ClaudeStatus"), { ssr: false }) : () => null;
// …and says it louder, in a strip under the bar, when Claude stopped listening or the server is gone.
const ClaudeAlert = MCP ? dynamic(() => import("@/components/mcp/ClaudeAlert"), { ssr: false }) : () => null;

// dockview is browser-only; the page is a Client Component, so ssr:false is allowed here.
// Its code is asked for as the room mounts, alongside the saved map being read, not only
// once the map is in (in Lite each wave of chunks costs seconds). Until the dock has laid
// out its panels, DockWait shows the lantern's glow where they will be.
const Workspace = dynamic(() => import("@/shell/Workspace"), { ssr: false, loading: () => null });
const loadWorkspace = () => import("@/shell/Workspace");

/** The room's loading state: the lantern's glow and a line, centred. */
function Wait({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `map-wait ${className}` : "map-wait"} role="status" aria-live="polite">
      <div>
        <span className="glow" aria-hidden="true" />
        <p>{text}</p>
      </div>
    </div>
  );
}

/** Under the top bar until the dock has its panels (then it fades), so the room never shows an empty space. */
function DockWait() {
  const ready = useShell().shell.present.length > 0;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 300);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return <Wait text="Opening the map…" className={ready ? "in-dock leaving" : "in-dock"} />;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// WalkMyCode Lite answers on the viewer's Claude plan: there is no cost to count.
const SETTINGS = pickSettings(TARGET);
/** The go-to bar's mic: where the app listens (never in Lite, whose frame blocks the microphone). */
const VOICE = pickVoice(TARGET);

/** Library areas next to the one app of a monorepo (its areas, or everything but the entry's area). */
function sharedPackages(map: CodeMap): number {
  const app = map.services.find((s) => s.kind === "app");
  if (!app) return 0;
  if (app.areas.length < map.areas.length) return map.areas.length - app.areas.length;
  const entryArea = map.files.find((f) => f.path === app.entry?.file)?.area;
  return entryArea ? map.areas.filter((a) => a !== entryArea).length : 0;
}

/** The numbers in the project card (ProjectChip), and the line under them. */
function projectFacts(map: CodeMap): { metrics: Metric[]; note?: string } {
  const metrics: Metric[] = [];
  if (map.repos.length > 1) metrics.push({ n: map.repos.length, label: map.repos.length === 1 ? "repo" : "repos" });
  if (map.system.kind === "services") {
    const apps = map.services.filter((s) => s.kind === "app").length;
    metrics.push({ n: apps, label: apps === 1 ? "service" : "services" });
  }
  metrics.push(
    { n: map.stats.parsed, label: map.stats.parsed === 1 ? "file" : "files" },
    { n: map.stats.routes, label: map.stats.routes === 1 ? "route" : "routes" },
    { n: map.stats.tables, label: map.stats.tables === 1 ? "table" : "tables" },
    { n: map.stats.edges, label: map.stats.edges === 1 ? "link" : "links" },
  );
  const shared = map.system.kind === "monorepo" ? sharedPackages(map) : 0;
  const guesses = map.stats.likely ? `${plural(map.stats.likely, "link")} ${map.stats.likely === 1 ? "is a guess" : "are guesses"}, drawn dashed on the map.` : "";
  const note = [shared ? `One app + ${plural(shared, "shared package")}.` : "", guesses].filter(Boolean).join(" ");
  return { metrics, note: note || undefined };
}

/** Everything about the map in one line: today's for one app, with repos and services for a system. */
function headerLine(map: CodeMap, name: string): string {
  const tail = `${map.stats.parsed} files · ${map.stats.routes} routes · ${map.stats.tables} tables · ${map.stats.edges} links (${map.stats.likely} guesses)`;
  if (map.system.kind === "services") {
    const apps = map.services.filter((s) => s.kind === "app").length;
    return `${name} · ${plural(map.repos.length, "repo")} · ${plural(apps, "service")} · ${tail}`;
  }
  // Several folders mapped together as one app still say how many.
  const line = map.repos.length > 1 ? `${name} · ${plural(map.repos.length, "repo")} · ${tail}` : `${name} · ${tail}`;
  if (map.system.kind === "monorepo") {
    const n = sharedPackages(map);
    return n ? `${line} · one app + ${plural(n, "shared package")}` : line;
  }
  return line;
}

function MapTop() {
  const s = useShell();
  const workspace = useWorkspace();
  const { map, view, lit, tour } = s;
  // "The trace continues in orders service →" when a trace leaves the service on screen.
  const elsewhere = lit?.services && view.kind === "service" ? map.services.find((x) => lit.services!.has(x.id) && x.id !== view.id && isOpenable(x)) : undefined;
  const traceHere = view.kind === "service" && !!lit?.services?.has(view.id);
  const name = s.repo.source.label;
  const stack = useStack(map, workspace?.name ?? name);
  const facts = projectFacts(map);
  return (
    <TopBar
      title={<ProjectChip name={name} stack={stack} metrics={facts.metrics} note={facts.note} summary={headerLine(map, name)} />}
      // Who answers, and the gear: both open the Settings tab of the dock.
      ai={SETTINGS.providers ? { onSettings: () => s.shell.reveal("settings") } : undefined}
      // WalkMyCode for Claude has no pill (the user's own Claude answers) but keeps the
      // gear, so Settings isn't only behind Layout ▾.
      gear={MCP ? { onSettings: () => s.shell.reveal("settings"), shortcut: `Alt+${PANELS.settings.shortcut}` } : undefined}
      // A map without its code says so on the map itself (MapPanel's banner), not up here.
      notice={
        workspace?.needsReindex && (
          <span className="note" title="Its services and config files are only read by the current analyzer">
            Made by an older WalkMyCode: open the folder again to update it.
          </span>
        )
      }
      status={
        (MCP || elsewhere || (lit && !tour)) && (
          <>
            {MCP && <ClaudeStatus />}
            {elsewhere && (
              <button className="ctl compact" onClick={() => s.changeView({ kind: "service", id: elsewhere.id })}>
                Trace {traceHere ? "continues" : "is"} in {elsewhere.name} →
              </button>
            )}
            {lit && !tour && (
              <button className="ctl compact" onClick={() => s.setLit(null)}>
                Clear trace
              </button>
            )}
          </>
        )
      }
    >
      <SetupPill />
      <SourceControl />
      <TerminalButton />
      <LayoutMenu />
      {/* WalkMyCode Lite keeps its "Your Claude" badge; the app has the AI pill instead, and
          WalkMyCode for Claude its "Claude is listening" pill, which names the AI app too. */}
      {!SETTINGS.providers && !MCP && <ModelBadge onOpen={() => s.shell.reveal("settings")} />}
      {SETTINGS.costMeter && <CostMeter />}
      <RoomLink href="/" className="ctl compact" title="Back to the folders this map is made of: add, remove or refresh one and map again">
        Folders
      </RoomLink>
    </TopBar>
  );
}

/** The go-to bar (Ctrl+K): names fly the map at once; questions go to the guide, which flies it. */
function PaletteHost() {
  const s = useShell();
  // "none" only in WalkMyCode Lite opened outside Claude: nothing can answer a question there.
  const route = useAiRoute();
  if (!s.palette) return null;
  return <Palette map={s.map} initial={s.palette.initial} onClose={s.closePalette} onPick={s.onPick} onGo={s.onGo} canAsk={route !== "none"} mic={VOICE.microphone} />;
}

export default function MapPage() {
  const repo = useRepo();
  const workspace = useWorkspace();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadWorkspace().catch(() => undefined);
    restoreRepo().finally(() => setReady(true));
  }, []);

  // Nothing open: the home is where a map starts, so go there rather than show an empty room.
  const goHome = useGoReplace();
  useEffect(() => {
    if (ready && !repo) goHome("/");
  }, [ready, repo, goHome]);

  if (!ready || !repo) return <Wait text={ready ? "No map open yet — taking you to your folders…" : "Opening the map…"} />;

  return (
    // A different workspace starts the room afresh (selection, open files).
    <WorkspaceProvider key={workspace?.id ?? "repo"} repo={repo}>
      <BridgeDriver />
      <MapTop />
      <ClaudeAlert />
      <main className="shell">
        <Workspace />
        <DockWait />
      </main>
      <PaletteHost />
      <Toast />
    </WorkspaceProvider>
  );
}
