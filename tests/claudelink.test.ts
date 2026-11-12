// "Use my Claude subscription" on the full app (src/lib/claudeLink.ts,
// src/lib/claudeLinkServer.ts): the command that works today, and whether
// WalkMyCode for Claude is running.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { linkStatus, MCP_COMMAND, mcpCommand, pluginCommands } from "../src/lib/claudeLink";
import { claudeLink } from "../src/lib/claudeLinkServer";

describe("mcpCommand", () => {
  it("registers this checkout's bundle with node, for every folder", () => {
    assert.equal(mcpCommand({ bundle: "C:\\code\\wmc\\mcp\\dist\\server.mjs", running: null }), 'claude mcp add -s user walkmycode -- node "C:\\code\\wmc\\mcp\\dist\\server.mjs"');
  });

  it("falls back to the package when no bundle is known", () => {
    assert.equal(mcpCommand(null), MCP_COMMAND);
    assert.equal(mcpCommand({ bundle: null, running: null }), MCP_COMMAND);
    assert.match(MCP_COMMAND, /-s user/);
  });
});

describe("pluginCommands", () => {
  it("installs the plugin from this checkout's build, or says nothing without one", () => {
    assert.deepEqual(pluginCommands({ bundle: "x", marketplace: "C:\\code\\wmc\\mcp\\dist", running: null }), ['claude plugin marketplace add "C:\\code\\wmc\\mcp\\dist"',"claude plugin install walkmycode@walkmycode-local"]);
    assert.equal(pluginCommands({ bundle: "x", running: null }), null);
    assert.equal(pluginCommands(null), null);
  });
});

describe("linkStatus", () => {
  it("says nothing until asked, then where things stand", () => {
    assert.equal(linkStatus(null), null);
    assert.deepEqual(linkStatus({ bundle: "x", running: 12677 })?.ok, true);
    assert.match(linkStatus({ bundle: "x", running: 12677 })!.text, /127\.0\.0\.1:12677/);
    assert.match(linkStatus({ bundle: null, running: null })!.text, /build:mcp/);
    assert.match(linkStatus({ bundle: "x", running: null })!.text, /Not running yet/);
  });
});

describe("claudeLink", () => {
  let dir: string;
  let srv: Server;
  let port: number;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "wmc-link-"));
    srv = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    port = (srv.address() as { port: number }).port;
  });
  after(async () => {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("finds the bundle and a server listening on the saved port", async () => {
    const cwd = join(dir, "repo");
    const home = join(dir, "home");
    await mkdir(join(cwd, "mcp", "dist"), { recursive: true });
    await writeFile(join(cwd, "mcp", "dist", "server.mjs"), "");
    await mkdir(join(cwd, "mcp", "dist", ".claude-plugin"), { recursive: true });
    await writeFile(join(cwd, "mcp", "dist", ".claude-plugin", "marketplace.json"), "{}");
    await mkdir(join(home, ".walkmycode"), { recursive: true });
    await writeFile(join(home, ".walkmycode", "page-port"), `${port}\n`);
    assert.deepEqual(await claudeLink(cwd, home), { bundle: join(cwd, "mcp", "dist", "server.mjs"), marketplace: join(cwd, "mcp", "dist"), running: port });
  });

  it("is not running when the saved port is closed, or was never saved", async () => {
    const home = join(dir, "home2");
    assert.deepEqual(await claudeLink(join(dir, "nowhere"), home), { bundle: null, marketplace: null, running: null });
    const closed = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => closed.once("listening", r));
    const p = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    await mkdir(join(home, ".walkmycode"), { recursive: true });
    await writeFile(join(home, ".walkmycode", "page-port"), `${p}\n`);
    assert.equal((await claudeLink(join(dir, "nowhere"), home)).running, null);
  });
});
