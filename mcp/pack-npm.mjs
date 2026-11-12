// npm run pack:npm: WalkMyCode for Claude as the npm package walkmycode-mcp (docs/DISTRIBUTION.md §3.1),
// staged from the build and packed, never from the repo root, so nothing else can slip in:
//   mcp/dist/npm/                      the folder packed (package.json, README.md, LICENSE, server.mjs, ui/, wasm/)
//   mcp/dist/walkmycode-mcp-<v>.tgz    the package, exactly as npm publish would send it
// One file to run (server.mjs, given a shebang so `npx walkmycode-mcp` starts it on every OS) and no
// dependencies: everything is bundled. Builds mcp/dist first when it is not there. Nothing is published:
// that is `npm publish <the .tgz>` by the owner, signed in to npm (docs/DISTRIBUTION.md, "Owner's yes").
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "mcp", "dist");
const stage = join(dist, "npm");
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const NAME = "walkmycode-mcp";

if (!existsSync(join(dist, "server.mjs")) || !existsSync(join(dist, "ui", "index.html"))) {
  if (spawnSync(process.execPath, [join(root, "mcp", "build.mjs")], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const server = readFileSync(join(dist, "server.mjs"), "utf8");
writeFileSync(join(stage, "server.mjs"), server.startsWith("#!") ? server : `#!/usr/bin/env node\n${server}`);
copyFileSync(join(dist, "web-tree-sitter.wasm"), join(stage, "web-tree-sitter.wasm"));
cpSync(join(dist, "wasm"), join(stage, "wasm"), { recursive: true });
cpSync(join(dist, "ui"), join(stage, "ui"), { recursive: true });
copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));

const pkg = {
  name: NAME,
  version: app.version,
  description: "WalkMyCode for Claude: a live map of your code in the browser that your AI app drives while it explains. An MCP server.",
  license: app.license,
  homepage: "https://walkmycode.com",
  type: "module",
  bin: { [NAME]: "server.mjs" },
  files: ["server.mjs", "web-tree-sitter.wasm", "wasm/", "ui/", "README.md", "LICENSE"],
  engines: { node: ">=20" },
  keywords: ["mcp", "model-context-protocol", "claude", "codebase", "code-map", "onboarding"],
};
writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(
  join(stage, "README.md"),
  `# ${NAME}

WalkMyCode for Claude, as an MCP server: it maps your project and opens a page in your browser where your AI app
explains the code, lighting up cards, opening files at the right lines and playing tours aloud. The answers come
from your AI app's own model (your Claude plan, for example); WalkMyCode itself sends your code nowhere.

## Claude Code

    claude mcp add -s user walkmycode -- npx -y ${NAME}@latest

On Windows: \`claude mcp add -s user walkmycode -- cmd /c npx -y ${NAME}@latest\`.
Then, in a new session: "open WalkMyCode on this folder".

## Other MCP clients

Run \`npx -y ${NAME}@latest\` as a stdio server (command \`npx\`, args \`["-y", "${NAME}@latest"]\`).

## From a terminal, without an AI app

    npx -y ${NAME}@latest path/to/project

The page then answers with an API key you add in its Settings.

Runs on Windows and Linux. Node.js ${pkg.engines.node.replace(">=", "")} or later. Licence: ${app.license}.
More at https://walkmycode.com.
`,
);

// One command line (npm is npm.cmd on Windows, which needs a shell); the destination is our own path, quoted.
const packed = spawnSync(`npm pack --json --pack-destination "${dist}"`, { cwd: stage, encoding: "utf8", shell: true });
if (packed.status !== 0) {
  console.error(`pack:npm: npm pack failed:\n${packed.stderr}`);
  process.exit(1);
}
const [info] = JSON.parse(packed.stdout);
const unexpected = info.files.map((f) => f.path).filter((p) => !/^(server\.mjs|web-tree-sitter\.wasm|wasm\/|ui\/|README\.md|LICENSE|package\.json)/.test(p));
if (unexpected.length || info.files.some((f) => /\.map$|\.env|\.ts$/.test(f.path))) {
  console.error(`pack:npm: unexpected files in the package: ${unexpected.join(", ")}`);
  process.exit(1);
}
const tgz = join(dist, info.filename);
console.log(`mcp/dist/${info.filename}: ${info.entryCount} files, ${(statSync(tgz).size / 1024 / 1024).toFixed(1)} MB packed, ${(info.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked. Not published: npm publish "${tgz}" (signed in to npm).`);
