/**
 * The drawings an analogy scene is made of, and how a scene finds one.
 *
 * The professor names a drawing when it can ("teddy", "van"); when it gives
 * no name, or one that is not in the set, the everyday label finds it ("the
 * postman" is drawn as the van, "a pigeonhole" as the drawer). Nothing a model
 * writes is ever drawn as markup: a name only selects one of these.
 */
import { BASE } from "./set/base";
import { NATURE } from "./set/nature";
import { PEOPLE } from "./set/people";
import { PLACES } from "./set/places";
import { TECH } from "./set/tech";
import { ROLES } from "./set/roles";
import { SYSTEMS } from "./set/systems";
import { CODE } from "./set/code";
import { DEVICES } from "./set/devices";
import { SCIENCE } from "./set/science";
import { BODY } from "./set/body";
import { SOCIETY } from "./set/society";
import { WORK } from "./set/work";
import { HOME } from "./set/home";
import { PLAY } from "./set/play";
import type { DrawingDef, DrawingSet } from "./types";

export type { DrawingDef, DrawingSet } from "./types";

export const DRAWINGS: DrawingSet = {
  ...BASE, ...PEOPLE, ...PLACES, ...NATURE, ...TECH,
  ...ROLES, ...SYSTEMS, ...CODE, ...DEVICES, ...SCIENCE, ...BODY, ...SOCIETY, ...WORK, ...HOME, ...PLAY,
};

/** The colours a scene may give a drawing, by name (a model never writes a colour value). */
export const TINTS = {
  yellow: "#f3d77a",
  blue: "#7fbfe6",
  green: "#8fd69a",
  pink: "#ee8f86",
  purple: "#b79cf0",
  orange: "#f0a94b",
  brown: "#c9935b",
  grey: "#8e929c",
  white: "#f4f5f7",
} as const;
export type Tint = keyof typeof TINTS;
export const isTint = (v: unknown): v is Tint => typeof v === "string" && Object.hasOwn(TINTS, v);

/** How each person in a scene differs from the next: hair style, shirt, skin and hair colour. */
export type Look = { v?: "b" | "c"; tint: string; skin: string; hair: string };
export const LOOKS: Look[] = [
  { v: "b", tint: TINTS.yellow, skin: "#f1c9a5", hair: "#4a3728" },
  { v: "c", tint: TINTS.blue, skin: "#b9805a", hair: "#2a1d16" },
  { tint: TINTS.green, skin: "#e8b990", hair: "#b0562c" },
  { v: "c", tint: TINTS.pink, skin: "#8a5a3c", hair: "#1e1512" },
  { tint: TINTS.purple, skin: "#6f4630", hair: "#1e1512" },
  { v: "b", tint: TINTS.orange, skin: "#f3d3ae", hair: "#1f1a1a" },
];

const SMALL = new Set(["a", "an", "the", "my", "your", "his", "her", "their", "our", "its", "this", "that", "some", "of", "to", "in", "on", "at", "for", "and", "with", "is", "it", "away", "up", "out", "off", "back", "over", "down", "in", "by", "from"]);
/** A label's words, lower-case, without the small words; a plural loses its s. */
export function words(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !SMALL.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** The small words after which a label says where a thing is or what it has, not what it is. */
const ABOUT = /\s(?:at|in|on|of|with|for|to|from|by|near|under|behind|inside|outside|who|that|which)\s/;

let index: { phrase: Map<string, string>; word: Map<string, string> } | null = null;
function lookup() {
  if (index) return index;
  const phrase = new Map<string, string>();
  const word = new Map<string, string>();
  const names = Object.keys(DRAWINGS);
  // A drawing's own name wins over another drawing's "also"; a whole phrase wins over one of its words.
  for (const name of names) phrase.set(words(name).join(" "), name);
  for (const name of names) for (const also of DRAWINGS[name].also) if (!phrase.has(words(also).join(" "))) phrase.set(words(also).join(" "), name);
  for (const [p, name] of phrase) {
    const ws = p.split(" ");
    const head = ws.at(-1);
    // Only a two-word phrase lends its last word ("toy box" makes a box findable): in a longer one the last word is rarely the thing.
    if (ws.length === 2 && head && !phrase.has(head) && !word.has(head)) word.set(head, name);
  }
  return (index = { phrase, word });
}

/**
 * The drawing for a holder or a thing: the name given if the set has it, else
 * the one its labels call for, else null (the page then draws a plain token).
 * Labels are tried in order, whole first, then word by word from the last (in
 * "the order letter" the letter is the thing).
 */
export function findDrawing(name: string | undefined, ...labels: (string | undefined)[]): string | null {
  const { phrase, word } = lookup();
  for (const text of [name, ...labels]) {
    if (!text) continue;
    const ws = words(text);
    if (!ws.length) continue;
    const whole = phrase.get(ws.join(" "));
    if (whole) return whole;
    // "a child at the door" is a child: what comes before "at", "of", "with" is the thing itself, so it is tried first.
    const subject = words(text.toLowerCase().split(ABOUT)[0]);
    for (const part of subject.length && subject.length < ws.length ? [subject, ws] : [ws]) {
      for (let i = part.length - 1; i >= 0; i--) {
        const hit = phrase.get(part[i]) ?? word.get(part[i]);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export const drawingOf = (name: string | null | undefined): DrawingDef | null => (name && Object.hasOwn(DRAWINGS, name) ? DRAWINGS[name] : null);

/** The names a professor may pick from, for its prompt: short, in one line. */
export const drawingNames = (): string => Object.keys(DRAWINGS).join(", ");
