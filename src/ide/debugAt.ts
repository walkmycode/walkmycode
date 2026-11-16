// Where the live debugger stopped (docs/DEBUG.md): the file and line, for every code panel on the page. The
// panel that runs the debug sets it on each stop (or when a frame of the call stack is picked) and clears it
// when the program runs on or ends. Explore's shell opens that file at that line, which the Files tree then
// follows; any open panel on that file marks the line. One debug at a time owns it.
import { useSyncExternalStore } from "react";

export interface DebugAt {
  /** The workspace path of the file the program is stopped in. */
  path: string;
  line: number;
  /** The panel debugging (its output id). */
  owner: string;
}

let at: DebugAt | null = null;
const subs = new Set<() => void>();

export const debugAt = {
  get: (): DebugAt | null => at,
  set(next: DebugAt | null) {
    if (at === next || (at && next && at.path === next.path && at.line === next.line && at.owner === next.owner)) return;
    at = next;
    for (const f of subs) f();
  },
  /** Clear it, only if this panel set it. */
  clear(owner: string) {
    if (at?.owner === owner) debugAt.set(null);
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};

export function useDebugAt(): DebugAt | null {
  return useSyncExternalStore(debugAt.subscribe, debugAt.get, () => null);
}
