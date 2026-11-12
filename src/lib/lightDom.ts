// The light's element and its driver (docs/MOTION.md §5). Every move runs on
// the compositor as a Web Animation of the element's `translate`, `scale` or
// `opacity`: the spring is sampled once into keyframes when the flight starts,
// so nothing is written per frame. (Writing the transform every frame from the
// main thread, as Motion's motion values do, made the browser re-layerize the
// whole page each frame: about 8 ms a frame on the full map.) A new target
// retargets from where the dot is, velocity and all, worked out from the
// running spring rather than read back from the page; a jump lands at once.
// Browser only: the store itself (light.ts) has no DOM.
import { spring as springGen } from "motion";
import { light, type LightDriver, type SpringName } from "./light";
import { springs, tweens } from "./motion";

/** Keyframe spacing when a spring is sampled (ms). */
const STEP = 1000 / 60;
/** No flight lasts longer than this, whatever the spring says (ms). */
const MAX_FLIGHT = 2000;

type Gen = ReturnType<typeof springGen>;
interface Flight {
  gx: Gen;
  gy: Gen;
  t0: number;
  anim: Animation;
}

export function waapiDriver(el: HTMLElement): LightDriver {
  const now = () => (el.ownerDocument.defaultView ?? window).performance.now();
  let x = 0;
  let y = 0;
  let flight: Flight | null = null;
  let opacity = { from: 0, to: 0, t0: 0, ms: 0 };
  let fadeAnim: Animation | null = null;
  let squash: Animation | null = null;

  /** Where the dot is at `t`, and how fast it is going (px/s). */
  const current = (t: number) => {
    if (!flight) return { x, y, vx: 0, vy: 0 };
    const dt = Math.max(0, t - flight.t0);
    const px = flight.gx.next(dt).value;
    const py = flight.gy.next(dt).value;
    const back = Math.max(0, dt - 8);
    const k = dt > back ? 1000 / (dt - back) : 0;
    return { x: px, y: py, vx: (px - flight.gx.next(back).value) * k, vy: (py - flight.gy.next(back).value) * k };
  };
  const stopFlight = () => {
    if (!flight) return;
    flight.anim.onfinish = null;
    flight.anim.cancel();
    flight = null;
  };
  const place = (px: number, py: number) => {
    x = px;
    y = py;
    el.style.translate = `${px}px ${py}px`;
  };
  /** Opacity now, from the running fade (linear). */
  const opacityNow = () => {
    const p = opacity.ms ? Math.min(1, Math.max(0, (now() - opacity.t0) / opacity.ms)) : 1;
    return opacity.from + (opacity.to - opacity.from) * p;
  };
  const fadeTo = (to: number, ms: number) => {
    const from = opacityNow();
    fadeAnim?.cancel();
    opacity = { from, to, t0: now(), ms };
    el.style.opacity = String(to);
    fadeAnim = from === to ? null : el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: "ease-out" });
  };

  return {
    moveTo(tx, ty, spring: SpringName | null, done) {
      const t = now();
      const c = current(t);
      stopFlight();
      if (!spring) {
        place(tx, ty);
        done();
        return;
      }
      const { stiffness, damping, mass } = springs[spring];
      const gx = springGen({ keyframes: [c.x, tx], velocity: c.vx, stiffness, damping, mass });
      const gy = springGen({ keyframes: [c.y, ty], velocity: c.vy, stiffness, damping, mass });
      const frames: Keyframe[] = [];
      for (let s = 0; ; s += STEP) {
        const a = gx.next(s);
        const b = gy.next(s);
        const end = (a.done && b.done) || s >= MAX_FLIGHT;
        frames.push({ translate: end ? `${tx}px ${ty}px` : `${a.value}px ${b.value}px` });
        if (end) break;
      }
      // The underlying value is the target, so the dot stays there once the animation ends.
      place(tx, ty);
      if (frames.length < 2) {
        done();
        return;
      }
      const anim = el.animate(frames, { duration: (frames.length - 1) * STEP, easing: "linear" });
      const f: Flight = { gx, gy, t0: t, anim };
      flight = f;
      anim.onfinish = () => {
        if (flight !== f) return;
        flight = null;
        done();
      };
    },
    show() {
      fadeTo(1, 150);
    },
    fade() {
      fadeTo(0, 120);
    },
    dim() {
      fadeTo(0.6, 600);
    },
    land() {
      squash?.cancel();
      squash = el.animate([{ scale: "1 1" }, { scale: "1.12 0.72" }, { scale: "0.96 1.08" }, { scale: "1 1" }], { duration: tweens.swell.duration * 1000, easing: "ease-out" });
    },
    destroy() {
      stopFlight();
      fadeAnim?.cancel();
      squash?.cancel();
    },
  };
}

/** Give a window its dot: the element is made if the document has none. Returns the unmount. */
export function mountLight(win: Window, el?: HTMLElement): () => void {
  const doc = win.document;
  let dot = el ?? doc.querySelector<HTMLElement>("body > .lantern-light");
  if (!dot) {
    dot = doc.createElement("span");
    dot.className = "lantern-light";
    dot.setAttribute("aria-hidden", "true");
    doc.body.appendChild(dot);
  }
  return light.mount(win, waapiDriver(dot));
}
