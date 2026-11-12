// Text & icon size and density (Settings → Motion & look). Two attributes on <html>, data-text
// (1–6) and data-density (compact, cozy, roomy), set three CSS variables in globals.css:
//   --fs   text: every font-size and line-height is calc(Npx * var(--fs));
//   --sp   space: every padding, margin and gap is calc(Npx * var(--sp));
//   --ctl  boxes: control and icon sizes (heights and widths up to 48px) follow both.
// The defaults are the smallest text and compact spacing, like an enterprise tool: more room for
// the map, the code and the guide. Set before the first paint (LOOK_BOOT), remembered per browser,
// and copied to pop-out windows. No React here, so tests can load it.
import { readPref } from "./prefs";

export type Density = "compact" | "cozy" | "roomy";
/** Dark: neutral graphite like an IDE (the default). Warm: the wall, wood and chalkboard WalkMyCode started with. */
export type Theme = "dark" | "warm";
export const THEMES: Theme[] = ["dark", "warm"];
export const DEFAULT_THEME: Theme = "dark";
export const THEME_KEY = "walkmycode.theme";
export const TEXT_STEPS = [1, 2, 3, 4, 5, 6] as const;
export type TextStep = (typeof TEXT_STEPS)[number];
export const DENSITIES: Density[] = ["compact", "cozy", "roomy"];

/** Each step's text scale: 1 is the smallest (the default), 3 is the original size. */
export const TEXT_SCALE: Record<TextStep, number> = { 1: 0.85, 2: 0.92, 3: 1, 4: 1.08, 5: 1.17, 6: 1.27 };
export const SPACE_SCALE: Record<Density, number> = { compact: 0.55, cozy: 0.78, roomy: 1 };

export const DEFAULT_TEXT: TextStep = 1;
export const DEFAULT_DENSITY: Density = "compact";
export const TEXT_KEY = "walkmycode.text";
export const DENSITY_KEY = "walkmycode.density";

export function parseText(v: string | null | undefined): TextStep {
  const n = Number(v);
  return (TEXT_STEPS as readonly number[]).includes(n) ? (n as TextStep) : DEFAULT_TEXT;
}

export function parseTheme(v: string | null | undefined): Theme {
  return v === "warm" || v === "dark" ? v : DEFAULT_THEME;
}

export function parseDensity(v: string | null | undefined): Density {
  return v === "cozy" || v === "roomy" || v === "compact" ? v : DEFAULT_DENSITY;
}

/** The control-box scale: halfway between text and spacing, never under 0.7 (a box still fits its text). */
export function controlScale(text: TextStep, density: Density): number {
  return Math.max(0.7, Math.round(((TEXT_SCALE[text] + SPACE_SCALE[density]) / 2) * 1000) / 1000);
}

/** Runs in <head> before the first paint: the saved choices onto <html>. */
export const LOOK_BOOT = `try{var s=localStorage,d=document.documentElement;d.dataset.text=s.getItem("${TEXT_KEY}")||"${DEFAULT_TEXT}";d.dataset.density=s.getItem("${DENSITY_KEY}")||"${DEFAULT_DENSITY}";d.dataset.theme=s.getItem("${THEME_KEY}")||"${DEFAULT_THEME}"}catch(e){}`;

// ── in the browser ──

/** Fired on window when the look changes, for what sizes itself in numbers (the terminal). */
export const LOOK_EVENT = "walkmycode:look";

/** The text scale now (--fs), for sizes set from code rather than CSS. 1 outside a browser. */
export function textScale(doc: Document | undefined = typeof document === "undefined" ? undefined : document): number {
  if (!doc) return 1;
  return TEXT_SCALE[parseText(doc.documentElement.dataset.text)];
}

const extraDocs = new Set<Document>();

export interface Look {
  text: TextStep;
  density: Density;
  theme: Theme;
}

export function currentLook(): Look {
  if (typeof document === "undefined") return { text: DEFAULT_TEXT, density: DEFAULT_DENSITY, theme: DEFAULT_THEME };
  const d = document.documentElement.dataset;
  return { text: parseText(d.text), density: parseDensity(d.density), theme: parseTheme(d.theme) };
}

export function savedLook(): Look {
  try {
    const s = window.localStorage;
    return { text: parseText(readPref(s, TEXT_KEY)), density: parseDensity(readPref(s, DENSITY_KEY)), theme: parseTheme(readPref(s, THEME_KEY)) };
  } catch {
    return { text: DEFAULT_TEXT, density: DEFAULT_DENSITY, theme: DEFAULT_THEME };
  }
}

function writeAttrs(doc: Document, look: Look) {
  doc.documentElement.dataset.text = String(look.text);
  doc.documentElement.dataset.density = look.density;
  doc.documentElement.dataset.theme = look.theme;
}

/** Set text size, density and theme in every window, remembered in this browser. */
export function applyLook(look: Look) {
  writeAttrs(document, look);
  for (const d of extraDocs) {
    try {
      writeAttrs(d, look);
    } catch {
      extraDocs.delete(d); // its window has gone
    }
  }
  try {
    window.localStorage.setItem(TEXT_KEY, String(look.text));
    window.localStorage.setItem(DENSITY_KEY, look.density);
    window.localStorage.setItem(THEME_KEY, look.theme);
  } catch {
    /* not remembered, still applied */
  }
  // The map, the docked panels and pop-out windows measure themselves: let them look again.
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event(LOOK_EVENT));
  for (const d of extraDocs) {
    try {
      d.defaultView?.dispatchEvent(new Event("resize"));
    } catch {
      /* its window has gone */
    }
  }
}

/** A pop-out window's document: give it the look now and keep it in step. Returns the unfollow. */
export function followLook(doc: Document): () => void {
  writeAttrs(doc, currentLook());
  extraDocs.add(doc);
  return () => {
    extraDocs.delete(doc);
  };
}

/** The CSS for globals.css's variables, generated from the tables above so they can't drift. */
export function lookCss(): string {
  const rules = [`:root { --fs: ${TEXT_SCALE[DEFAULT_TEXT]}; --sp: ${SPACE_SCALE[DEFAULT_DENSITY]}; --ctl: ${controlScale(DEFAULT_TEXT, DEFAULT_DENSITY)}; }`];
  for (const t of TEXT_STEPS) rules.push(`:root[data-text="${t}"] { --fs: ${TEXT_SCALE[t]}; }`);
  for (const d of DENSITIES) rules.push(`:root[data-density="${d}"] { --sp: ${SPACE_SCALE[d]}; }`);
  for (const t of TEXT_STEPS) for (const d of DENSITIES) rules.push(`:root[data-text="${t}"][data-density="${d}"] { --ctl: ${controlScale(t, d)}; }`);
  return rules.join("\n");
}
