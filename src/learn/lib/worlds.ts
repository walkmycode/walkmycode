/**
 * Variety in the professor's pictures (docs/LEARNING.md, "Use analogy"). Left to itself a model reaches for
 * the same few worlds every time (a bakery and its cakes, a shop, Emily and Jack), so each prompt that writes
 * an analogy is offered a few everyday worlds picked for that lesson or board, a few people's names, and the
 * worlds, places and names this course has already used, to leave alone.
 *
 * Every pick is deterministic: a seed (the course and lesson number, or a lesson's id and board) gives the same
 * worlds on every reload and in the tests. Every world names things the scene drawings can show
 * (src/lib/drawings/names.ts; tests/learn.worlds.test.ts keeps them in the set), so a scene built in it draws well.
 * No React: tests drive it.
 */
import { plain } from "./markup";
import type { Lesson } from "./types";

export type World = {
  id: string;
  /** The world in a few words, as the prompt offers it. */
  name: string;
  /** Things in it that have a drawing, so a scene set there draws well. */
  things: string[];
  /** Words that show a picture is set in this world. */
  match: RegExp;
  /** Overused already: recognised in what a course has used, never offered. */
  worn?: boolean;
};

export const WORLDS: World[] = [
  { id: "football", name: "a football match", things: ["athlete", "ball", "goal", "whistle", "trophy"], match: /\b(football|footballer|goalkeeper|referee|striker)\b/i },
  { id: "music", name: "a band rehearsing for a gig", things: ["musician", "guitar", "drum", "piano", "speaker"], match: /\b(band|orchestra|choir|gig|concert|guitar|drummer|musician|conductor)\b/i },
  { id: "railway", name: "a railway station", things: ["train", "ticket", "clock", "signpost", "driver"], match: /\b(railway|train|platform|station master|carriage)\b/i },
  { id: "farm", name: "a farm through the seasons", things: ["farmer", "sprout", "egg", "basket", "tree"], match: /\b(farm|farmer|harvest|barn|tractor|crops?)\b/i },
  { id: "hospital", name: "a hospital ward", things: ["doctor", "nurse", "stethoscope", "bed", "pill"], match: /\b(hospital|ward|nurse|patient|A&E|surgeon)\b/i },
  { id: "post", name: "a sorting office for post and parcels", things: ["mailbox", "letter", "parcel", "stamp", "van"], match: /\b(post office|postman|postwoman|postie|parcel|sorting office|letterbox)\b/i },
  { id: "games", name: "a board game night", things: ["dice", "chess", "puzzle", "card", "trophy"], match: /\b(board game|chess|dice|draughts|monopoly|game night)\b/i },
  { id: "garden", name: "a garden and its beehive", things: ["bee", "flower", "tree", "leaf", "raincloud"], match: /\b(garden|beehive|bees?|hive|allotment|pond)\b/i },
  { id: "building", name: "a building site", things: ["builder", "brick", "ladder", "blueprint", "toolbox"], match: /\b(building site|builder|scaffold\w*|bricklayer|crane)\b/i },
  { id: "festival", name: "a summer festival", things: ["tent", "music", "balloon", "flag", "crowd"], match: /\b(festival|carnival|mela|funfair)\b/i },
  { id: "library", name: "a public library", things: ["library", "book", "shelves", "card", "stamp"], match: /\b(library|librarian|library book|bookshelf)\b/i },
  { id: "market", name: "a street market", things: ["stall", "basket", "scales", "coin", "apple"], match: /\b(market|stall|trader)\b/i },
  { id: "cooking", name: "a family cooking a big dinner (a curry, a stir-fry, jollof or a roast)", things: ["saucepan", "kettle", "fridge", "plate", "chef"], match: /\b(curry|stir-fry|jollof|roast dinner|saucepan|stew|chopping)\b/i },
  { id: "space", name: "a rocket launch and a space station", things: ["rocket", "astronaut", "planet", "satellite", "moon"], match: /\b(rocket|astronaut|space station|orbit|planet|mission control)\b/i },
  { id: "sea", name: "a ship at sea and its harbour", things: ["ship", "anchor", "wave", "compass", "island"], match: /\b(ship|harbour|sailor|lighthouse|boat)\b/i },
  { id: "workshop", name: "a bike repair workshop", things: ["bicycle", "wrench", "gear", "toolbox", "chain"], match: /\b(workshop|mechanic|garage|repair shop|bike repair)\b/i },
  { id: "sport", name: "a relay race on sports day", things: ["athlete", "stopwatch", "whistle", "medal", "flag"], match: /\b(relay|baton|sports day|athletics|runner)\b/i },
  { id: "airport", name: "an airport", things: ["plane", "passport", "suitcase", "pilot", "gate"], match: /\b(airport|flight|boarding|check-in|pilot|runway)\b/i },
  { id: "fire", name: "a fire station", things: ["firefighter", "siren", "ladder", "bell", "fire"], match: /\b(fire station|firefighter|fire engine|999)\b/i },
  { id: "theatre", name: "a school play", things: ["masks", "microphone", "chair", "speech", "bell"], match: /\b(theatre|school play|rehearsal|costume)\b/i },
  { id: "camping", name: "a camping trip in the hills", things: ["tent", "backpack", "compass", "map", "mountain"], match: /\b(camping|campsite|hike|hiking|trek|tent)\b/i },
  { id: "bus", name: "a city bus route", things: ["bus", "road", "trafficlight", "ticket", "driver"], match: /\b(bus|bus stop|bus route|bus driver)\b/i },
  { id: "weather", name: "a weather station", things: ["thermometer", "raincloud", "sun", "snowflake", "lightning"], match: /\b(weather|forecast|thermometer|rain gauge)\b/i },
  { id: "zoo", name: "a wildlife park", things: ["bird", "fish", "dog", "cat", "tree"], match: /\b(zoo|wildlife park|keeper|aquarium|safari)\b/i },
  // Worn out: the pictures a model falls back on. Recognised in what a course used, never offered.
  { id: "bakery", name: "a bakery, baking and cakes", things: ["cake", "chef", "recipe"], match: /\b(bak(?:e|er|ers|ery|eries|ing|ed)|cakes?|cupcakes?|dough|oven|recipes?)\b/i, worn: true },
  { id: "shop", name: "a shop or tuck shop", things: ["shop", "till", "coin"], match: /\b(tuck shop|corner shop|shopkeeper|sweet shop|supermarket|shop)\b/i, worn: true },
  { id: "toys", name: "toys and a playroom", things: ["teddy", "toycar", "child"], match: /\b(toys?|teddy|playroom)\b/i, worn: true },
  { id: "cloakroom", name: "a cloakroom and its tickets", things: ["coat", "ticket"], match: /\bcloakroom\b/i, worn: true },
];

/** First names as varied as Britain's own, from many backgrounds. Never Emily or Jack (the old defaults). */
export const NAMES = [
  "Priya", "Tomasz", "Chidi", "Mei", "Callum", "Fatima", "Oliver", "Zara", "Hamza", "Niamh", "Arjun", "Leah", "Yusuf", "Grace",
  "Ravi", "Freya", "Tunde", "Hana", "Rhys", "Lena", "Bilal", "Isla", "Jun", "Maya", "Tariq", "Erin", "Kwesi", "Sofia", "Dev", "Aoife",
];
/** Names a model reaches for unprompted: recognised in what a course used. */
const DEFAULT_NAMES = ["Emily", "Jack", "Olivia", "Harry", "Sam", "Tom", "Lucy", "Ben", "Alice", "Bob"];

/** A 32-bit FNV-1a hash: the same seed, the same picks. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** `n` items of `pool` in an order fixed by the seed, skipping those in `avoid`. */
function pick<T>(pool: T[], key: (t: T) => string, seed: string, n: number, avoid: Set<string>): T[] {
  const left = pool.filter((t) => !avoid.has(key(t).toLowerCase()));
  return (left.length >= n ? left : pool)
    .map((t) => ({ t, h: hashSeed(`${seed}|${key(t)}`) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, n)
    .map((x) => x.t);
}

/** A few fresh worlds for this seed, never a worn one, and none this course has used. */
export const pickWorlds = (seed: string, n = 3, used: string[] = []) =>
  pick(WORLDS.filter((w) => !w.worn), (w) => w.id, seed, n, new Set(used.map((u) => u.toLowerCase())));

/** A few people's names for this seed, none this course has used. */
export const pickNames = (seed: string, n = 2, used: string[] = []) => pick(NAMES, (x) => x, seed, n, new Set(used.map((u) => u.toLowerCase())));

/** What a course has already pictured: worlds (ids), places and people's names. */
export type Used = { worlds: string[]; places: string[]; names: string[] };
export const NOTHING_USED: Used = { worlds: [], places: [], names: [] };

const KNOWN_NAMES = new Set([...NAMES, ...DEFAULT_NAMES]);
const KNOWN_NAME = new RegExp(`\\b(${[...KNOWN_NAMES].join("|")})\\b`, "g");
const NOT_A_NAME = /^(The|A|An|Your|My|Our|Their|His|Her|Mum|Dad|Gran|Grandad)$/;

/** The everyday names of a scene's people: its actors or parts whose picture name is a single given name. */
function sceneNames(scene: unknown): string[] {
  const s = scene as Record<string, unknown> | undefined;
  const people = [s?.actors, s?.parts, s?.rows].flatMap((v) => (Array.isArray(v) ? v : [])) as { a?: unknown }[];
  return people
    .map((p) => (typeof p?.a === "string" ? p.a.trim().replace(/'s$/, "") : ""))
    .filter((a) => /^[A-Z][a-z]{1,14}$/.test(a) && !NOT_A_NAME.test(a));
}

/**
 * What the course's most recent lessons pictured, from their analogies and scenes: the worlds they are set in
 * (worn ones too), their scenes' places, and the people in them. Newest first, a few of each.
 */
export function usedPictures(lessons: Lesson[], recent = 6): Used {
  const worlds = new Set<string>();
  const places = new Set<string>();
  const names = new Set<string>();
  const newest = [...lessons].sort((a, b) => b.number - a.number || b.updatedAt - a.updatedAt).slice(0, recent);
  for (const l of newest) {
    for (const b of l.boards) {
      const scene = b.scene as Record<string, unknown> | undefined;
      const text = [b.analogy ?? "", typeof scene?.title === "string" ? scene.title : "", typeof scene?.place === "string" ? scene.place : ""].map(plain).join(" ");
      for (const w of WORLDS) if (w.match.test(text)) worlds.add(w.id);
      if (typeof scene?.place === "string" && scene.place.trim()) places.add(scene.place.trim());
      for (const m of text.matchAll(KNOWN_NAME)) names.add(m[1]);
      for (const n of sceneNames(scene)) names.add(n);
    }
  }
  return { worlds: [...worlds], places: [...places].slice(0, 6), names: [...names].slice(0, 10) };
}

const worldName = (id: string) => WORLDS.find((w) => w.id === id)?.name ?? id;
const offer = (w: World) => `${w.name} (${w.things.join(", ")})`;

/** The "not these again" line: what this course has used, or nothing when it has used nothing. */
export function notAgain(used: Used): string {
  const parts = [
    used.worlds.length ? `worlds: ${used.worlds.map(worldName).join("; ")}` : "",
    used.places.length ? `places: ${used.places.join("; ")}` : "",
    used.names.length ? `names: ${used.names.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? `Already used in this course, so not these again: ${parts.join(". ")}.` : "";
}

/**
 * The variety lines for a prompt. "lesson": choose the lesson's big picture from a few worlds; "chat": the same
 * for a new 💡 picture in an answer; "scene": the board's picture is kept, so only names and the place are fresh.
 */
export function varietyNote(seed: string, used: Used, use: "lesson" | "chat" | "scene", indent = ""): string {
  const names = pickNames(seed, 2, used.names).join(" and ");
  const lines =
    use === "scene"
      ? [`If the board's picture already names its people, keep those names; otherwise call them ${names}. Set it in a place of its own, not one already used.`]
      : [
          `${use === "lesson" ? "Choose the lesson's big picture" : "When you need a new 💡 picture, take it"} from one of these worlds, whichever fits the idea best (the things in brackets can be drawn): ${pickWorlds(seed, 3, used.worlds).map(offer).join("; ")}. Another everyday world from the student's life is fine when it truly fits better, but never baking or a shop: they are worn out.`,
          `People in the picture, if it has any: ${names}.`,
        ];
  const again = notAgain(used);
  return [...lines, ...(again ? [again] : [])].map((l) => `${indent}- ${l}`).join("\n");
}
