"use client";
// Moving between the rooms. In the app they are routes (/, /map, /learn) and
// Next's router moves between them. WalkMyCode Lite is one static page inside
// Claude, so there every room lives in that page: the room is kept here, and a
// link's query and hash go into the address bar (same document, the page's own
// path untouched), where the rooms already read them (?focus=, ?teach=, #level).
// WalkMyCode for Claude's page (the MCP target) is one static page too, and moves
// between its rooms the same way.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore, type ComponentProps } from "react";
import { parseRoomHref, roomSearch, type Room } from "./rooms";
import { ONE_PAGE as LITE } from "./target";

let room: Room = "/";
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Lite: open a room in this page. False for an href that is not a room. */
export function goLite(href: string): boolean {
  const to = parseRoomHref(href);
  if (!to) return false;
  // replaceState, not pushState: a history entry the frame's host owns would
  // send Back somewhere this page cannot follow. The host's own parameters stay.
  window.history.replaceState(null, "", window.location.pathname + roomSearch(window.location.search, to.search) + to.hash);
  if (room !== to.room) {
    room = to.room;
    for (const l of listeners) l();
  }
  return true;
}

/** Lite: every click on a link to a room (the top bar, Learn's "See it in your code")
 * opens it in this page, so nothing navigates the artifact's frame away. */
export function interceptRoomLinks(): () => void {
  const target = (e: MouseEvent) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    const href = a?.getAttribute("href") ?? "";
    return a && parseRoomHref(href) ? href : null;
  };
  const onClick = (e: MouseEvent) => {
    const href = target(e);
    if (!href || e.button !== 0) return;
    // Ahead of React: a Next <Link> would fetch the route from a server Lite does not have.
    e.preventDefault();
    e.stopPropagation();
    goLite(href);
  };
  // A middle click would open the room in a tab of its own, where it does not exist.
  const onAux = (e: MouseEvent) => {
    if (target(e)) e.preventDefault();
  };
  window.addEventListener("click", onClick, true);
  window.addEventListener("auxclick", onAux, true);
  return () => {
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("auxclick", onAux, true);
  };
}

const useLiteRoom = (): string => useSyncExternalStore(subscribe, () => room, () => "/");
const useAppRoom = (): string => usePathname() ?? "";
/** The room on screen: the route in the app, the page's own room in Lite. */
export const useRoom: () => string = LITE ? useLiteRoom : useAppRoom;

const useLiteGo = () => goLite as (href: string) => void;
function useAppGo(): (href: string) => void {
  const router = useRouter();
  return useCallback((href: string) => router.push(href), [router]);
}
/** Go to a room from code (after "Map it", say). */
export const useGo: () => (href: string) => void = LITE ? useLiteGo : useAppGo;

function useAppReplace(): (href: string) => void {
  const router = useRouter();
  return useCallback((href: string) => router.replace(href), [router]);
}
/** Go to a room without leaving a history entry behind (Lite never leaves one), so Back
 * doesn't return to a room that would only send you on again. */
export const useGoReplace: () => (href: string) => void = LITE ? useLiteGo : useAppReplace;

/** A link to a room: Next's Link in the app; in Lite a plain anchor, which
 * interceptRoomLinks opens in the page (and which never prefetches a route). */
export function RoomLink({ href, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  return LITE ? <a href={href} {...rest} /> : <Link href={href} {...rest} />;
}
