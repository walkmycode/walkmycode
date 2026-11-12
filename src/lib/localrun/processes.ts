// Every program WalkMyCode starts on this computer (a run, a terminal) is kept
// here, so a stop kills it with everything it started, and the server going
// away kills them all. On Windows a process tree is killed with
// `taskkill /T /F`; elsewhere each run gets its own process group, killed
// whole.
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface Killable {
  pid?: number;
  /** Kill it and everything it started. Safe to call twice. */
  kill(): void;
}

const live = new Set<Killable>();
let hooked = false;

/** Kill a process and its children, now (synchronous, so it also works while the server exits). */
export function killTree(pid: number | undefined, platform: NodeJS.Platform = process.platform): void {
  if (!pid) return;
  try {
    if (platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
    else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
  } catch {
    // Already gone.
  }
}

/** Keep a process until it ends; returns the undo. */
export function track(k: Killable): () => void {
  hookExit();
  live.add(k);
  return () => void live.delete(k);
}

/** How many are running (tests). */
export const running = () => live.size;

/** Kill every program WalkMyCode started. */
export function killAll(): void {
  for (const k of [...live]) {
    try {
      k.kill();
    } catch {
      // Keep going: the rest must still be killed.
    }
  }
  live.clear();
}

/** When the server stops, nothing it started is left running. */
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  process.once("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      killAll();
      // Only exit when nobody else (Next, the MCP server) handles the signal.
      if (process.listenerCount(sig) === 0) process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

/** Spawn a program as its own group (so it can be killed whole), tracked until it exits. */
export function spawnTracked(file: string, args: string[], o: SpawnOptions): ChildProcess {
  const win = process.platform === "win32";
  // A .cmd or .bat (npm's tsx shim) only starts through cmd.exe.
  const shim = win && /\.(cmd|bat)$/i.test(file);
  // An empty argument stays quoted ("" — `claude --tools ""`), or the next argument becomes its value.
  const quote = (s: string) => (s === "" || /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const child = shim
    ? spawn(/* turbopackIgnore: true */ process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${[file, ...args].map(quote).join(" ")}"`], { ...o, windowsVerbatimArguments: true, windowsHide: true })
    : spawn(/* turbopackIgnore: true */ file, args, { ...o, windowsHide: true, detached: !win });
  const untrack = track({ pid: child.pid, kill: () => killTree(child.pid) });
  child.once("exit", untrack);
  child.once("error", untrack);
  return child;
}
