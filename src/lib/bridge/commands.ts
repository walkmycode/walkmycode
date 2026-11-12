// What WalkMyCode for Claude's page does with each of Claude's commands (docs/MCP.md
// §3), on the Explore room's own actions: focus a card, open a file at lines,
// light a path, play a tour, switch the view, and light what an answer cites.
// Pure over the small PageUi below, so tests run it against a real map with a
// fake room. Each returns the note the page acknowledges with; a command the
// page cannot carry out throws, and the error goes back to Claude as the reason.
// (`answer` text, `narrate` and `workspace` are handled elsewhere: the Guide,
// the narration queue and the page host.)
import type { CodeMap } from "@/analyzer/types";
import type { MapViewState } from "@/components/mapLayout";
import type { Lit } from "@/components/mapHighlight";
import type { Tour } from "@/lib/claude/tools";
import { flyThrough } from "@/lib/flythrough";
import { nodeAt, nodeById } from "@/lib/store";
import type { Command } from "./protocol";

/** The room as the commands drive it (WorkspaceProvider's own actions). */
export interface PageUi {
  map: CodeMap;
  files: Record<string, string>;
  /** Switch to the level a card is drawn on, select it and fit on it. */
  jumpTo(id: string): void;
  /** Open a file in the code panel, lines start..end lit when given. */
  openAt(path: string, start?: number, end?: number): void;
  setLit(l: Lit | null): void;
  setTour(t: Tour | null): void;
  setStep(i: number): void;
  tour(): Tour | null;
  changeView(v: MapViewState): void;
  /** Bring a panel to the front (the guide for a tour or an answer). `why: "tour"` for a
   * playing tour, which gives way to an open Settings rather than hide it. */
  reveal(panel: "guide" | "map" | "details", why?: "tour"): void;
  /** The requests Claude has taken and not answered yet (the one a tour belongs to is among them). */
  working(): string[];
}

/** A tour as the Guide plays it, from Claude's start_tour. Claude's tours start playing by themselves. */
export function tourOf(c: Extract<Command, { name: "start_tour" }>, requests: string[] = []): Tour {
  return {
    title: c.title,
    steps: c.steps.map((s) => ({ say: s.say, file: s.file, start_line: s.from, end_line: Math.max(s.from, s.to), node_ids: s.nodeIds })),
    autoplay: true,
    ...(requests.length ? { requests } : {}),
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Cards and arrows to light: the given cards, the arrows between them, and the services they are in. */
export function litOf(map: CodeMap, nodeIds: Iterable<string>, edgeIds?: Iterable<string>, origin?: string): Lit {
  const nodes = new Set([...nodeIds].filter((id) => nodeById(map, id) || map.services.some((s) => s.id === id)));
  const edges = new Set(edgeIds ?? map.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id));
  const services = new Set<string>();
  for (const id of nodes) {
    const s = nodeById(map, id)?.service ?? (map.services.some((x) => x.id === id) ? id : undefined);
    if (s) services.add(s);
  }
  return { nodes, edges, services, ...(origin ? { origin } : {}) };
}

function needFile(ui: PageUi, path: string): number {
  const text = ui.files[path];
  if (text === undefined) throw new Error(`${path} isn't in the workspace on the page. Reload the page if another folder was just opened.`);
  return text.split("\n").length;
}

/** Carry out one of Claude's page commands; the note to acknowledge it with. */
export function applyCommand(ui: PageUi, c: Command): string {
  const { map } = ui;
  switch (c.name) {
    case "focus_node": {
      const n = nodeById(map, c.nodeId);
      const s = n ? undefined : map.services.find((x) => x.id === c.nodeId);
      if (n || s) {
        // The fly-through glides there when a map is attached; otherwise jump as before.
        ui.reveal("map");
        if (!flyThrough.flyTo(c.nodeId)) ui.jumpTo(c.nodeId);
        return `Showing ${n?.name ?? `the ${s!.name} service`}.`;
      }
      if (c.path && ui.files[c.path] !== undefined) {
        ui.openAt(c.path);
        return `${c.nodeId} isn't on this map; opened ${c.path} instead.`;
      }
      throw new Error(`No card ${c.nodeId} on the page's map.`);
    }
    case "open_file": {
      const lines = needFile(ui, c.path);
      const line = c.line ? Math.min(c.line, lines) : undefined;
      ui.openAt(c.path, line, line);
      return `Opened ${c.path}${line ? ` at line ${line}` : ""}.`;
    }
    case "highlight_lines": {
      const lines = needFile(ui, c.path);
      const from = Math.min(c.from, lines);
      const to = Math.min(Math.max(from, c.to), lines);
      ui.openAt(c.path, from, to);
      return `Lit ${c.path}:${from}-${to}.`;
    }
    case "trace_path": {
      const lit = litOf(map, c.nodeIds, c.edgeIds.length ? c.edgeIds : undefined, c.from);
      if (!lit.nodes.size) throw new Error("None of the path's cards are on the page's map.");
      ui.setTour(null);
      ui.reveal("map");
      // Fly it hop by hop (camera, then the light, then the code) when a map is attached;
      // otherwise light the whole path at once, as before.
      const flown = flyThrough.path(c.nodeIds, c.edgeIds, {});
      if (flown.ok && flown.shown > 0) {
        const extra = [flown.gaps ? plural(flown.gaps, "gap") : "", flown.refused.length ? `${plural(flown.refused.length, "step")} left out (not on the map)` : ""].filter(Boolean).join(", ");
        return `Flying ${plural(flown.shown, "hop")} on the map${extra ? ` (${extra})` : ""}.`;
      }
      ui.setLit(lit);
      if (nodeById(map, c.from)) ui.jumpTo(c.from);
      return `Lit ${plural(lit.nodes.size, "card")} and ${plural(lit.edges.size, "arrow")}.`;
    }
    case "start_tour": {
      if (!c.steps.length) throw new Error("A tour needs at least one step.");
      const t = tourOf(c, ui.working());
      ui.setTour(t);
      ui.setStep(0);
      // The Guide comes forward unless the user has Settings open there: then the tour plays without it.
      ui.reveal("guide", "tour");
      return `Playing "${t.title}", ${plural(t.steps.length, "step")}, aloud.`;
    }
    case "tour_step": {
      const t = ui.tour();
      if (!t) throw new Error("No tour is on the page: start_tour first.");
      if (c.n < 1 || c.n > t.steps.length) throw new Error(`The tour on the page has ${plural(t.steps.length, "step")}.`);
      ui.setStep(c.n - 1);
      ui.reveal("guide", "tour");
      return `On step ${c.n} of ${t.steps.length}.`;
    }
    case "new_project": {
      // Only ever the form, filled in: making it is the user's own click.
      // What it should do rides along, so the guide offers to build it once it's open.
      void import("@/ide/localrun/setup/store").then(({ openNewProject }) => openNewProject({ starter: c.starter, name: c.projectName, ...(c.brief ? { brief: c.brief } : {}) }));
      return `The "New project" form is open on the page with ${c.starter} and "${c.projectName}"${c.brief ? " and what it should do" : ""} filled in: the user presses Make it to start.`;
    }
    case "show_view": {
      if (c.view === "service") {
        if (!c.service || !map.services.some((s) => s.id === c.service)) throw new Error(`No service ${c.service ?? ""} on the page's map.`);
        ui.changeView({ kind: "service", id: c.service });
      } else ui.changeView({ kind: c.view });
      ui.reveal("map");
      return `Showing the ${c.view === "all" ? "whole map" : c.view === "system" ? "system view" : `${c.service} lanes`}.`;
    }
    case "answer": {
      // The text is the Guide's; here its citations light up: the first one opens, every cited card glows.
      // A tour on the board would hide the answer to a question asked since: that question is newer, so the
      // tour ends. The answer to the request the tour itself belongs to ("here is your tour") leaves it playing.
      const t = ui.tour();
      if (t && c.requestId && !(t.requests ?? []).includes(c.requestId)) ui.setTour(null);
      const cited = c.citations.filter((x) => ui.files[x.path] !== undefined);
      ui.reveal("guide");
      if (!cited.length) return "Shown in the Guide.";
      const owners = new Set<string>();
      for (const x of cited) {
        const n = nodeAt(map, x.path, x.from);
        if (n) owners.add(n.id);
      }
      if (owners.size) ui.setLit(litOf(map, owners));
      ui.openAt(cited[0].path, cited[0].from, cited[0].to);
      return `Shown in the Guide, ${plural(cited.length, "citation")} lit.`;
    }
    case "narrate":
    case "workspace":
      return "";
  }
}
