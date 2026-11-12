// The motion vocabulary (docs/MOTION.md §2.3) and the reduce-motion switch.
//
// One variable decides whether things move: --m on <html> (globals.css). It is
// 0 when the in-app switch says "off", or when it says "follow my system" and
// the OS asks for reduced motion; "on" keeps motion even then. JavaScript never
// keeps its own copy: motionOff() applies the rule that sets --m, so CSS, Motion,
// React Flow and the light always agree. No React here, so tests can load it.
import { oldPrefKey, readPref, removePref } from "./prefs";

export type MotionPref = "system" | "on" | "off";

/** Springs for things you touch; eases for things you read (Motion transition objects). */
export const springs = {
  snap: { type: "spring", stiffness: 700, damping: 40, mass: 1 }, // ~180 ms, no overshoot: toggles, pills, buttons
  settle: { type: "spring", stiffness: 380, damping: 30, mass: 1 }, // ~350 ms, ~2 % overshoot: panels, cards, the selection bar
  hop: { type: "spring", stiffness: 260, damping: 18, mass: 0.8 }, // ~480 ms, one visible bounce: the light landing
  glide: { type: "spring", stiffness: 120, damping: 22, mass: 1 }, // ~600 ms, no overshoot: the light flying, the cost roll
} as const;

export const tweens = {
  swell: { duration: 0.24, ease: "easeOut" },
  scroll: { duration: 0.35, ease: "easeOut" },
  count: { duration: 0.6, ease: "easeOut" },
} as const;

/** The whole trace sweep, first lane to last, never takes longer than this. */
export const SWEEP_MS = 1200;

/** Delay between two lanes of a trace, 120–220 ms, so the sweep fits in SWEEP_MS. */
export const hopMs = (lanes: number) => Math.min(220, Math.max(120, SWEEP_MS / Math.max(1, lanes)));

/** A fly-through's camera move, card to card (docs/PLAN.md "Fly-through": ~400 ms, eased, × --m). */
export const CAMERA_MS = 400;
/** A fly-through's light riding one arrow; the card it reaches ignites as it lands (× --m). */
export const FLY_HOP_MS = 420;

/** Is motion reduced, for a switch setting and the OS preference? The same rule as the CSS. */
export function reducedFor(pref: MotionPref, osReduce: boolean): boolean {
  return pref === "off" || (pref === "system" && osReduce);
}

/** A saved switch value, cleaned: anything unknown means "follow my system". */
export function parsePref(v: string | null | undefined): MotionPref {
  return v === "on" || v === "off" ? v : "system";
}

// ── the switch, in the browser ──

export const MOTION_KEY = "walkmycode.motion";
const OS_QUERY = "(prefers-reduced-motion: reduce)";
/** Pop-out windows follow the switch too (docs/SHELL.md §6). */
const extraDocs = new Set<Document>();
const listeners = new Set<() => void>();

export function savedMotion(): MotionPref {
  try {
    return parsePref(readPref(window.localStorage, MOTION_KEY));
  } catch {
    return "system";
  }
}

function writeAttr(doc: Document, pref: MotionPref) {
  if (pref === "system") delete doc.documentElement.dataset.motion;
  else doc.documentElement.dataset.motion = pref;
}

/** Set the switch: <html data-motion> in every window, remembered in this browser. */
export function applyMotion(pref: MotionPref, save = true) {
  writeAttr(document, pref);
  for (const d of extraDocs) {
    try {
      writeAttr(d, pref);
    } catch {
      extraDocs.delete(d); // its window has gone
    }
  }
  if (save) {
    try {
      if (pref === "system") removePref(window.localStorage, MOTION_KEY);
      else window.localStorage.setItem(MOTION_KEY, pref);
    } catch {
      /* not remembered, still applied */
    }
  }
  listeners.forEach((l) => l());
}

/** The switch's current value, from the page (not storage, which may be stale in another tab). */
export function currentPref(): MotionPref {
  if (typeof document === "undefined") return "system";
  return parsePref(document.documentElement.dataset.motion);
}

/** A pop-out window's document: give it the switch now and keep it in step. Returns the unfollow. */
export function followMotion(doc: Document): () => void {
  writeAttr(doc, currentPref());
  extraDocs.add(doc);
  return () => {
    extraDocs.delete(doc);
  };
}

let osQuery: MediaQueryList | null | undefined;
/** True when --m is 0 right now. Worked out by the same rule as the CSS that sets --m
 * (the switch on <html>, then the OS setting) rather than read back with
 * getComputedStyle, which would force a style recalculation of the whole page:
 * this is called during clicks, while hundreds of map cards have just changed. */
export function motionOff(): boolean {
  if (typeof window === "undefined") return false;
  if (osQuery === undefined) osQuery = window.matchMedia?.(OS_QUERY) ?? null;
  return reducedFor(currentPref(), osQuery?.matches ?? false);
}

/** Called whenever the switch or the OS setting changes. Returns the unsubscribe. */
export function onMotionChange(fn: () => void): () => void {
  listeners.add(fn);
  const mq = typeof window !== "undefined" ? window.matchMedia?.(OS_QUERY) : undefined;
  mq?.addEventListener("change", fn);
  return () => {
    listeners.delete(fn);
    mq?.removeEventListener("change", fn);
  };
}

/** The inline script for <head>: set the saved switch before the first paint, so a
 * page that should be still never starts moving. Kept tiny and dependency-free. */
export const MOTION_BOOT = `try{var m=localStorage.getItem(${JSON.stringify(MOTION_KEY)})??localStorage.getItem(${JSON.stringify(oldPrefKey(MOTION_KEY))});if(m==="on"||m==="off")document.documentElement.dataset.motion=m}catch(e){}`;
