// The fly-through (docs/PLAN.md "Fly-through"): say or type where to go and the
// map travels there live. The camera glides card to card, the light runs along
// each real arrow, the code opens at the cited lines and the narrator reads
// each hop. Steps come one at a time (the guide's fly_step calls, as they run)
// or all at once (a path); either way each hop plays as soon as it is here and
// the one before has finished, and the finished path stays drawn.
//
// ── The API, for any code that wants the map to move ──────────────────────────
//
//   import { flyThrough } from "@/lib/flythrough";
//
//   flyThrough.flyTo(id)                 Glide to one card (a node id, or a service id on the
//                                        system view), select it and open its code. Returns
//                                        false when no map is open or the id is not on it.
//   flyThrough.focus(id, from?)          Only the camera: glide to a card at a readable zoom
//                                        (framing `from` too when both fit), selecting nothing
//                                        and opening nothing. A tour step uses it.
//   flyThrough.play(steps, { title?, voice? })
//                                        Fly a whole path: steps are { node, via_edge?, say?,
//                                        file?, lines? } (lines [start, end]). Every step is
//                                        checked against the map like the guide's fly_step:
//                                        refused ones are left out and listed in the result
//                                        ({ shown, refused: [{ index, error }], gaps }).
//   flyThrough.path(nodeIds, edgeIds?, { title?, voice? })
//                                        The same for a path given as ids (Claude's trace_path):
//                                        edgeIds[i] is the arrow from nodeIds[i] to nodeIds[i+1].
//   flyThrough.between(fromId, toId, o?) The real arrows from one card to another, flown; a gap
//                                        when the map does not join them.
//   flyThrough.pause() resume() toggle() next() back() replay() goto(i)
//   flyThrough.stop()                    Esc: stop moving and speaking; the path so far stays drawn.
//   flyThrough.close()                   Put the path out and hide the bar.
//   flyThrough.saveAsTour()              Turn the path into a normal tour (the guide's tour player).
//   flyThrough.state / subscribe(fn)     What the bar shows (FlyState).
//
// The room (WorkspaceProvider) and the map (MapView) attach themselves; until a
// map is open, calls return false and nothing moves. No React or DOM here: the
// room, the camera and the voice are handed in, so the tests run it in Node.
import type { CodeMap } from "@/analyzer/types";
import type { Lit } from "@/components/mapHighlight";
import type { Tour } from "./claude/tools";
import { checkStep, findPath, stepsForPath, type FlyStep, type FlyStepInput } from "./flyPath";
import { indexOf } from "./mapIndex";
import { CAMERA_MS, FLY_HOP_MS, motionOff } from "./motion";
import { readPref, removePref } from "./prefs";

export type { FlyStep, FlyStepInput } from "./flyPath";
export { CAMERA_MS, FLY_HOP_MS };

// ── timing ──

/** Added to the first hop's stay on screen (motion on). */
export const FIRST_STOP_MS = 500;

/** How long a camera move takes: CAMERA_MS, or nothing at all when motion is off. */
export function flyDuration(off: boolean, ms = CAMERA_MS): number {
  return off ? 0 : ms;
}

/** How long a hop stays on screen before the next one, when nothing is read aloud: long
 * enough to see the ride land and read the sentence; with the voice on, the narrator
 * decides and this is only the shortest. */
export function dwellMs(say: string, voice: boolean, off: boolean): number {
  const motion = off ? 0 : CAMERA_MS + FLY_HOP_MS;
  if (voice) return Math.max(motion, 500);
  const words = say.trim() ? say.trim().split(/\s+/).length : 0;
  return Math.max(motion, Math.min(2600, 600 + words * 120));
}

// ── the camera's target ──

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The viewport: its size on screen and React Flow's transform (screen = flow * zoom + x/y). */
export interface Viewport {
  width: number;
  height: number;
  x: number;
  y: number;
  zoom: number;
}
export const CAMERA = {
  /** Zoomed out past this, a card's labels cannot be read: the camera zooms in to it. At 0.6
   * a tour step landed on a card too small to read; a user zoomed in further keeps their zoom. */
  minZoom: 0.95,
  /** Zoomed in past this, the next card is soon off screen: the camera zooms out to it. */
  maxZoom: 1.25,
  /** Room kept around the cards, in screen px. */
  pad: 64,
  /** A move shorter than this share of the viewport is not worth making. */
  still: 0.12,
};

/**
 * Where the camera goes for a hop: the card arrived at, framed with the card it
 * came from when both fit at a readable zoom (so the arrow travelled is in view),
 * centred; the zoom kept unless the cards would be too small or too large.
 * Null when the view already shows them well (a still camera is calmer).
 */
export function cameraTarget(to: Rect, from: Rect | null, v: Viewport, o = CAMERA): { x: number; y: number; zoom: number } | null {
  let zoom = Math.min(o.maxZoom, Math.max(o.minZoom, v.zoom));
  let box = to;
  if (from) {
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const u = { x, y, width: Math.max(from.x + from.width, to.x + to.width) - x, height: Math.max(from.y + from.height, to.y + to.height) - y };
    const fit = Math.min((v.width - 2 * o.pad) / u.width, (v.height - 2 * o.pad) / u.height);
    if (fit >= o.minZoom) {
      box = u;
      zoom = Math.min(zoom, fit);
    }
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (zoom === v.zoom) {
    // Already in view, with room around it, and near the middle: stay.
    const left = box.x * zoom + v.x;
    const top = box.y * zoom + v.y;
    const inside = left >= o.pad && top >= o.pad && left + box.width * zoom <= v.width - o.pad && top + box.height * zoom <= v.height - o.pad;
    const dx = Math.abs(cx * zoom + v.x - v.width / 2);
    const dy = Math.abs(cy * zoom + v.y - v.height / 2);
    if (inside && dx <= v.width * o.still && dy <= v.height * o.still) return null;
  }
  return { x: cx, y: cy, zoom };
}

/** cubic-bezier(.22, 1, .36, 1), --ease-settle: a long tail, no overshoot. */
export function easeSettle(t: number): number {
  return bezier(0.22, 1, 0.36, 1)(t);
}
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xt = (s: number) => ((ax * s + bx) * s + cx) * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const d = xt(s) - t;
      const dx = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(d) < 1e-5 || !dx) break;
      s -= d / dx;
    }
    s = Math.min(1, Math.max(0, s));
    return ((ay * s + by) * s + cy) * s;
  };
}

// ── what the map lights ──

/** The path so far, lit: every card reached and every arrow travelled up to step `at`.
 * "hop": the hop at `at` is the one that animates (its arrow draws and is ridden, its card
 * ignites as the rider lands). "still": nothing travels (Esc). "sweep": the whole path lights
 * in lane order, as a trace does. */
export function litFor(map: CodeMap, steps: FlyStep[], at: number, how: "hop" | "still" | "sweep" = "hop"): Lit {
  const ix = indexOf(map);
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const services = new Set<string>();
  for (let k = 0; k <= at && k < steps.length; k++) {
    const s = steps[k];
    nodes.add(s.node);
    if (s.from) nodes.add(s.from);
    if (s.via) edges.add(s.via);
  }
  for (const id of nodes) {
    const sv = ix.node.get(id)?.service;
    if (sv) services.add(sv);
  }
  const s = steps[Math.min(at, steps.length - 1)];
  if (how === "sweep" || !s) return { nodes, edges, services };
  if (how === "still") return { nodes, edges, services, fly: { to: s.node, from: null, edge: null, reverse: false, gap: false } };
  return { nodes, edges, services, fly: { to: s.node, from: s.from, edge: s.via, reverse: s.reverse, gap: s.gap } };
}

// ── the player: a pure reducer ──

export type FlyStatus = "idle" | "playing" | "paused" | "done";

export interface FlyState {
  /** 0 when nothing is flying. */
  session: number;
  /** The guide's job feeding it (0 for a path played at once). */
  key: number;
  title: string;
  steps: FlyStep[];
  /** The step on screen; -1 before the first arrives. */
  at: number;
  status: FlyStatus;
  /** The step on screen has finished playing (its motion, and its narration when the voice is on). */
  settled: boolean;
  /** More steps may still come (the guide is answering). */
  waiting: boolean;
  /** Read each hop aloud. */
  voice: boolean;
  /** Hops the guide asked for that the map does not have (turned away). */
  refused: number;
  /** The user stopped it (Esc): later steps from the guide are turned away. */
  stopped: boolean;
  /** Why the guide could not answer, when it could not. */
  error: string | null;
}

export const IDLE: FlyState = { session: 0, key: 0, title: "", steps: [], at: -1, status: "idle", settled: true, waiting: false, voice: false, refused: 0, stopped: false, error: null };

export type FlyAction =
  | { type: "begin"; session: number; key?: number; title: string; voice: boolean; waiting: boolean; steps?: FlyStep[] }
  | { type: "add"; step: FlyStep }
  /** The step on screen has played. */
  | { type: "settled" }
  /** No more steps will come. */
  | { type: "end"; error?: string | null }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; at: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "replay" }
  | { type: "stop" }
  | { type: "close" }
  | { type: "voice"; on: boolean }
  | { type: "refused" };

/** Move on from a settled step: the next one if it is here, else done once nothing more will come. */
function advance(s: FlyState): FlyState {
  if (s.at < s.steps.length - 1) return { ...s, at: s.at + 1, settled: false };
  if (!s.waiting) return { ...s, status: "done" };
  return s;
}

export function flyReducer(s: FlyState, a: FlyAction): FlyState {
  if (a.type === "begin") {
    const steps = a.steps ?? [];
    const base: FlyState = { ...IDLE, session: a.session, key: a.key ?? 0, title: a.title, steps, status: "playing", waiting: a.waiting, voice: a.voice };
    return steps.length ? { ...base, at: 0, settled: false } : base;
  }
  if (s.status === "idle") return s;
  switch (a.type) {
    case "add": {
      const next = { ...s, steps: [...s.steps, a.step] };
      // The player was waiting at the end of the path for this one.
      return s.status === "playing" && s.settled && s.at === s.steps.length - 1 ? advance(next) : next;
    }
    case "settled": {
      if (s.settled) return s;
      const next = { ...s, settled: true };
      return s.status === "playing" ? advance(next) : next;
    }
    case "end": {
      const next = { ...s, waiting: false, error: a.error ?? s.error };
      if (!next.steps.length) return { ...next, status: "done" };
      return next.status === "playing" && next.settled && next.at === next.steps.length - 1 ? { ...next, status: "done" } : next;
    }
    case "next":
      return s.at < s.steps.length - 1 ? { ...s, at: s.at + 1, settled: false, status: s.status === "done" ? "paused" : s.status } : s;
    case "back":
      return s.at > 0 ? { ...s, at: s.at - 1, settled: false, status: s.status === "done" ? "paused" : s.status } : s;
    case "goto":
      return a.at >= 0 && a.at < s.steps.length ? { ...s, at: a.at, settled: false, status: s.status === "done" ? "paused" : s.status } : s;
    case "pause":
      return s.status === "playing" ? { ...s, status: "paused" } : s;
    case "resume":
      if (s.status !== "paused") return s;
      return s.settled ? advance({ ...s, status: "playing" }) : { ...s, status: "playing" };
    case "replay":
      return s.steps.length ? { ...s, at: 0, settled: false, status: "playing", stopped: false } : s;
    case "stop":
      return { ...s, status: "done", stopped: s.waiting || s.stopped, waiting: false, settled: true, at: Math.max(s.at, s.steps.length - 1) };
    case "close":
      return IDLE;
    case "voice":
      return { ...s, voice: a.on };
    case "refused":
      return { ...s, refused: s.refused + 1 };
  }
  return s;
}

// ── what the player drives ──

/** The room (WorkspaceProvider): the map, the code, the lights and the dock. */
export interface FlyRoom {
  map(): CodeMap;
  files(): Record<string, string>;
  /** Switch to a view that draws this node; `wide`: one where the whole path can be drawn. */
  show(id: string, wide: boolean): void;
  light(lit: Lit | null): void;
  open(path: string, start: number, end: number): void;
  /** Select a card (switching view if needed); the id the map draws it as. */
  select(id: string): string;
  tour(t: Tour): void;
  /** Make sure the map panel is the visible tab. */
  reveal(): void;
}

/** The camera (MapView, through React Flow's own viewport helpers). */
export interface FlyCamera {
  /** Is this node drawn in the view on screen (as its card, or a portal standing for it)? */
  has(id: string): boolean;
  /** Glide so `id` (and `from`, when both fit) is in view; `ms` 0 jumps. Resolves when the
   * move has ended; false when the card never appeared. */
  glide(id: string, from: string | null, ms: number): Promise<boolean>;
  /** The light lands on the card (unless the rider is on its way there). */
  land(id: string): void;
}

/** The narrator chosen in Settings → Voice (the browser's own voice when no key is set). */
export interface FlyVoice {
  say(text: string, scope: { map: string; generatedAt: string }): Promise<"ended" | "stopped">;
  pause(): void;
  resume(): void;
  stop(): void;
}

/** What the guide's fly_step runs through, one per question asked. */
export interface FlyAsk {
  /** Check one hop against the map and, when it is real, play it. The text goes back to the guide. */
  step(input: Record<string, unknown>): string;
  /** The answer has ended (with the error's title when it failed). */
  done(error?: string): void;
}

export interface PlayResult {
  ok: boolean;
  shown: number;
  gaps: number;
  refused: { index: number; error: string }[];
}

export interface FlyOptions {
  reduced?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number;
  /** The narrator, made on first use (tests hand in a fake). */
  voice?: () => Promise<FlyVoice | null>;
  /** Where the voice switch is remembered (per viewer). */
  prefs?: { get(): boolean; set(on: boolean): void };
  /** Marks for timing (performance.mark in the browser). */
  mark?: (name: string) => void;
}

const VOICE_KEY = "walkmycode.flyVoice";
const browserPrefs = {
  get: () => {
    try {
      return typeof localStorage !== "undefined" && readPref(localStorage, VOICE_KEY) === "on";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(VOICE_KEY, "on");
      else removePref(localStorage, VOICE_KEY);
    } catch {
      /* remembered until the page closes */
    }
  },
};

/** The text read for a hop: a gap says so first. */
export function spokenFor(step: FlyStep): string {
  const gap = step.gap && step.fromName ? `I can't see a link from ${step.fromName} to ${step.name}.` : "";
  return [gap, step.say].filter(Boolean).join(" ");
}

export class FlyThrough {
  state: FlyState = IDLE;
  private listeners = new Set<() => void>();
  private room: FlyRoom | null = null;
  private camera: FlyCamera | null = null;
  /** A move asked for while no map was mounted: made when one is. */
  private pending: { id: string; from: string | null; land: boolean } | null = null;
  private voiceImpl: FlyVoice | null = null;
  private voiceLoad: Promise<FlyVoice | null> | null = null;
  private sessions = 0;
  /** Bumps with every step played, so a late callback of an earlier step is ignored. */
  private seq = 0;
  private timer: unknown = undefined;
  /** Opens the hop's code once the light has landed. */
  private openTimer: unknown = undefined;
  private dwellLeft = 0;
  private dwellFrom = 0;
  private motionDone = true;
  private voiceDone = true;
  /** Until when the camera is ours (a flyTo's glide): the map does not fit itself meanwhile. */
  private cameraUntil = 0;
  private readonly reduced: () => boolean;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly now: () => number;
  private readonly loadVoice: () => Promise<FlyVoice | null>;
  private readonly prefs: { get(): boolean; set(on: boolean): void };
  private readonly mark: (name: string) => void;

  constructor(o: FlyOptions = {}) {
    this.reduced = o.reduced ?? motionOff;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.loadVoice = o.voice ?? (() => import("./flyVoice").then((m) => m.flyVoice()).catch(() => null));
    this.prefs = o.prefs ?? browserPrefs;
    this.mark = o.mark ?? ((name) => (typeof performance !== "undefined" ? performance.mark?.(name) : undefined));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;

  // ── attachments ──

  attachRoom(room: FlyRoom): () => void {
    this.room = room;
    return () => {
      if (this.room !== room) return;
      this.halt();
      this.room = null;
      this.state = IDLE;
      this.emit();
    };
  }

  attachCamera(camera: FlyCamera): () => void {
    this.camera = camera;
    const p = this.pending;
    this.pending = null;
    if (p) void this.move(p.id, p.from, p.land);
    return () => {
      if (this.camera === camera) this.camera = null;
    };
  }

  /** Is the camera being driven (a fly-through on screen, or a flyTo's glide)? The map does not fit itself then. */
  ownsCamera(): boolean {
    return this.state.status !== "idle" || this.now() < this.cameraUntil;
  }

  // ── one card ──

  /** Glide to one card (a node, or a service on the system view), select it, open its code. */
  flyTo(id: string): boolean {
    const room = this.room;
    if (!room) return false;
    const map = room.map();
    const isNode = indexOf(map).node.has(id);
    if (!isNode && !map.services.some((s) => s.id === id)) return false;
    this.mark("fly:match");
    if (this.state.status !== "idle") this.close();
    if (!isNode) {
      // A service opens its lanes (or is its card on the system view): the map fits the new view itself.
      room.select(id);
      room.reveal();
      return true;
    }
    const cam = this.camera;
    const my = ++this.seq;
    // The camera first, so it is moving before React draws the selection; the code opens
    // once it has arrived, so the glide is not shared with an editor being built.
    const drawn = !!cam?.has(id);
    const glide = drawn ? this.move(id, null, true, my) : null;
    const target = room.select(id);
    if (!drawn) room.reveal();
    void (glide ?? this.move(target, null, true, my)).then(() => {
      const n = indexOf(map).node.get(id);
      if (my === this.seq && n?.file) room.open(n.file, n.line ?? 1, n.endLine ?? n.line ?? 1);
    });
    return true;
  }

  /** Only the camera (a tour step): glide to a card at a readable zoom, framing the card it came
   * from when both fit; nothing is selected, opened or lit. False when no map is on screen, the
   * id is not on it, or a fly-through has the camera. */
  focus(id: string, from: string | null = null): boolean {
    const room = this.room;
    const cam = this.camera;
    if (!room || !cam || this.state.status !== "idle") return false;
    const map = room.map();
    if (!indexOf(map).node.has(id) && !map.services.some((s) => s.id === id)) return false;
    void this.move(id, from && from !== id ? from : null, false, ++this.seq);
    return true;
  }

  // ── a whole path ──

  /** Fly a whole path; every step checked against the map (see the top of this file). */
  play(inputs: FlyStepInput[], o: { title?: string; voice?: boolean } = {}): PlayResult {
    const room = this.room;
    if (!room) return { ok: false, shown: 0, gaps: 0, refused: inputs.map((_, index) => ({ index, error: "No map is open." })) };
    const map = room.map();
    const files = room.files();
    const steps: FlyStep[] = [];
    const refused: PlayResult["refused"] = [];
    let prev: string | null = null;
    inputs.forEach((input, index) => {
      const r = checkStep(map, files, prev, input);
      if (!r.ok) refused.push({ index, error: r.error });
      else {
        steps.push(r.step);
        prev = r.step.node;
      }
    });
    if (!steps.length) return { ok: false, shown: 0, gaps: 0, refused };
    this.mark("fly:match");
    this.begin({ title: o.title ?? `${steps[0].name} → ${steps[steps.length - 1].name}`, voice: o.voice, steps });
    return { ok: true, shown: steps.length, gaps: steps.filter((s) => s.gap).length, refused };
  }

  /** A path given as ids (trace_path): edgeIds[i] joins nodeIds[i] and nodeIds[i+1]. */
  path(nodeIds: string[], edgeIds: string[] = [], o: { title?: string; voice?: boolean } = {}): PlayResult {
    const map = this.room?.map();
    if (!map) return this.play([], o);
    return this.play(stepsForPath(map, nodeIds, edgeIds), o);
  }

  /** The real arrows from one card to another, flown; a gap when the map does not join them. */
  between(from: string, to: string, o: { title?: string; voice?: boolean } = {}): PlayResult {
    const map = this.room?.map();
    if (!map) return this.play([], o);
    const way = findPath(map, from, to);
    return way ? this.path(way.nodes, way.edges, o) : this.play([{ node: from }, { node: to }], o);
  }

  // ── a path that arrives a step at a time (the guide) ──

  /** Start a fly-through whose steps will follow (`live`), or with all of them. Returns its id. */
  begin(o: { title: string; voice?: boolean; live?: boolean; key?: number; steps?: FlyStep[] }): number {
    const session = ++this.sessions;
    this.halt();
    this.room?.reveal();
    this.dispatch({ type: "begin", session, key: o.key, title: o.title, voice: o.voice ?? this.prefs.get(), waiting: !!o.live, steps: o.steps });
    return session;
  }

  /** One more step for a live fly-through. False when that fly-through is no longer on screen. */
  add(session: number, step: FlyStep): boolean {
    if (session !== this.state.session || this.state.stopped) return false;
    this.dispatch({ type: "add", step });
    return true;
  }

  /** No more steps will come for this fly-through. */
  end(session: number, error?: string) {
    if (session !== this.state.session) return;
    this.dispatch({ type: "end", error: error ?? null });
  }

  /** The handle the guide's fly_step runs through for one question (Guide.tsx). A job begun
   * from the go-to bar (`key`) feeds the fly-through already on screen; any other starts
   * one at its first real hop. */
  forAsk(o: { map: CodeMap; files: Record<string, string>; key: number; title: string }): FlyAsk {
    let prev: string | null = null;
    // Begun by the go-to bar for this very job: its steps go there.
    let session = this.state.key === o.key && this.state.status !== "idle" ? this.state.session : 0;
    let count = 0;
    let closed = false;
    return {
      step: (input) => {
        if (closed) return "Not shown: this answer has ended.";
        if (session && session !== this.state.session) return "Not shown: the user closed the fly-through. Don't call fly_step again; answer in words.";
        if (session && this.state.stopped) return "Not shown: the user stopped the fly-through. Don't call fly_step again; answer in words.";
        const r = checkStep(o.map, o.files, prev, input);
        if (!r.ok) {
          if (session) this.dispatch({ type: "refused" });
          return r.error;
        }
        session ||= this.begin({ title: o.title, live: true, key: o.key });
        if (!this.add(session, r.step)) return "Not shown: the fly-through was closed. Answer in words.";
        prev = r.step.node;
        count++;
        return `Step ${count}. ${r.note} Call fly_step for the next hop, or answer in a sentence or two once there.`;
      },
      done: (error) => {
        if (closed) return;
        closed = true;
        if (session) this.end(session, error);
      },
    };
  }

  // ── controls ──

  pause() {
    this.dispatch({ type: "pause" });
  }
  resume() {
    this.dispatch({ type: "resume" });
  }
  toggle() {
    if (this.state.status === "playing") this.pause();
    else if (this.state.status === "paused") this.resume();
    else if (this.state.status === "done") this.replay();
  }
  next() {
    this.dispatch({ type: "next" });
  }
  back() {
    this.dispatch({ type: "back" });
  }
  goto(at: number) {
    this.dispatch({ type: "goto", at });
  }
  replay() {
    this.dispatch({ type: "replay" });
  }
  /** Esc: stop moving and speaking; the path so far stays drawn. */
  stop() {
    this.dispatch({ type: "stop" });
  }
  /** Put the path out and hide the bar. */
  close(o: { clear?: boolean } = {}) {
    if (this.state.status === "idle") return;
    this.halt();
    this.state = IDLE;
    if (o.clear !== false) this.room?.light(null);
    this.emit();
  }
  /** Read each hop aloud, or not (remembered in this browser). */
  setVoice(on: boolean) {
    this.prefs.set(on);
    const s = this.state;
    this.dispatch({ type: "voice", on });
    if (!on) {
      this.voiceImpl?.stop();
      this.voiceDone = true;
      this.check(this.seq);
    } else if (s.status !== "idle" && s.at >= 0 && !s.settled && this.voiceDone && spokenFor(s.steps[s.at])) {
      // Turned on mid-hop: this hop is read now, and the next waits for it.
      this.voiceDone = false;
      void this.speak(s.steps[s.at], this.seq);
    }
  }

  /** The path as a normal tour: one step per hop with code to show. */
  toTour(): Tour | null {
    const s = this.state;
    if (!s.steps.length) return null;
    const steps: Tour["steps"] = [];
    let carry: string[] = [];
    for (const st of s.steps) {
      const ids = [...carry, ...(st.from ? [st.from] : []), st.node];
      if (!st.file) {
        carry = ids; // a card with no code (an outside service): lit with the next step
        continue;
      }
      carry = [];
      steps.push({ say: spokenFor(st) || st.name, file: st.file, start_line: st.start, end_line: st.end, node_ids: [...new Set(ids)] });
    }
    if (carry.length && steps.length) steps[steps.length - 1].node_ids = [...new Set([...steps[steps.length - 1].node_ids, ...carry])];
    return steps.length ? { title: s.title || "Fly-through", steps } : null;
  }

  /** "Save as tour": the guide's tour player takes the path over. */
  saveAsTour(): boolean {
    const t = this.toTour();
    if (!t || !this.room) return false;
    const room = this.room;
    this.close({ clear: false });
    room.tour(t);
    return true;
  }

  // ── inside ──

  private emit() {
    for (const l of this.listeners) l();
  }

  private dispatch(a: FlyAction) {
    const prev = this.state;
    const next = flyReducer(prev, a);
    if (next === prev) return;
    this.state = next;
    this.effects(prev, next, a);
    this.emit();
  }

  private effects(prev: FlyState, next: FlyState, a: FlyAction) {
    if (next.status === "idle") return;
    const starts = next.at >= 0 && !next.settled && (prev.settled || prev.at !== next.at || prev.session !== next.session || a.type === "replay" || a.type === "goto");
    if (starts) {
      this.playStep(next);
      return;
    }
    if (a.type === "stop") {
      // Everything stops where it is; the whole path so far stays drawn, still.
      this.halt();
      if (this.room && next.steps.length) this.room.light(litFor(this.room.map(), next.steps, next.at, "still"));
      return;
    }
    if (prev.status === "playing" && next.status === "paused") {
      this.voiceImpl?.pause();
      if (!this.motionDone && this.timer !== undefined) {
        this.clearTimer(this.timer);
        this.timer = undefined;
        this.dwellLeft = Math.max(0, this.dwellLeft - (this.now() - this.dwellFrom));
      }
    } else if (prev.status === "paused" && next.status === "playing") {
      this.voiceImpl?.resume();
      if (!this.motionDone) this.arm(this.dwellLeft, this.seq);
      else this.check(this.seq);
    }
  }

  /** Stop every timer and the voice (the path stays as it is). */
  private halt() {
    this.seq++;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    if (this.openTimer !== undefined) this.clearTimer(this.openTimer);
    this.timer = this.openTimer = undefined;
    this.voiceImpl?.stop();
    this.motionDone = this.voiceDone = true;
  }

  /**
   * One hop, in three beats, so no two heavy things share a frame: the camera glides
   * (the map moves as one layer), then the light rides the arrow and the card it reaches
   * ignites as it lands, then the code opens at the hop's lines (building an editor
   * mid-glide or mid-ride would make either stutter). The narrator starts at once.
   */
  private playStep(s: FlyState) {
    const step = s.steps[s.at];
    const room = this.room;
    if (!step || !room) return;
    this.halt();
    const my = this.seq;
    const off = this.reduced();
    this.motionDone = false;
    this.voiceDone = !(s.voice && spokenFor(step));
    if (!this.voiceDone) void this.speak(step, my);
    // The first stop is longer: a moment to see where we start, while the map dims around the
    // path and its first editor is built, so none of that lands in the next glide.
    this.arm(dwellMs(step.say, s.voice, off) + (s.at === 0 && !off ? FIRST_STOP_MS : 0), my);
    // To a view that draws the card first, when this one does not.
    if (this.camera && !this.camera.has(step.node)) room.show(step.node, s.at > 0);
    void this.move(step.node, step.from, false, my).then(() => {
      if (my !== this.seq) return;
      room.light(litFor(room.map(), s.steps, s.at));
      const rides = !!step.via && !off;
      if (!rides) this.camera?.land(step.node);
      const open = () => {
        this.openTimer = undefined;
        if (my === this.seq && step.file) room.open(step.file, step.start, step.end);
      };
      if (rides) this.openTimer = this.setTimer(open, FLY_HOP_MS);
      else open();
    });
  }

  /** Glide the camera; the light lands when it stops (a hop along an arrow lands from its rider).
   * Resolves once the move is over (at once when there is no map to move: it moves when one mounts). */
  private async move(id: string, from: string | null, land: boolean, my?: number): Promise<void> {
    const cam = this.camera;
    if (!cam) {
      this.pending = { id, from, land };
      this.room?.reveal();
      return;
    }
    const ms = flyDuration(this.reduced());
    this.cameraUntil = this.now() + ms + 900;
    this.mark("fly:camera");
    const ok = await cam.glide(id, from, ms);
    if (!ok || (my !== undefined && my !== this.seq)) return;
    if (land) cam.land(id);
  }

  private async speak(step: FlyStep, my: number) {
    try {
      if (!this.voiceImpl) {
        this.voiceLoad ??= this.loadVoice();
        this.voiceImpl = await this.voiceLoad;
      }
      const v = this.voiceImpl;
      const map = this.room?.map();
      if (v && map && my === this.seq) {
        if (this.state.status === "paused") v.pause();
        await v.say(spokenFor(step), { map: map.name, generatedAt: map.generatedAt });
      }
    } catch {
      // A narration that fails leaves the hop on screen; the next one still comes.
    }
    if (my !== this.seq) return;
    this.voiceDone = true;
    this.check(my);
  }

  private arm(ms: number, my: number) {
    this.dwellLeft = ms;
    this.dwellFrom = this.now();
    this.timer = this.setTimer(() => {
      if (my !== this.seq) return;
      this.timer = undefined;
      this.motionDone = true;
      this.check(my);
    }, ms);
  }

  private check(my: number) {
    if (my !== this.seq || !this.motionDone || !this.voiceDone || this.state.status !== "playing") return;
    this.dispatch({ type: "settled" });
  }
}

/** The one fly-through of the app. */
export const flyThrough = new FlyThrough();
