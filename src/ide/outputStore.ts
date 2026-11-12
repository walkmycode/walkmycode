// The output of every open IDE, and where it is shown: the one source of
// truth for both places it can live. Each Ide (Ide.tsx) keeps its run's
// output here under its own id and draws it under the editor; when the output
// is popped out into Explore's dock, the Output panel (src/shell/panels/
// OutputPanel.tsx) draws the same entry instead, so a run shows in whichever
// place the output is. Pure (no React, no DOM): React reads it through
// useSyncExternalStore, and the tests drive it directly.
import type { OutPart } from "./python";

export interface OutputState {
  parts: OutPart[];
  /** "Loading Python…" and the like, while a run starts. */
  status: string;
  running: boolean;
  /** Something ran since the last reset (so "printed nothing" can be said). */
  ran: boolean;
  /** What a run does here, before the first run. */
  hint: string;
  /** Said when a run printed nothing. */
  empty: string;
  /** A tip under the hint (breakpoints). */
  tip: string;
  /** What the output belongs to, for the popped-out panel's title. */
  label: string;
}

export const EMPTY_OUTPUT: OutputState = { parts: [], status: "", running: false, ran: false, hint: "", empty: "", tip: "", label: "" };

/** Where the output lives. `popped` while an Output dock panel is open; `owner` is the Ide it shows. */
export interface DockState {
  popped: boolean;
  owner: string | null;
  /** A dock that can take the output (Explore); none in Learn, so no "Pop out". */
  canPop: boolean;
}

/** What the dock does when asked to pop the output out or dock it back. */
export interface OutputHost {
  popOut(): void;
  dockBack(): void;
}

/** Printed lines arrive one at a time: join them into one block per kind. */
export function addPart(parts: OutPart[], p: OutPart): OutPart[] {
  const last = parts.at(-1);
  if (last && "text" in last && "text" in p && last.kind === p.kind) {
    return [...parts.slice(0, -1), { kind: p.kind, text: last.text + p.text } as OutPart];
  }
  return [...parts, p];
}

const same = (a: OutputState, b: OutputState) =>
  (Object.keys(a) as (keyof OutputState)[]).every((k) => a[k] === b[k]);

export function createOutputStore() {
  const entries = new Map<string, OutputState>();
  let dock: DockState = { popped: false, owner: null, canPop: false };
  let panels = 0;
  let host: OutputHost | null = null;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  const setDock = (d: Partial<DockState>) => {
    const next = { ...dock, ...d };
    if (next.popped === dock.popped && next.owner === dock.owner && next.canPop === dock.canPop) return;
    dock = next;
    emit();
  };

  return {
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    get: (id: string | null | undefined): OutputState => (id ? entries.get(id) : undefined) ?? EMPTY_OUTPUT,
    has: (id: string) => entries.has(id),
    /** Change one Ide's output. Nothing is announced when nothing changed. */
    update(id: string, patch: Partial<OutputState> | ((s: OutputState) => Partial<OutputState>)) {
      const prev = entries.get(id) ?? EMPTY_OUTPUT;
      const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
      if (entries.has(id) && same(prev, next)) return;
      entries.set(id, next);
      emit();
    },
    append(id: string, p: OutPart) {
      this.update(id, (s) => ({ parts: addPart(s.parts, p) }));
    },
    /** An Ide went away: its output goes, and the panel stops showing it. */
    remove(id: string) {
      const had = entries.delete(id);
      if (dock.owner === id) setDock({ owner: null });
      else if (had) emit();
    },

    dock: () => dock,
    /** The Ide the popped-out output shows (the last one run or touched). */
    setOwner(id: string | null) {
      setDock({ owner: id });
    },
    /** An Output panel mounted (or unmounted): counted, so StrictMode's double mount is harmless. */
    attachPanel() {
      panels += 1;
      setDock({ popped: true });
      return () => {
        panels = Math.max(0, panels - 1);
        if (!panels) setDock({ popped: false });
      };
    },
    /** The dock registers itself (Explore); Learn never does. Returns the undo. */
    setHost(h: OutputHost | null) {
      host = h;
      setDock({ canPop: !!h });
      return () => {
        if (host === h) {
          host = null;
          setDock({ canPop: false });
        }
      };
    },
    /** "Pop out" from an Ide: it becomes what the panel shows, then the dock opens the panel. */
    popOut(owner: string) {
      setDock({ owner });
      host?.popOut();
    },
    /** Open (or bring forward) the Output panel as it is, whatever editor owns it: the top bar's Terminal button. */
    show() {
      host?.popOut();
    },
    /** "Dock back": the dock closes the panel; its unmount puts the output back under the editor. */
    dockBack() {
      host?.dockBack();
    },
  };
}

export type OutputStore = ReturnType<typeof createOutputStore>;

/** The page's one store. */
export const outputs = createOutputStore();
