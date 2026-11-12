// npm run build:mcp-ui — WalkMyCode for Claude's page (docs/MCP.md §2.2), the
// third build target: a static export like Lite's, served from the root by the
// local MCP server. next.config.ts reads NEXT_PUBLIC_WALKMYCODE_TARGET=mcp: only
// *.mcp.tsx files are routes, and the export lands in out-mcp/ (Lite's out/ is
// left alone). Set here rather than in the npm script so it works the same in
// every shell. `npm run build:mcp` then bundles it with the server.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const run = (args, env = process.env) => spawnSync(process.execPath, args, { stdio: "inherit", env });

// The tree-sitter runtime and grammars must be in public/wasm to be exported (npm ci copies them):
// the page rebuilds the map itself after an answer to "Where does this point?".
if (!existsSync("public/wasm/web-tree-sitter.wasm") && run(["scripts/copy-wasm.mjs"]).status !== 0) process.exit(1);

rmSync("out-mcp", { recursive: true, force: true });
const r = run([require.resolve("next/dist/bin/next"), "build"], { ...process.env, NEXT_PUBLIC_WALKMYCODE_TARGET: "mcp" });
if (r.status === 0 && !existsSync("out-mcp/index.html")) {
  console.error("build:mcp-ui: the export has no out-mcp/index.html");
  process.exit(1);
}
// People get a built product, never the source (docs/DISTRIBUTION.md): the export can carry source maps,
// and the map's Web Worker (new Worker(new URL("./build.worker.ts"))) is copied as its raw .ts file. A
// browser can't run that file anyway, so the page already maps on its own thread (buildInWorker's
// fallback); drop both before the server, the plugin and the .mcpb take the folder.
if (r.status === 0) {
  const dropped = [];
  for (const e of readdirSync("out-mcp", { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(map|ts|tsx|mts)$/.test(e.name)) {
      const f = join(e.parentPath, e.name);
      rmSync(f);
      dropped.push(f);
    }
  }
  if (dropped.length) console.log(`build:mcp-ui: left out ${dropped.length} source file(s): ${dropped.map((f) => f.replace(/\\/g, "/")).join(", ")}`);
}
process.exit(r.status ?? 1);
