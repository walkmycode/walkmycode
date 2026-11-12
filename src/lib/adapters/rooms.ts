// WalkMyCode's rooms and the links to them (pure, so tests can read them without React).
export type Room = "/" | "/map" | "/learn";
const ROOMS: readonly Room[] = ["/", "/map", "/learn"];
/** The rooms' own query parameters: the map's deep links and the Learn room's "Teach me this". */
const ROOM_PARAMS = ["focus", "node", "teach", "from", "snippet"];

/** The query after opening a room: the page's own parameters (whatever the host that serves it
 * put there) stay; the rooms' parameters are the new link's alone. */
export function roomSearch(current: string, next: string): string {
  const q = new URLSearchParams(current);
  for (const k of ROOM_PARAMS) q.delete(k);
  for (const [k, v] of new URLSearchParams(next)) q.append(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The map's deep-link parameters: a file and lines, or a card. */
const DEEP = ["focus", "node"];

/** Where a page opened afresh starts (WalkMyCode Lite): a deep link to a card or a file
 * (?focus=, ?node=) opens the map at once, as "/map?…" with only those parameters; anything
 * else starts on the home page, where the kept map waits under "Pick up where you left off".
 * Null means home. */
export function startHref(search: string): string | null {
  const q = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of DEEP) for (const v of q.getAll(k)) if (v) keep.append(k, v);
  const s = keep.toString();
  return s ? `/map?${s}` : null;
}

/** "/map?focus=a.ts:3#x" → its room, query and hash; null for anything that is not one of the rooms. */
export function parseRoomHref(href: string): { room: Room; search: string; hash: string } | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href);
  if (!m) return null;
  const path = m[1].replace(/\/+$/, "") || "/";
  if (!(ROOMS as readonly string[]).includes(path)) return null;
  return { room: path as Room, search: m[2] ?? "", hash: m[3] ?? "" };
}
