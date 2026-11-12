// npm run pack:mcpb: WalkMyCode for Claude as a Claude Desktop extension, a .mcpb
// bundle (docs/MCP.md §5): the manifest (mcp/mcpb/manifest.json, manifest_version
// 0.3, checked against the official schema from @anthropic-ai/mcpb) and the
// bundled server with its page, grammars and runtime:
//   mcp/dist/mcpb/          the folder packed (manifest.json, server/)
//   mcp/dist/walkmycode.mcpb   the extension: double-click it, or Claude Desktop →
//                           Settings → Extensions → Advanced settings → Install Extension…
// Builds mcp/dist first when it is not there. Nothing is installed or published.
import { packExtension } from "@anthropic-ai/mcpb";
import { v0_3 } from "@anthropic-ai/mcpb/schemas";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "mcp", "dist");
const stage = join(dist, "mcpb");
const out = join(dist, "walkmycode.mcpb");

if (!existsSync(join(dist, "server.mjs")) || !existsSync(join(dist, "ui", "index.html"))) {
  if (spawnSync(process.execPath, [join(root, "mcp", "build.mjs")], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, "mcp", "mcpb", "manifest.json"), "utf8"));
const checked = v0_3.McpbManifestSchema.safeParse(manifest);
if (!checked.success) {
  console.error(`pack:mcpb: mcp/mcpb/manifest.json does not match the MCPB 0.3 schema:\n${checked.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
rmSync(out, { force: true });
mkdirSync(join(stage, "server"), { recursive: true });
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const f of ["server.mjs", "web-tree-sitter.wasm"]) copyFileSync(join(dist, f), join(stage, "server", f));
cpSync(join(dist, "wasm"), join(stage, "server", "wasm"), { recursive: true });
cpSync(join(dist, "ui"), join(stage, "server", "ui"), { recursive: true });

if (!(await packExtension({ extensionPath: stage, outputPath: out, silent: true })) || !existsSync(out)) {
  console.error("pack:mcpb: mcpb could not pack mcp/dist/mcpb.");
  process.exit(1);
}
console.log(`mcp/dist/walkmycode.mcpb ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB (manifest ${manifest.manifest_version}, ${manifest.tools.length} tools). Install by hand: open it with Claude Desktop.`);
