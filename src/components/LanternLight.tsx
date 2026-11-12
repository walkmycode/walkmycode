"use client";
// The light's element in the main window (docs/MOTION.md §5): mounted once in
// the root layout, so it survives a route change. The store (src/lib/light.ts)
// moves it; nothing here re-renders.
import { useEffect, useRef } from "react";
import { mountLight } from "@/lib/lightDom";

export default function LanternLight() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? mountLight(window, ref.current) : undefined), []);
  return <span ref={ref} className="lantern-light" aria-hidden />;
}
