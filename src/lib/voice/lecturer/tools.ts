// The lecturer's functions, run in the page for every lecturer (docs/VOICE.md
// §4.3). UI actions drive the screen through the room's own actions (open a
// file at lines, focus a card, light a trace, step a tour); the read tools are
// the typed guide's (runTool); deep_answer hands the question to the typed
// guide itself, with the provider chosen under Language model, and lights the
// lines it cites as they arrive. Answers are short JSON strings, cut to what a
// voice reply can use.
import type { CodeMap, MapNode } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import { runTool, type RepoView, type Tour } from "@/lib/claude/tools";
import { edgesOf, nodeById, trace } from "@/lib/store";
import type { LecturerSession } from "./session";

/** What the room lends the lecturer: the code, and its own actions. */
export interface LecturerUi {
  repo(): RepoView;
  /** Open a file in the code panel, lighting lines start..end when given. */
  openAt(path: string, start?: number, end?: number): void;
  /** Switch to the level a card is drawn on, select it and centre on it. */
  jumpTo(id: string): void;
  light(l: Lit | null): void;
  tour(): { tour: Tour; step: number } | null;
  setStep(i: number): void;
  /** Carry on the tour narration paused for a question; false when nothing was paused. */
  carryOn(): boolean;
  /** The typed guide's answer to a question, citations and all. */
  ask(question: string, o: { signal: AbortSignal; onCite: (path: string, start: number, end?: number) => void }): Promise<string>;
  /** Run the Code room's code; absent while the Code room has no public way to do that. */
  runCode?: () => Promise<string>;
}

const READ_LIMIT = 6000;
const ANSWER_LIMIT = 4000;
export const WAIT_LINE = "Still reading the code, nearly there.";
export const WAIT_MS = 6000;

const ok = (o: Record<string, unknown> = {}) => JSON.stringify({ ok: true, ...o });
const err = (error: string) => JSON.stringify({ ok: false, error });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const int = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/** A path as the repo has it: exact, else the one file that ends with it. */
export function resolvePath(repo: RepoView, raw: string): { path: string } | { error: string } {
  const p = raw.replace(/^\.?\/+/, "");
  if (!p) return { error: "Give a file path." };
  if (repo.files[p] !== undefined) return { path: p };
  const ends = Object.keys(repo.files).filter((f) => f === p || f.endsWith(`/${p}`));
  if (ends.length === 1) return { path: ends[0] };
  const near = (ends.length ? ends : Object.keys(repo.files).filter((f) => f.includes(p))).slice(0, 5);
  return { error: `No such file: ${p}${near.length ? `. Did you mean: ${near.join(", ")}` : ""}` };
}

/** A card from what the lecturer said: a node id, a file path, else a name (exact, then partial). */
export function findNode(map: CodeMap, q: string): MapNode | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  return (
    nodeById(map, t) ??
    nodeById(map, `file:${t}`) ??
    map.nodes.find((n) => n.file === t) ??
    map.nodes.find((n) => n.file?.endsWith(`/${t}`)) ??
    map.nodes.find((n) => n.name.toLowerCase() === lower) ??
    map.nodes.find((n) => n.name.toLowerCase().includes(lower) || n.path?.toLowerCase().includes(lower))
  );
}

/**
 * The shortest way between two cards: along the arrows first, then against
 * them, then either way; null when they are not connected within 12 steps.
 */
export function pathBetween(map: CodeMap, from: string, to: string): { nodes: string[]; edges: string[] } | null {
  if (from === to) return { nodes: [from], edges: [] };
  const walk = (dir: "out" | "in" | "both") => {
    const prev = new Map<string, { node: string; edge: string }>();
    const seen = new Set([from]);
    let frontier = [from];
    for (let depth = 0; depth < 12 && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const e = edgesOf(map, id);
        const steps = [...(dir !== "in" ? e.out.map((x) => [x.to, x.id] as const) : []), ...(dir !== "out" ? e.in.map((x) => [x.from, x.id] as const) : [])];
        for (const [n, edge] of steps) {
          if (seen.has(n)) continue;
          seen.add(n);
          prev.set(n, { node: id, edge });
          if (n === to) {
            const nodes = [to];
            const edges: string[] = [];
            for (let at = to; at !== from; ) {
              const p = prev.get(at)!;
              edges.unshift(p.edge);
              nodes.unshift(p.node);
              at = p.node;
            }
            return { nodes, edges };
          }
          next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  };
  return walk("out") ?? walk("in") ?? walk("both");
}

/** Run one of the lecturer's functions; the answer is a string for the agent. */
export async function runLecturerTool(ui: LecturerUi, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const repo = ui.repo();
  switch (name) {
    case "highlight_lines": {
      const r = resolvePath(repo, str(args.path));
      if ("error" in r) return err(r.error);
      const total = repo.files[r.path].split("\n").length;
      const from = Math.min(Math.max(1, int(args.from) ?? 1), total);
      const to = Math.min(Math.max(from, int(args.to) ?? from), total);
      ui.openAt(r.path, from, to);
      return ok({ showing: `${r.path}:${from}-${to}` });
    }
    case "open_file": {
      const r = resolvePath(repo, str(args.path));
      if ("error" in r) return err(r.error);
      const line = int(args.line);
      if (line) ui.openAt(r.path, line, line);
      else ui.openAt(r.path);
      return ok({ open: line ? `${r.path}:${line}` : r.path });
    }
    case "focus_map_node": {
      const n = findNode(repo.map, str(args.id));
      if (!n) return err(`Nothing on the map matches "${str(args.id)}". Try query_map first.`);
      ui.jumpTo(n.id);
      return ok({ focused: n.id, name: n.name, kind: n.kind, ...(n.file ? { file: `${n.file}:${n.line ?? 1}` } : {}) });
    }
    case "trace_path": {
      const a = findNode(repo.map, str(args.from));
      if (!a) return err(`Nothing on the map matches "${str(args.from)}".`);
      const b = str(args.to) ? findNode(repo.map, str(args.to)) : undefined;
      if (str(args.to) && !b) return err(`Nothing on the map matches "${str(args.to)}".`);
      const way = b ? pathBetween(repo.map, a.id, b.id) : null;
      const lit = way ?? trace(repo.map, a.id);
      const services = new Set<string>();
      for (const id of lit.nodes) {
        const s = nodeById(repo.map, id)?.service;
        if (s) services.add(s);
      }
      ui.light({ nodes: new Set(lit.nodes), edges: new Set(lit.edges), services, origin: a.id });
      const names = lit.nodes.slice(0, 12).map((id) => nodeById(repo.map, id)?.name ?? id);
      return way ? ok({ path: names, steps: way.edges.length }) : ok({ note: b ? `No path from ${a.name} to ${b.name}; lit everything ${a.name} reaches instead.` : `Lit everything ${a.name} reaches.`, lit: names });
    }
    case "next_step": {
      const t = ui.tour();
      if (!t) return err("No tour is open. Ask for a tour first.");
      if (t.step >= t.tour.steps.length - 1) return err("That was the last step of the tour.");
      const i = t.step + 1;
      ui.setStep(i);
      const s = t.tour.steps[i];
      return ok({ step: i + 1, of: t.tour.steps.length, says: s.say, file: `${s.file}:${s.start_line}-${s.end_line}` });
    }
    case "continue_tour":
      return ui.carryOn() ? ok({ carrying_on: true }) : err(ui.tour() ? "The tour is not paused for a question; it is already where the user left it." : "No tour is open.");
    case "run_code":
      if (!ui.runCode) return err("Running code is not available yet: the Code room has no way to be started from here. Say so plainly.");
      return (await ui.runCode()).slice(0, READ_LIMIT);
    case "deep_answer": {
      const q = str(args.question);
      if (!q) return err("Give the question to answer.");
      const text = await ui.ask(q, { signal, onCite: (path, start, end) => ui.openAt(path, start, end) });
      return ok({ answer: text.slice(0, ANSWER_LIMIT) });
    }
    case "read_file":
    case "search":
    case "query_map":
      return runTool(repo, name, args).slice(0, READ_LIMIT);
    default:
      return err(`Unknown function ${name}.`);
  }
}

// The citations the guide writes (Guide.tsx), to light up as an answer streams in.
const CITE = /`?((?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|py|sql|prisma|mjs|cjs|mts|dart|go|rs|java|kt|rb|php|cs))(?::(\d+)(?:\s*[-–]\s*(\d+))?)?`?/g;

/** Every path:line citation in a text, in order (paths without a line are left out). */
export function citations(text: string): { path: string; start: number; end?: number }[] {
  const out: { path: string; start: number; end?: number }[] = [];
  for (const m of text.matchAll(CITE)) if (m[2]) out.push({ path: m[1], start: Number(m[2]), ...(m[3] ? { end: Number(m[3]) } : {}) });
  return out;
}

/**
 * Feed a growing answer in; each citation that appears (and is a real file)
 * is passed on once, as it arrives. A citation at the very end of the text so
 * far may still be growing ("cart.ts:1" before "cart.ts:12"), so it waits for
 * the next character.
 */
export function citationFeed(repo: () => RepoView, onCite: (path: string, start: number, end?: number) => void): (soFar: string) => void {
  let done = 0;
  return (soFar) => {
    const all = citations(soFar.replace(/\S*$/, ""));
    for (const c of all.slice(done)) {
      const r = resolvePath(repo(), c.path);
      if ("path" in r) onCite(r.path, c.start, c.end);
    }
    done = Math.max(done, all.length);
  };
}

/**
 * The shared dispatcher: answers a session's function calls with
 * runLecturerTool, drops the ones it cancels (their work is aborted and their
 * answer never sent), and covers a slow deep_answer with one spoken line where
 * the lecturer can be told to say something.
 */
export function attachTools(session: LecturerSession, ui: LecturerUi, o: { waitMs?: number; onCall?: (name: string, args: Record<string, unknown>) => void } = {}): () => void {
  const running = new Map<string, AbortController>();
  const off = session.on((e) => {
    if (e.type === "functionCall") {
      const ac = new AbortController();
      running.set(e.id, ac);
      o.onCall?.(e.name, e.args);
      const wait = e.name === "deep_answer" ? setTimeout(() => !ac.signal.aborted && session.inject(WAIT_LINE), o.waitMs ?? WAIT_MS) : undefined;
      void runLecturerTool(ui, e.name, e.args, ac.signal)
        .catch((x: unknown) => err((x as Error)?.message || "The function failed."))
        .then((content) => {
          clearTimeout(wait);
          if (ac.signal.aborted || running.get(e.id) !== ac) return;
          running.delete(e.id);
          session.respond(e.id, e.name, content);
        });
    } else if (e.type === "cancelled") {
      for (const id of e.ids) {
        running.get(id)?.abort();
        running.delete(id);
      }
    } else if (e.type === "close") {
      for (const ac of running.values()) ac.abort();
      running.clear();
    }
  });
  return () => {
    off();
    for (const ac of running.values()) ac.abort();
    running.clear();
  };
}
