// What a card on the home page says about a map (docs/design/home-redesign.html,
// "Pick up where you left off"): its name, what it is made of, how big it is,
// and how its cards fall into the map's five lanes, for the small lane preview.
// Plain code, no browser or server APIs: /api/demo makes the cards of indexed
// maps on the server, the home page makes the saved workspace's in the browser.
import type { CodeMap, Layer } from "@/analyzer/types";

/** The map's lanes, left to right, as the map draws them. */
export const LANES: readonly Layer[] = ["ui", "api", "logic", "data", "external"];

export type LaneCounts = Record<Layer, number>;

export interface MapCard {
  name: string;
  /** Repo labels, in map order (one entry for a one-folder map). */
  repos: string[];
  /** App services, when the map is a system of services. */
  apps: string[];
  /** Frameworks of the apps, each once, in map order. */
  frameworks: string[];
  files: number;
  routes: number;
  tables: number;
  lanes: LaneCounts;
  /** When the map was made (ISO). */
  generatedAt: string;
}

/** How many cards the map has in each lane. */
export function laneCounts(map: Pick<CodeMap, "nodes">): LaneCounts {
  const c: LaneCounts = { ui: 0, api: 0, logic: 0, data: 0, external: 0 };
  for (const n of map.nodes ?? []) if (Object.prototype.hasOwnProperty.call(c, n.layer)) c[n.layer]++;
  return c;
}

export function cardOf(map: CodeMap, name: string = map.name): MapCard {
  const apps = (map.services ?? []).filter((s) => s.kind === "app");
  return {
    name,
    repos: (map.repos ?? []).map((r) => r.label),
    apps: map.system?.kind === "services" ? apps.map((s) => s.name) : [],
    frameworks: [...new Set(apps.map((s) => s.framework).filter((f): f is string => !!f))],
    files: map.stats?.files ?? 0,
    routes: map.stats?.routes ?? 0,
    tables: map.stats?.tables ?? 0,
    lanes: laneCounts(map),
    generatedAt: map.generatedAt,
  };
}

const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-GB")} ${x === 1 ? one : many}`;

/** "Next.js + Flutter + FastAPI", at most three, then "+2". */
function joined(xs: string[], sep: string): string {
  return xs.length > 3 ? `${xs.slice(0, 3).join(sep)} +${xs.length - 3}` : xs.join(sep);
}

/** The card's tag ("3 repos", "2 services", or none) and its one line of detail:
 * the stack (or the parts) — files · routes. */
export function cardMeta(c: MapCard): { tag: string | null; line: string } {
  const tag = c.repos.length > 1 ? n(c.repos.length, "repo") : c.apps.length > 1 ? n(c.apps.length, "service") : null;
  const lead = c.frameworks.length ? joined(c.frameworks, " + ") : c.apps.length > 1 ? joined(c.apps, " · ") : c.repos.length > 1 ? joined(c.repos, " · ") : "";
  const stats = `${n(c.files, "file")} · ${n(c.routes, "route")}`;
  return { tag, line: lead ? `${lead} — ${stats}` : stats };
}

/** Blocks per lane for the preview: the fullest lane gets `max`, the others in proportion,
 * a lane with any card at least one, an empty lane none. */
export function laneBlocks(lanes: LaneCounts, max = 8): number[] {
  const counts = LANES.map((l) => lanes[l] ?? 0);
  const top = Math.max(0, ...counts);
  return counts.map((c) => (c <= 0 || top <= 0 ? 0 : Math.max(1, Math.round((c / top) * max))));
}

/** How many of `n` cards to show in `cols` columns: whole rows, two at most (three cards in one column). */
export function wholeRows(n: number, cols: number): number {
  if (cols <= 0 || n <= cols) return n;
  const most = cols === 1 ? 3 : cols * 2;
  return Math.min(Math.floor(n / cols) * cols, most);
}

/** "just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", else "12 Sep" (with the year when it differs). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days < 2) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** Indexed maps named "example-…" (npm run index -- <dir> --name example-shop) are offered
 * as examples, apart from the user's own maps. */
export const isExample = (name: string) => /^example-/i.test(name);

/** "example-online-shop" → "Online shop". */
export function exampleTitle(name: string): string {
  const s = name.replace(/^example-/i, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}
