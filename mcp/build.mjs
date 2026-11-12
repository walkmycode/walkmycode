// npm run build:mcp: WalkMyCode for Claude in one folder (docs/MCP.md §8), mcp/dist:
//   server.mjs             the MCP server with everything it imports (the voice
//                          routes' modules too), bundled by esbuild
//   web-tree-sitter.wasm   the parser's runtime (web-tree-sitter looks for it beside the bundle)
//   wasm/                  the grammars: tsx, typescript, javascript, python, dart, php
//   ui/                    the page it serves: the `mcp` front-end target (npm run build:mcp-ui → out-mcp)
//   plugin/                the Claude Code plugin (mcp/plugin) with this server inside, ready for
//                          `claude --plugin-dir mcp/dist/plugin`
//   .claude-plugin/        a local marketplace naming that plugin, for `claude plugin marketplace add mcp/dist`
// The page is built first; `--no-ui` reuses out-mcp as it is. Run the server with
// `node mcp/dist/server.mjs`; `npm run pack:mcpb` makes the Desktop extension from
// this folder. Nothing here is published.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "mcp", "dist");
const wasm = join(root, "public", "wasm");
const ui = join(root, "out-mcp");

// The runtime and grammars come from public/wasm, where npm ci copies them (scripts/copy-wasm.mjs).
if (!existsSync(join(wasm, "web-tree-sitter.wasm")) && spawnSync(process.execPath, ["scripts/copy-wasm.mjs"], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);

// The page: the mcp target's static export.
if (!process.argv.includes("--no-ui") && spawnSync(process.execPath, ["scripts/build-mcp-ui.mjs"], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);
if (!existsSync(join(ui, "index.html"))) {
  console.error("build:mcp: out-mcp/index.html is missing: run npm run build:mcp-ui (or drop --no-ui).");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });

/** `server-only` keeps server modules out of the browser's bundles; this bundle is a server, so it is empty here. */
const serverOnly = {
  name: "server-only",
  setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
  },
};

const result = await build({
  absWorkingDir: root,
  entryPoints: ["mcp/src/main.ts"],
  outfile: "mcp/dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  tsconfig: "tsconfig.json",
  // CommonJS packages inside an ES module still call require() for Node's own modules.
  banner: { js: 'import { createRequire as __lanternRequire } from "node:module";\nconst require = __lanternRequire(import.meta.url);' },
  define: { "process.env.NODE_ENV": '"production"' },
  // ws's optional native speed-ups: it works without them. node-pty (the terminal) is a native module, loaded
  // from node_modules when it is there (a run from this repo); without it the terminal falls back to line mode.
  // sherpa-onnx-node (on-device speech to text) is native too: loaded from node_modules when it is there, and
  // Settings → Voice says so when it is not (the packaged server).
  external: ["bufferutil", "utf-8-validate", "node-pty", "sherpa-onnx-node"],
  plugins: [serverOnly],
  legalComments: "eof",
  logLevel: "warning",
  metafile: true,
});

// The server must never carry the page's own code (React, the voice client SDK).
const inputs = Object.keys(result.metafile.inputs);
const stray = inputs.filter((p) => /node_modules[\\/](react-dom|@elevenlabs|next)[\\/]/.test(p));
if (stray.length) {
  console.error(`build:mcp: the server bundle pulled in browser code:\n${stray.slice(0, 10).join("\n")}`);
  process.exit(1);
}

mkdirSync(join(dist, "wasm"), { recursive: true });
for (const f of readdirSync(wasm).filter((f) => f.endsWith(".wasm") && f !== "web-tree-sitter.wasm")) copyFileSync(join(wasm, f), join(dist, "wasm", f));
copyFileSync(join(wasm, "web-tree-sitter.wasm"), join(dist, "web-tree-sitter.wasm"));
cpSync(ui, join(dist, "ui"), { recursive: true });

// The Claude Code plugin, with the server inside it (its .mcp.json runs ${CLAUDE_PLUGIN_ROOT}/server/server.mjs).
const plugin = join(dist, "plugin");
cpSync(join(root, "mcp", "plugin"), plugin, { recursive: true });
mkdirSync(join(plugin, "server"), { recursive: true });
for (const f of ["server.mjs", "web-tree-sitter.wasm"]) copyFileSync(join(dist, f), join(plugin, "server", f));
cpSync(join(dist, "wasm"), join(plugin, "server", "wasm"), { recursive: true });
cpSync(join(dist, "ui"), join(plugin, "server", "ui"), { recursive: true });
// A local marketplace of one plugin, so it can be installed by hand: claude plugin marketplace add <this folder>.
const manifest = JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8"));
mkdirSync(join(dist, ".claude-plugin"), { recursive: true });
writeFileSync(
  join(dist, ".claude-plugin", "marketplace.json"),
  `${JSON.stringify(
    {
      name: "walkmycode-local",
      owner: { name: manifest.author?.name ?? "WalkMyCode" },
      metadata: { description: "The WalkMyCode MCP server, built on this computer (npm run build:mcp): not published anywhere." },
      plugins: [{ name: manifest.name, source: "./plugin", description: manifest.description, version: manifest.version }],
    },
    null,
    2,
  )}\n`,
);

const size = (p) => {
  const s = statSync(p);
  return s.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : s.size;
};
const mb = (p) => `${(size(p) / 1024 / 1024).toFixed(1)} MB`;
console.log(
  `mcp/dist: server.mjs ${Math.round(statSync(join(dist, "server.mjs")).size / 1024)} KB, ${readdirSync(join(dist, "wasm")).length} grammars, ui ${mb(join(dist, "ui"))}, plugin ${mb(plugin)}. Run: node mcp/dist/server.mjs`,
);
