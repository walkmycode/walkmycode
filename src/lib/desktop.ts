// WalkMyCode desktop (docs/DESKTOP.md): the same app, shown in a frameless Tauri
// window whose title bar is WalkMyCode's own top bar. Everything desktop-only is
// decided here, at run time: in a browser none of it exists and nothing changes.
import { useSyncExternalStore } from "react";

/** Inside the desktop app's window (Tauri adds its IPC before any page script runs). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const never = () => () => {};

/** isDesktop() for a component: false on the server and while hydrating, then the truth. */
export function useDesktop(): boolean {
  return useSyncExternalStore(never, isDesktop, () => false);
}

/** The props that make an element drag the window (and double-click maximise it), in the
 * desktop app only. Tauri's drag region works on the element clicked itself, never its
 * children, so only empty space and plain text carry it: never a button, link or input. */
export function dragRegion(desktop: boolean): { "data-tauri-drag-region"?: "" } {
  return desktop ? { "data-tauri-drag-region": "" } : {};
}

type Bridge = { invoke(cmd: string, args?: unknown): Promise<unknown>; metadata?: { currentWindow?: { label?: string } } };

/** What the window buttons do to a window of the app. */
export interface AppWindow {
  label: string;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Move the window with the mouse: call while the button is down. */
  startDragging(): Promise<void>;
}

/** A window of the app, by its DOM window: this page's own, or a pop-out it opened. Calls go through
 * that window's own bridge to the app, so the app checks them against that window's permissions
 * (src-tauri/src/lib.rs, page_capability). Null outside the desktop app. */
export function appWindowOf(win: Window): AppWindow | null {
  const bridge = (win as Window & { __TAURI_INTERNALS__?: Bridge }).__TAURI_INTERNALS__;
  const label = bridge?.metadata?.currentWindow?.label;
  if (!bridge || !label) return null;
  const call = (cmd: string) => bridge.invoke(`plugin:window|${cmd}`, { label });
  return {
    label,
    minimize: async () => void (await call("minimize")),
    toggleMaximize: async () => void (await call("toggle_maximize")),
    close: async () => void (await call("close")),
    isMaximized: async () => !!(await call("is_maximized")),
    startDragging: async () => void (await call("start_dragging")),
  };
}

/** Close a window this page opened (a pop-out). In the desktop app a pop-out is a window of the app
 * (src-tauri/src/popout.rs), and window.close() from the page only empties it, leaving its frame:
 * the app closes it instead (src/shell/popout.ts also points the pop-out's own close() here). */
export async function closeOpened(win: Window): Promise<void> {
  const app = isDesktop() ? appWindowOf(win) : null;
  if (app?.label.startsWith("popout-")) {
    try {
      return await app.close();
    } catch {
      // fall through to the page's own close
    }
  }
  win.close();
}

/** The system's folder picker: the folder's path, or null when cancelled. */
export async function pickFolderPath(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Choose a folder" });
  return typeof picked === "string" ? picked : null;
}

/** A newer version of the desktop app (src-tauri/src/lib.rs, update_check). */
export interface UpdateInfo {
  version: string;
  current: string;
  /** RFC 3339, when the release was published. */
  date: string | null;
  /** Its release notes (release-please's CHANGELOG section); read with lib/releaseNotes.ts. */
  notes: string | null;
  /** The installer's size in bytes, when the feed says. */
  size: number | null;
}

/** How an install is going (src-tauri/src/lib.rs, UpdateProgress). */
export type UpdateEvent = { event: "started"; total: number | null } | { event: "chunk"; bytes: number } | { event: "installing" };

/** Is there a newer version? Null in a browser, in `desktop:dev`, and when this is the newest. */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<UpdateInfo | null>("update_check")) ?? null;
}

/** Download the update found by checkUpdate(), telling `on` how it goes; the app then installs it and
 * restarts, so this only comes back when the download fails (it rejects with the reason). */
export async function installUpdate(on: (e: UpdateEvent) => void): Promise<void> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const onEvent = new Channel<UpdateEvent>();
  onEvent.onmessage = on;
  await invoke("update_install", { onEvent });
}
