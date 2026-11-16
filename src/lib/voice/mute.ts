"use client";
// Explore's mute (owner, 12 Nov 2026): one switch in the top bar silences
// everything Explore reads aloud (tours, fly-throughs, Read aloud, Claude's
// narration on the MCP page) while each keeps its pace, so a tour still moves
// on by itself as if it had been read. The Learn room has its own switch
// ("Read only"); this one does not touch it. Remembered in this browser.
import { useSyncExternalStore } from "react";
import { readPref } from "@/lib/prefs";

const KEY = "walkmycode:explore-muted";
const listeners = new Set<() => void>();
let muted: boolean | null = null;

/** Whether Explore is muted now. */
export function exploreMuted(): boolean {
  if (muted === null) {
    try {
      muted = readPref(localStorage, KEY) === "on";
    } catch {
      muted = false;
    }
  }
  return muted;
}

/** Mute or unmute Explore; muting stops what is being read this moment. */
export function setExploreMuted(on: boolean): void {
  muted = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the switch lasts until the page closes.
  }
  listeners.forEach((f) => f());
  if (on) void import("./narrate").then((m) => m.stopNarration());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

/** Explore's mute for a component, re-rendered when it changes. */
export function useExploreMuted(): boolean {
  return useSyncExternalStore(subscribe, exploreMuted, () => false);
}

/** How long a text takes to read, for the silent narrator: Learn's read-only pace. */
export const readTime = (text: string): number => Math.max(1400, text.length * 47);
