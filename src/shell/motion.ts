// The in-app motion switch: follow the system's reduce-motion setting, or
// force motion on or off. It sets data-motion on <html>, which the shell's
// motion tokens in globals.css read. Remembered in this browser only.
import { readPref, removePref } from "../lib/prefs";

export type MotionPref = "system" | "on" | "off";
const KEY = "walkmycode.motion";

export function savedMotion(): MotionPref {
  try {
    const v = readPref(window.localStorage, KEY);
    return v === "on" || v === "off" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyMotion(pref: MotionPref, save = true) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.motion;
  else root.dataset.motion = pref;
  if (!save) return;
  try {
    if (pref === "system") removePref(window.localStorage, KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    /* not remembered, still applied */
  }
}
