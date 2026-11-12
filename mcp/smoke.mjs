// node mcp/smoke.mjs, after npm run build:mcp: runs the real bundle over stdio the
// way an MCP client does, maps a fixture, connects a page, passes one request
// through the loop, and stops. A temporary WALKMYCODE_HOME; no browser is opened;
// the page server listens on a random port and goes when the client closes.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "walkmycode-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  // WALKMYCODE_SERVER: another build of the server, e.g. the package installed from npm.
  args: [process.env.WALKMYCODE_SERVER || join(root, "mcp", "dist", "server.mjs")],
  env: { ...getDefaultEnvironment(), WALKMYCODE_HOME: home, WALKMYCODE_NO_BROWSER: "1" },
  stderr: "pipe",
});
let logs = "";
transport.stderr?.on("data", (d) => (logs += d));
const client = new Client({ name: "walkmycode-smoke", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text ?? "").join("\n");
  console.log(`\n▶ ${name} ${JSON.stringify(args)}${r.isError ? " (error)" : ""}\n${text.split("\n").slice(0, 6).join("\n")}`);
  return text;
};

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
  const open = await call("walkmycode_open", { path: join(root, "tests", "fixtures", "monolith") });
  const url = new URL(/Page: (\S+)/.exec(open)[1]);

  // The page, as a browser holding the cookie would connect.
  const ws = new WebSocket(`ws://127.0.0.1:${url.port}/bridge`, { origin: url.origin, headers: { Cookie: `lantern_${url.port}=${url.searchParams.get("t")}` } });
  const commands = [];
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type !== "command") return;
    commands.push(m.command.name);
    ws.send(JSON.stringify({ type: "ack", id: m.id, ok: true }));
  });
  await new Promise((ok, fail) => (ws.once("open", ok), ws.once("error", fail)));
  ws.send(JSON.stringify({ type: "request", ref: "s1", request: { kind: "question", payload: { text: "Where does sign-in happen?" } } }));

  const next = await call("next_request", { wait_s: 5 });
  const { id } = JSON.parse(next.split("\n")[0]);
  assert.match(next, /"kind":"question"/);
  await call("query_map", { query: "lib/auth.ts" });
  await call("narrate", { text: "Sign-in starts at the button on the first page.", id });
  await call("highlight_lines", { path: "lib/auth.ts", from: 7, to: 9 });
  await call("answer", { id, markdown: "The **Sign in** button posts to `/api/login`.", citations: ["app/page.tsx:8-11", "lib/auth.ts:7-9"] });
  assert.deepEqual(commands, ["narrate", "highlight_lines", "answer"]);
  ws.close();
  console.log(`\nThe page received: ${commands.join(", ")}. Server log (stderr):\n${logs.trim()}`);
  console.log("\nsmoke test passed");
} finally {
  await client.close().catch(() => {});
  rmSync(home, { recursive: true, force: true });
}
