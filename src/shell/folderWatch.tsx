"use client";
// Explore keeps up with the folders its map was made from (src/lib/folderCheck.ts). It checks when the window
// comes back into focus or the page is shown again, and every minute while the room is open and in view; the
// Files panel's "Refresh files" checks now (src/shell/panels/FilesPanel.tsx). A change is taken in where the
// user is, with one quiet line ("Read 1 new file from rust: SYNTAX.md"): the open files, the selection and the
// layout stay, and a file that is gone closes. Only one check runs at a time, and a check on its own never
// makes the browser ask for permission.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { TARGET } from "@/lib/adapters/target";
import { canCheck, checkFolders, folderIo } from "@/lib/folderCheck";
import type { Build } from "@/lib/remap";
import { getWorkspace, setWorkspace, useWorkspace } from "@/lib/store";
import { toast } from "./Toast";
import { useShell } from "./WorkspaceProvider";

/** Every minute while the room is open and in view. */
const EVERY_MS = 60_000;
/** Focus and "visible" come together: one check for both. */
const SETTLE_MS = 5_000;

export interface SyncState {
  /** "Checking…" for the user's click, "Reading…" while changes are taken in; null otherwise. */
  busy: "checking" | "reading" | null;
  /** When this page last listed a workspace's folders (ms), and which workspace. */
  checked: { id: string; at: number } | null;
}

let state: SyncState = { busy: null, checked: null };
const listeners = new Set<() => void>();
const set = (s: Partial<SyncState>) => {
  state = { ...state, ...s };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useFolderSync(): SyncState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Files gone from disk: the room closes their tabs. */
const goneListeners = new Set<(paths: string[]) => void>();

let running: Promise<void> | null = null;
let lastAuto = 0;

/** Check the open workspace's folders now. `manual`: the user's click, so it says what it found, and the browser
 * may ask to read a folder again; a check on its own stays quiet and never asks. */
export function refreshFiles(opts: { manual: boolean }): Promise<void> {
  // A click during a check on its own: that check first, then the click's (which says what it found).
  if (running) return opts.manual ? running.then(() => refreshFiles(opts)) : running;
  if (!opts.manual && Date.now() - lastAuto < SETTLE_MS) return Promise.resolve();
  if (!opts.manual) lastAuto = Date.now();
  running = run(opts.manual).finally(() => {
    running = null;
    set({ busy: null });
  });
  return running;
}

async function run(manual: boolean): Promise<void> {
  const w = getWorkspace();
  if (!w || !canCheck(w, TARGET)) return;
  if (manual) set({ busy: "checking" });
  // The analyzer's worker is only asked for once something changed, as Map again does (src/components/MapAgain.tsx).
  const build: Build = async (req) => {
    set({ busy: "reading" });
    const { buildInWorker } = await import("@/analyzer/buildInWorker");
    return buildInWorker(req, () => {});
  };
  try {
    const got = await checkFolders(w, folderIo, build, { ask: manual });
    if (got.listed) set({ checked: { id: w.id, at: Date.now() } });
    // Something else changed the workspace meanwhile (a save, another map): the next check takes it from there.
    if (getWorkspace() !== w) return;
    if (got.workspace) setWorkspace(got.workspace);
    if (got.removed.length) for (const l of goneListeners) l(got.removed);
    if (got.words) toast(got.words);
    else if (manual && got.unread.length) toast(`The browser did not let me read ${got.unread.join(" and ")} again. Open Folders and add it once more.`);
    else if (manual) toast("No file changed since the folder was read.");
  } catch (e) {
    if (manual) toast(`The folder could not be read again: ${(e as Error).message}`);
    else console.info("WalkMyCode: the folder could not be checked.", (e as Error).message);
  }
}

/** In the room: checks on focus, on showing again and every minute, and closes the tabs of files gone. */
export default function FolderWatch() {
  const { files, closeFile } = useShell();
  const w = useWorkspace();
  const can = !!w && canCheck(w, TARGET);
  const id = w?.id;
  const open = useRef({ files, closeFile });
  useEffect(() => {
    open.current = { files, closeFile };
  }, [files, closeFile]);
  useEffect(() => {
    const gone = (paths: string[]) => {
      const { files, closeFile } = open.current;
      const set = new Set(paths);
      for (const f of files) if (set.has(f.path)) closeFile(f.path);
    };
    goneListeners.add(gone);
    return () => {
      goneListeners.delete(gone);
    };
  }, []);
  useEffect(() => {
    if (!can) return;
    const check = () => {
      if (document.visibilityState === "visible") void refreshFiles({ manual: false });
    };
    // Once as the room opens (after it has settled), then on focus, on showing again and every minute.
    const first = window.setTimeout(check, 1500);
    const every = window.setInterval(check, EVERY_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [can, id]);
  return null;
}
