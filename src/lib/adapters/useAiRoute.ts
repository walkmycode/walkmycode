"use client";
import { useEffect, useState } from "react";
import { aiRoute } from "./runtime";
import type { AiRoute } from "./select";

/** Where the guide's answers come from on this page; null while Claude's runtime is
 * still being asked (inside a frame that never answers, that takes ten seconds). */
export function useAiRoute(): AiRoute | null {
  const [route, setRoute] = useState<AiRoute | null>(null);
  useEffect(() => {
    let live = true;
    void aiRoute().then((r) => live && setRoute(r));
    return () => {
      live = false;
    };
  }, []);
  return route;
}
