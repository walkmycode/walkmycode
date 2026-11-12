// Build a map from picked folders in a Web Worker (build.worker.ts), so the
// page does not freeze while thousands of files are parsed. Where a worker
// cannot be made, the map is built on the page as before.
import { assetBase, startWorker } from "./assets";
import type { Assertion, CodeMap, RepoRef, SourceFile } from "./types";

export interface BuildRequest {
  sources: SourceFile[];
  name: string;
  repos: RepoRef[];
  /** What the user told WalkMyCode about settings with no value ("Where does this point?"). */
  assertions?: Assertion[];
  /** Where the grammars are served (assets.ts): the worker has no page to work it out from. */
  assetBase?: string;
}
export type BuildReply =
  | { type: "progress"; done: number; all: number; file: string }
  | { type: "done"; map: CodeMap; contents: Record<string, string> }
  | { type: "error"; message: string };

export interface Built {
  map: CodeMap;
  /** The files kept for the Code panel, the guide and drawing the map again: everything read but
   * secrets, manifests included, config secrets hidden. */
  contents: Record<string, string>;
}

type Progress = (done: number, all: number, file: string) => void;

export async function buildInWorker(req: BuildRequest, onProgress: Progress): Promise<Built> {
  let worker: Worker;
  try {
    // In WalkMyCode Lite the bundler's worker URL is re-based next to the page (assets.ts).
    worker = startWorker(() => new Worker(new URL("./build.worker.ts", import.meta.url), { type: "module" }));
  } catch {
    return buildHere(req, onProgress);
  }
  return new Promise<Built>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<BuildReply>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress(m.done, m.all, m.file);
      else {
        worker.terminate();
        if (m.type === "done") resolve({ map: m.map, contents: m.contents });
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      // The worker could not start (or crashed outright): map on the page instead.
      ev.preventDefault();
      buildHere(req, onProgress).then(resolve, reject);
    };
    worker.postMessage({ ...req, assetBase: req.assetBase ?? assetBase() });
  });
}

/** The same work on the page's own thread. */
async function buildHere({ sources, name, repos, assertions }: BuildRequest, onProgress: Progress): Promise<Built> {
  const { buildMap } = await import("./build");
  const { redactSource } = await import("./config/files");
  const { map } = await buildMap(sources, { name, repos, assertions, onProgress });
  const secret = new Set(map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
  const contents = Object.fromEntries(sources.filter((f) => !secret.has(f.path)).map((f) => [f.path, redactSource(f.path, f.content)]));
  return { map, contents };
}
