// How a Markdown file opens in the Code panel: as it reads (Preview), its source, or both side by side
// (Split), as VS Code offers them. One choice for every Markdown file, remembered in this browser.
import { useSyncExternalStore } from "react";

export type MdView = "preview" | "split" | "source";
const KEY = "walkmycode:md-view";
const VIEWS: MdView[] = ["preview", "split", "source"];

let now: MdView | null = null;
const listeners = new Set<() => void>();

export function readMdView(): MdView {
  if (now === null) {
    try {
      const v = localStorage.getItem(KEY) as MdView | null;
      now = v && VIEWS.includes(v) ? v : "preview";
    } catch {
      now = "preview";
    }
  }
  return now;
}

export function setMdView(v: MdView): void {
  now = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export function useMdView(): MdView {
  return useSyncExternalStore(subscribe, readMdView, () => "preview");
}
