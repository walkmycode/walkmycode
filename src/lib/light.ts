// The light (docs/MOTION.md §5, docs/SHELL.md §8): the one warm dot that
// travels between the panels. It is a fixed element in a top layer, one per
// window, driven by motion values; this store decides where it goes. A target
// is measured from its DOM rect when the flight starts (viewport coordinates,
// so React Flow's transform, CodeMirror's scroll and dockview's boxes are all
// in it). A new target mid-flight simply retargets the springs; nothing
// queues. Every surface the light lands on has its own beacon (a
// pseudo-element that scrolls and pans with it), so with `handoff` the dot
// fades on arrival and is only ever visible during a flight.
//
// A target in a hidden tab, clipped out of its panel, or in a window with no
// light hides the dot: its beacon still shows.
//
// Measuring never forces the browser's hand: flights asked for during a click
// (React commits, effects, CodeMirror, dockview all at once) are coalesced into
// the last one and measured after the next frame has been laid out, when
// reading a rect is free. Hidden is decided from the DOM (no size, a hidden
// attribute, a tab dockview has hidden), not from computed style. A target in a pop-out window
// with a light of its own: this window's dot fades and that window's dot rises
// from the pop-out's tab beacon.
//
// The element and Motion live in lightDom.ts; the store takes a driver, so
// tests can run it in Node with a fake one.
import { motionOff } from "./motion";

export type Anchor = "center" | "left" | "right" | "top" | "bottom";
export type SpringName = "glide" | "hop" | "settle" | "snap";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
  /** The window these coordinates are in (the main window if not given). */
  win?: Window;
}
/** Enough of an element for the store: the DOM's elements satisfy this. */
export interface TargetElement {
  ownerDocument: { defaultView: Window | null };
  getBoundingClientRect(): Box;
  closest?(selector: string): TargetElement | null;
}
export type LightTarget = Box | Point | TargetElement;

export interface FlyOptions {
  /** Where on the target's rect to land (centre if not given). */
  at?: Anchor;
  /** Nudges from that point, in px. */
  dx?: number;
  dy?: number;
  /** The travel spring (glide if not given). */
  spring?: SpringName;
  /** Squash on arrival (yes if not given). */
  land?: boolean;
  /** Fade out on arrival: the surface's own beacon takes over. */
  handoff?: boolean;
  /** Jump here first (a citation: depart from the word that was clicked). */
  from?: Box | TargetElement;
  /** For a box or a point: the window it is in. */
  win?: Window;
}

/** What the store asks of the dot in one window. `spring` null means jump. */
export interface LightDriver {
  moveTo(x: number, y: number, spring: SpringName | null, done: () => void): void;
  show(): void;
  fade(): void;
  dim(): void;
  land(): void;
  destroy(): void;
}

export type LightMode = "hidden" | "flying" | "landed" | "handed";

export interface LightState {
  mode: LightMode;
  /** The window whose dot was used last. */
  win: Window | null;
  x: number;
  y: number;
}

/** Panels clip what they hold; a target outside its panel's box is not on screen. */
const CLIP = ".dock-panel, .dv-groupview, .hall";
/** Hidden without losing its size: a tab dockview keeps rendered but hidden, a map tab behind another. */
export const HIDDEN = '[hidden], .dock-panel.off, .dv-render-overlay[style*="visibility: hidden"]';
/** Ms without a flight before the dot dims. */
const IDLE_MS = 4000;

const isElement = (t: LightTarget): t is TargetElement => typeof (t as TargetElement).getBoundingClientRect === "function";
const isBox = (t: LightTarget): t is Box => !isElement(t) && "width" in t;

/** The point on a box the light lands on. */
export function anchorPoint(r: Box, at: Anchor = "center", dx = 0, dy = 0): { x: number; y: number } {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const p = at === "left" ? { x: r.left, y: cy } : at === "right" ? { x: r.left + r.width, y: cy } : at === "top" ? { x: cx, y: r.top } : at === "bottom" ? { x: cx, y: r.top + r.height } : { x: cx, y: cy };
  return { x: p.x + dx, y: p.y + dy };
}

/** Is a point inside a box (with a little slack)? */
export function inside(p: { x: number; y: number }, r: Box, slack = 2): boolean {
  return p.x >= r.left - slack && p.x <= r.left + r.width + slack && p.y >= r.top - slack && p.y <= r.top + r.height + slack;
}

interface Slot {
  driver: LightDriver;
}

export interface LightOptions {
  /** Is motion reduced right now? Flights then jump and only fades remain. */
  reduced?: () => boolean;
  /** The clock for the idle timer (tests hand in a fake). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** When to measure and fly. Calls made before it runs are coalesced into the last.
   * Left out (tests), flights start at once. */
  defer?: (run: () => void) => void;
}

export class LightStore {
  private slots = new Map<Window, Slot>();
  private main: Window | null = null;
  private flight = 0;
  private idle: unknown = undefined;
  private listeners = new Set<() => void>();
  private reduced: () => boolean;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;
  private defer: ((run: () => void) => void) | undefined;
  /** The latest flight asked for and not yet measured. */
  private pending: (() => boolean) | null = null;
  state: LightState = { mode: "hidden", win: null, x: 0, y: 0 };

  constructor(o: LightOptions = {}) {
    this.reduced = o.reduced ?? motionOff;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.defer = o.defer;
  }

  /** Run a flight now (no defer), or once the frame is laid out, replacing any flight
   * already waiting. Deferred, it returns true: whether the target can be seen is only
   * known then. */
  private queue(run: () => boolean): boolean {
    if (!this.defer) return run();
    const waiting = this.pending !== null;
    this.pending = run;
    if (!waiting)
      this.defer(() => {
        const r = this.pending;
        this.pending = null;
        r?.();
      });
    return true;
  }

  /** A window's dot. The first window mounted is the main one (where `park` goes). Returns the unmount. */
  mount(win: Window, driver: LightDriver): () => void {
    this.slots.get(win)?.driver.destroy();
    this.slots.set(win, { driver });
    if (!this.main) this.main = win;
    return () => this.dropWindow(win);
  }

  dropWindow(win: Window) {
    const s = this.slots.get(win);
    if (!s) return;
    s.driver.destroy();
    this.slots.delete(win);
    if (this.state.win === win) this.set({ mode: "hidden", win: null });
    if (this.main === win) this.main = this.slots.keys().next().value ?? null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<LightState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Where a target is now, in its window, or null when it cannot be seen. */
  resolve(target: LightTarget, o: FlyOptions = {}): { win: Window; x: number; y: number } | null {
    if (isElement(target)) {
      const win = target.ownerDocument?.defaultView;
      if (!win) return null;
      const r = target.getBoundingClientRect();
      if (!r.width && !r.height) return null; // display: none, or not in the document
      if (target.closest?.(HIDDEN)) return null;
      const p = anchorPoint(r, o.at, o.dx, o.dy);
      const clip = target.closest?.(CLIP);
      if (clip && clip !== target && !inside(p, clip.getBoundingClientRect())) return null;
      return { win, ...p };
    }
    const win = o.win ?? (isBox(target) ? undefined : target.win) ?? this.main;
    if (!win) return null;
    if (isBox(target)) return { win, ...anchorPoint(target, o.at, o.dx, o.dy) };
    return { win, x: target.x + (o.dx ?? 0), y: target.y + (o.dy ?? 0) };
  }

  /** Fly to a target. Returns false when the target cannot be seen (the dot hides). */
  flyTo(target: LightTarget, o: FlyOptions = {}): boolean {
    return this.queue(() => this.flyNow(target, o));
  }

  private flyNow(target: LightTarget, o: FlyOptions): boolean {
    // Every rect is read before the dot is told anything.
    const dest = this.resolve(target, o);
    const slot = dest && this.slots.get(dest.win);
    if (!dest || !slot) {
      this.hideNow();
      return false;
    }
    const prev = this.state.win;
    const hop = !!prev && prev !== dest.win;
    let from = o.from ? this.resolve(o.from, { win: dest.win }) : null;
    // A hop between windows: this dot fades, the other rises from its tab beacon.
    if (hop) from ??= popoutBeacon(dest.win) ?? null;
    const id = ++this.flight;
    this.clearTimer(this.idle);
    const reduced = this.reduced();
    if (hop) this.slots.get(prev)?.driver.fade();
    if (from) slot.driver.moveTo(from.x, from.y, null, () => {});
    slot.driver.show();
    this.set({ mode: "flying", win: dest.win, x: dest.x, y: dest.y });
    slot.driver.moveTo(dest.x, dest.y, reduced ? null : (o.spring ?? "glide"), () => {
      if (id !== this.flight) return;
      if (o.land !== false && !reduced) slot.driver.land();
      if (o.handoff) {
        slot.driver.fade();
        this.set({ mode: "handed" });
      } else {
        this.set({ mode: "landed" });
        this.idle = this.setTimer(() => slot.driver.dim(), IDLE_MS);
      }
    });
    return true;
  }

  /** Land on a target with a bounce (a code line, a tour pill). */
  settleOn(target: LightTarget, o: FlyOptions = {}): boolean {
    return this.flyTo(target, { spring: "hop", ...o });
  }

  /** Thinking: fly to the top right of the board (where its orbiting beacon is, 26 px in
   * and 22 px down, 8 px wide) and hand off to it. */
  orbit(board: TargetElement): boolean {
    return this.queue(() => {
      const w = board.getBoundingClientRect().width;
      return this.flyNow(board, { at: "top", dx: w / 2 - 30, dy: 26, handoff: true, land: false });
    });
  }

  /** Home: the brand in the main window's top bar (its beacon is always lit). */
  park(): boolean {
    return this.queue(() => this.parkNow());
  }

  private parkNow(): boolean {
    const doc = this.main?.document;
    const home = doc?.querySelector<HTMLElement>('[data-light="home"]');
    if (!home) {
      this.hideNow();
      return false;
    }
    // The first of the brand's forms that is laid out (the others are display: none at this width).
    let beacon: HTMLElement | undefined;
    let r: Box | undefined;
    for (const el of [...home.querySelectorAll<HTMLElement>(".brand-full, .brand-dot, .i"), home]) {
      r = el.getBoundingClientRect();
      if (r.width || r.height) {
        beacon = el;
        break;
      }
    }
    if (!beacon || !r) {
      this.hideNow();
      return false;
    }
    // The brand's dot sits at its top right; the others are the dot.
    const brand = beacon.classList.contains("brand-full");
    return this.flyNow(beacon, brand ? { at: "right", dx: -4, dy: -(r.height / 2) + 7, handoff: true } : { handoff: true });
  }

  /** Fade out where it is (the map is panning, a panel is being dragged). A flight
   * waiting to be measured is dropped. */
  hide() {
    this.pending = null;
    this.hideNow();
  }

  private hideNow() {
    this.flight++;
    this.clearTimer(this.idle);
    if (this.state.mode === "hidden" || this.state.mode === "handed") {
      if (this.state.mode !== "hidden") this.set({ mode: "hidden" });
      return;
    }
    if (this.state.win) this.slots.get(this.state.win)?.driver.fade();
    this.set({ mode: "hidden" });
  }
}

/** The tab beacon of a pop-out window's group, where its dot rises from. */
function popoutBeacon(win: Window): { win: Window; x: number; y: number } | null {
  const bar = win.document?.querySelector<HTMLElement>('[data-location="popout"] > .dv-tabs-and-actions-container');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  return { win, x: r.left + 12, y: r.top + r.height / 2 };
}

/** After the next frame has been laid out: a rect read then costs nothing. */
const afterLayout =
  typeof window === "undefined"
    ? undefined
    : (run: () => void) => {
        requestAnimationFrame(() => setTimeout(run, 0));
      };

/** The one light of the app. */
export const light = new LightStore({ defer: afterLayout });
