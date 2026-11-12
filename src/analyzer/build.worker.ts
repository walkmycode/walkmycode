// Maps picked folders off the page's thread (docs/PERFORMANCE.md): the page
// posts the files, this parses them with tree-sitter and builds the map, and
// posts back progress, then the map and the file contents to keep (secrets in
// config files hidden). The page stays responsive while it works.
import { setAssetBase } from "./assets";
import { buildMap } from "./build";
import { redactSource } from "./config/files";
import type { BuildRequest, BuildReply } from "./buildInWorker";

const post = (m: BuildReply) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<BuildRequest>) => {
  const { sources, name, repos, assertions } = ev.data;
  // The grammars sit where the page says (next to it in WalkMyCode Lite), not at this worker's root.
  setAssetBase(ev.data.assetBase);
  try {
    let last = 0;
    const { map } = await buildMap(sources, {
      name,
      repos,
      assertions,
      onProgress: (done, all, file) => {
        // A few progress messages a second is plenty for the bar.
        const now = Date.now();
        if (now - last < 80 && done !== all) return;
        last = now;
        post({ type: "progress", done, all, file });
      },
    });
    // Everything read but secrets, manifests included (as the CLI keeps them), so the map can be
    // drawn again from the workspace alone: package.json and requirements.txt decide the areas.
    const secret = new Set(map.files.filter((f) => f.skipped === "secret").map((f) => f.path));
    const contents: Record<string, string> = {};
    for (const f of sources) if (!secret.has(f.path)) contents[f.path] = redactSource(f.path, f.content);
    post({ type: "done", map, contents });
  } catch (e) {
    post({ type: "error", message: (e as Error).message });
  }
};
