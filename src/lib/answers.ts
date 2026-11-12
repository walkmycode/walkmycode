"use client";
// "Where does this point?" (docs/SERVICES.md §13): what the user tells WalkMyCode
// about a base-URL setting nothing in the workspace gives a value, and "Whose
// address is this?": whether a public address the code calls is one of the
// workspace's apps. An answer is saved with the workspace at once (IndexedDB),
// then the map is built again in the worker from the files the workspace
// already holds, every answer fed into the resolution. No folder is picked
// again. Answers are kept by key: a setting's name, or an address (a key with
// a dot is an address, as for the CLI's --assume).
import { useSyncExternalStore } from "react";
import type { Assertion, CodeMap, SourceFile } from "@/analyzer/types";
import { answersOf, getWorkspace, setWorkspace, type Workspace } from "./store";

/** A rebuild under way after an answer, or the reason it failed. */
export interface Remap {
  setting: string;
  /** 0..1 */
  progress: number;
  error?: string;
}

let remap: Remap | null = null;
const listeners = new Set<() => void>();
function setRemap(r: Remap | null) {
  remap = r;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useRemap(): Remap | null {
  return useSyncExternalStore(subscribe, () => remap, () => null);
}
/** Put away a failed redraw's message. */
export function dismissRemap() {
  if (remap?.error) setRemap(null);
}

/** An answer's key is an address ("api.example.com"), not a setting's name: it has a dot. */
export const isAddress = (key: string) => key.includes(".");

/** The answers with one changed: a service id, null for "an outside service / not sure" (for an address:
 * "another company's service / not sure"), undefined to take it back. */
export function withAnswer(list: Assertion[], setting: string, service: string | null | undefined, now = new Date().toISOString()): Assertion[] {
  const rest = list.filter((a) => a.setting !== setting);
  return service === undefined ? rest : [...rest, { setting, ...(isAddress(setting) ? { host: setting } : {}), service, answeredAt: now }];
}

/** Whether the arrows change: only an answer that names a service draws anything. About an address, any
 * answer may: "another company's" takes back what the service's own deploy config said. */
export function changesArrows(before: Assertion[], after: Assertion[]): boolean {
  const key = (l: Assertion[]) =>
    l
      .filter((a) => a.service || a.host)
      .map((a) => `${a.setting}=${a.service}`)
      .sort()
      .join("|");
  return key(before) !== key(after);
}

/** The files a workspace holds, as the analyzer reads them. Secret files were never kept; they are
 * listed again with no content, so the new map still says they were skipped. */
export function sourcesOf(w: Pick<Workspace, "files" | "map">): SourceFile[] {
  const sources = Object.entries(w.files).map(([path, content]) => ({ path, content }));
  for (const f of w.map.files) if (f.skipped === "secret" && !(f.path in w.files)) sources.push({ path: f.path, content: "" });
  return sources;
}

/** Two maps of the same folders: the same areas and the same app services. */
export function sameShape(a: CodeMap, b: CodeMap): boolean {
  const apps = (m: CodeMap) =>
    m.services
      .filter((s) => s.kind === "app")
      .map((s) => s.id)
      .sort()
      .join("|");
  return a.areas.join("|") === b.areas.join("|") && apps(a) === apps(b);
}

/** The answer the user gave for a setting or an address, if any (the workspace's list, else the one the map was built with). */
export function answerFor(map: CodeMap, assertions: Assertion[] | undefined, setting: string): Assertion | undefined {
  if (assertions) return assertions.find((a) => a.setting === setting);
  return isAddress(setting) ? map.publicHosts?.find((h) => h.host === setting)?.answer : map.unresolvedBases?.find((b) => b.setting === setting)?.answer;
}

/** Save an answer (or take it back) and, when it changes the arrows, draw the map again with it. */
export async function answer(setting: string, service: string | null | undefined): Promise<void> {
  const w = getWorkspace();
  if (!w) return;
  const before = w.assertions ?? answersOf(w.map);
  const assertions = withAnswer(before, setting, service);
  const saved: Workspace = { ...w, assertions };
  setWorkspace(saved);
  if (!changesArrows(before, assertions)) return;
  setRemap({ setting, progress: 0 });
  try {
    const { buildInWorker } = await import("@/analyzer/buildInWorker");
    const { map } = await buildInWorker({ sources: sourcesOf(saved), name: saved.map.name, repos: saved.map.repos, assertions }, (done, all) => {
      if (remap?.setting === setting) setRemap({ setting, progress: all ? done / all : 0 });
    });
    const now = getWorkspace();
    // A newer answer, or another workspace, came in meanwhile: that one draws the map.
    if (!now || now.id !== saved.id || now.assertions !== assertions) return;
    // An answer never moves an area or an app. If the new map's do differ, the workspace kept too
    // few of its files to draw it again (one saved before it kept its package files): keep the map.
    if (!sameShape(saved.map, map)) {
      setRemap({ setting, progress: 0, error: "this workspace was saved without its package files, so the map would come out different" });
      return;
    }
    setWorkspace({ ...now, map });
    setRemap(null);
  } catch (e) {
    setRemap({ setting, progress: 0, error: (e as Error).message });
  }
}
