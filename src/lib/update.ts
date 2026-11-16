// The desktop app's update, as the page sees it (docs/DESKTOP.md, "Updates"): checked once a few seconds
// after the main window opens, shown in the update modal (src/components/UpdateModal.tsx), and, after
// "Later", as a chip in the title bar that opens it again. "Skip this version" stays quiet until a newer
// one. One store for the window, so the chip and the modal agree.
import { useSyncExternalStore } from "react";
import { appWindowOf, checkUpdate, installUpdate, isDesktop, type UpdateInfo } from "./desktop";

export interface UpdateState {
  info: UpdateInfo | null;
  phase: "available" | "downloading" | "installing" | "failed";
  open: boolean;
  /** Bytes downloaded so far, of `total` (null until the download says). */
  got: number;
  total: number | null;
  /** Bytes a second, over the whole download. */
  speed: number;
  error: string | null;
}

const SKIP = "walkmycode:update-skip";
const START: UpdateState = { info: null, phase: "available", open: false, got: 0, total: null, speed: 0, error: null };
let state = START;
const subs = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** The state now, outside React. */
export const updateState = (): UpdateState => state;

export function useUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => START);
}

const skipped = () => {
  try {
    return localStorage.getItem(SKIP);
  } catch {
    return null;
  }
};

let checked = false;
/** Look for an update once, a moment after the main window opens (not in pop-outs, not in a browser). */
export function checkForUpdateOnce(delayMs = 4000): void {
  if (checked || !isDesktop() || appWindowOf(window)?.label !== "main") return;
  checked = true;
  setTimeout(async () => {
    try {
      const info = await checkUpdate();
      if (!info || info.version === skipped()) return;
      set({ info, phase: "available", open: true });
    } catch (e) {
      console.warn("[update] check failed:", e);
    }
  }, delayMs);
}

export const openUpdate = () => state.info && set({ open: true });

/** Later: the modal closes, the title bar's chip stays. While installing there is no closing. */
export const closeUpdate = () => state.phase !== "installing" && set({ open: false });

/** Skip this version: no modal and no chip until a newer one. */
export function skipUpdate(): void {
  try {
    if (state.info) localStorage.setItem(SKIP, state.info.version);
  } catch {
    // private window: skipped for this launch only
  }
  set({ info: null, open: false });
}

export async function startInstall(): Promise<void> {
  if (!state.info || state.phase === "downloading" || state.phase === "installing") return;
  const began = Date.now();
  set({ phase: "downloading", open: true, got: 0, total: state.info.size, speed: 0, error: null });
  try {
    await installUpdate((e) => {
      if (e.event === "started") set({ total: e.total ?? state.total });
      else if (e.event === "chunk") {
        const got = state.got + e.bytes;
        set({ got, speed: got / Math.max(0.25, (Date.now() - began) / 1000) });
      } else set({ phase: "installing", open: true });
    });
  } catch (e) {
    set({ phase: "failed", open: true, error: e instanceof Error ? e.message : String(e) });
  }
}

/** For the tests. */
export function _resetUpdate(next: Partial<UpdateState> = {}): void {
  checked = false;
  state = { ...START, ...next };
  for (const f of subs) f();
}

// In development only: window.wmcPreviewUpdate("available" | "downloading" | "installing" | "failed") shows the
// modal with sample notes in a browser, where there is no app to find a real update.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as Window & { wmcPreviewUpdate?: (phase?: UpdateState["phase"]) => void }).wmcPreviewUpdate = (phase = "available") =>
    set({
      info: {
        version: "0.1.4",
        current: "0.1.3",
        date: "2026-11-12T10:00:00Z",
        size: 96_412_345,
        notes: "### Features\n\n* **learn:** talk with the professor, a live voice conversation in the lesson ([#53](https://x)) ([5daa221](https://x))\n\n### Bug Fixes\n\n* **explore:** the professor starts talking straight away\n\n### Performance Improvements\n\n* **look:** one dropdown style across the app",
      },
      phase,
      open: true,
      got: phase === "downloading" ? 59_800_000 : 0,
      total: 96_412_345,
      speed: phase === "downloading" ? 6_100_000 : 0,
      error: phase === "failed" ? "error sending request for url (https://github.com/walkmycode/walkmycode/releases/download/v0.1.4/WalkMyCode_0.1.4_x64-setup.exe)" : null,
    });
}
