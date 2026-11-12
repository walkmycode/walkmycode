"use client";
import { useEffect, useState } from "react";

/** The time, read once when the component appears and again every half minute: for "5 min ago" and "due today", which must not change in the middle of a draw. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
