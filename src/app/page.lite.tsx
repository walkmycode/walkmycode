"use client";
// WalkMyCode Lite (a Claude artifact) is this one page: the connect screen, the
// Explore room and the Learn room all live here, and the room on screen is
// switched in the page (src/lib/adapters/nav.tsx). The app's own pages are
// used as they are; only the way between them differs.
//
// It opens on the home page, where a kept map waits under "Pick up where you left
// off"; only a deep link to a card or a file (?focus=, ?node=) opens the map at once.
// The loading screen pack-lite puts in front of everything goes once this has mounted.
import { useEffect } from "react";
import dynamic from "next/dynamic";
import Connect from "./page";
import { goLite, interceptRoomLinks, useRoom } from "@/lib/adapters/nav";
import { startHref } from "@/lib/adapters/rooms";
import { dismissBoot } from "@/lib/boot";

const waiting = (text: string) =>
  function Waiting() {
    return (
      <div className="map-wait" role="status" aria-live="polite">
        <div>
          <span className="glow" aria-hidden="true" />
          <p>{text}</p>
        </div>
      </div>
    );
  };
const Explore = dynamic(() => import("./map/page"), { ssr: false, loading: waiting("Opening the map…") });
const Learn = dynamic(() => import("./learn/page"), { ssr: false, loading: waiting("Opening WalkMyCode…") });

/** While the home page sits idle, fetch the map room's code, so opening a map does not wait
 * for two more waves of chunks (seconds each inside Claude). */
function preloadExplore(): () => void {
  const go = () => {
    void import("./map/page").catch(() => undefined);
    // The map room's dock and panels (the chunks map/page asks for once it mounts).
    void import("@/shell/Workspace").catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(go, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(go, 1200);
  return () => window.clearTimeout(t);
}

export default function LitePage() {
  const room = useRoom();
  useEffect(() => interceptRoomLinks(), []);
  useEffect(() => {
    // A deep link opens the map (which goes home by itself when there is nothing to show).
    const deep = startHref(window.location.search);
    if (deep) goLite(deep);
    dismissBoot();
    return preloadExplore();
  }, []);
  if (room === "/map") return <Explore />;
  if (room === "/learn") return <Learn />;
  return <Connect />;
}
