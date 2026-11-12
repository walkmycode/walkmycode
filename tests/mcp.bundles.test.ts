// WalkMyCode for Claude's install bundles (docs/MCP.md §5): the Claude Desktop
// extension's manifest against the official MCPB 0.3 schema (@anthropic-ai/mcpb),
// the Claude Code plugin's manifest, MCP server entry and /walkmycode skill, and
// both against the server itself: the same version, every tool named, and the
// server's entry where the build puts it.
import { v0_3 } from "@anthropic-ai/mcpb/schemas";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parse as parseYaml } from "yaml";
import { LANTERN_MCP_VERSION } from "../mcp/src/server";
import { startLantern, type Started } from "./mcp.helpers";

const root = process.cwd();
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8")) as Record<string, unknown>;

let tools: string[] = [];
let s: Started;
before(async () => {
  s = await startLantern();
  tools = (await s.client.listTools()).tools.map((t) => t.name).sort();
});
after(() => s.close());

describe("the Claude Desktop extension (.mcpb)", () => {
  const manifest = json("mcp/mcpb/manifest.json") as {
    manifest_version: string;
    version: string;
    server: { type: string; entry_point: string; mcp_config: { command: string; args: string[] } };
    tools: { name: string }[];
  };

  it("matches the official MCPB 0.3 schema", () => {
    const r = v0_3.McpbManifestSchema.safeParse(manifest);
    assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2));
    assert.equal(manifest.manifest_version, "0.3");
  });

  it("runs the bundled server with Node from the bundle's own folder, and names every tool", () => {
    assert.equal(manifest.version, LANTERN_MCP_VERSION);
    assert.equal(manifest.server.type, "node");
    assert.equal(manifest.server.entry_point, "server/server.mjs");
    assert.deepEqual(manifest.server.mcp_config, { command: "node", args: ["${__dirname}/server/server.mjs"] });
    assert.deepEqual(manifest.tools.map((t) => t.name).sort(), tools);
  });
});

describe("the Claude Code plugin", () => {
  const plugin = json("mcp/plugin/.claude-plugin/plugin.json") as { name: string; version: string; author: { name: string } };
  const mcp = json("mcp/plugin/.mcp.json") as { mcpServers: Record<string, { command: string; args: string[] }> };

  it("has a manifest of the documented fields, named in kebab case", () => {
    // The fields Claude Code's own validator takes (claude plugin validate, v2.1.105, accepts exactly these here).
    const known = new Set(["name", "version", "description", "author", "homepage", "repository", "license", "keywords"]);
    for (const k of Object.keys(plugin)) assert.ok(known.has(k), `unexpected field ${k}`);
    assert.match(plugin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(plugin.version, LANTERN_MCP_VERSION);
    assert.ok(plugin.author.name);
  });

  it("starts the server the build puts inside the plugin", () => {
    assert.deepEqual(Object.keys(mcp.mcpServers), ["walkmycode"]);
    assert.deepEqual(mcp.mcpServers.walkmycode, { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server/server.mjs"] });
    // mcp/build.mjs copies the bundle to <plugin>/server/server.mjs.
    assert.match(readFileSync(join(root, "mcp", "build.mjs"), "utf8"), /join\(plugin, "server", f\)/);
  });

  it("has a /walkmycode skill that opens WalkMyCode on the current folder and keeps the loop going", () => {
    const text = readFileSync(join(root, "mcp/plugin/skills/walkmycode/SKILL.md"), "utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    assert.ok(m, "frontmatter between --- lines");
    const front = parseYaml(m[1]) as { name: string; description: string; "allowed-tools": string };
    assert.equal(front.name, "walkmycode");
    assert.ok(front.description.length > 40 && front.description.length < 1024);
    const allowed = front["allowed-tools"].split(",").map((t) => t.trim());
    assert.deepEqual(allowed.map((t) => t.replace(/^mcp__plugin_walkmycode_walkmycode__/, "")).sort(), tools, "every tool, by its plugin name");
    assert.match(m[2], /walkmycode_open/);
    assert.match(m[2], /current working directory/);
    assert.match(m[2], /next_request\(\)/);
  });
});
