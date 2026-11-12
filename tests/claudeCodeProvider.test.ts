// The "Claude Code (my subscription)" provider (src/lib/providers/cli.ts, issue #12), against a fake
// `claude` that checks its flags arrive intact (an empty `--tools ""` once swallowed --allowedTools
// through cmd.exe), starts WalkMyCode's tool bridge from --mcp-config like Claude Code does, calls
// read_file through it, and answers with what the page sent back.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { cliReadiness, cliRound, findClaude, parseAuth, toolCall } from "../src/lib/providers/cli";
import { cliToolUrl } from "../src/lib/providers/ask";
import type { HistoryEntry, StreamEvent } from "../src/lib/providers/wire";

const FAKE = String.raw`
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
if (args[0] === "auth") {
  out({ loggedIn: !process.env.FAKE_SIGNED_OUT, authMethod: process.env.FAKE_AUTH_METHOD || "claude.ai", apiProvider: "firstParty" });
  process.exit(0);
}
const flag = (f) => args[args.indexOf(f) + 1];
const fail = (why) => { out({ type: "result", is_error: true, result: why }); process.exit(1); };
if (process.env.FAKE_EXIT_AT_ONCE) process.exit(2); // an old Claude Code refusing a flag, before reading stdin
if (flag("--setting-sources") !== "") fail("--setting-sources should be empty, got " + JSON.stringify(flag("--setting-sources")));
if (!readFileSync(flag("--system-prompt-file"), "utf8").includes("WalkMyCode")) fail("the system prompt file is not WalkMyCode's");
if (flag("--tools") !== "") fail("--tools should be empty, got " + JSON.stringify(flag("--tools")));
if (!String(flag("--allowedTools")).split(",").includes("mcp__walkmycode__read_file")) fail("read_file not allowed: " + JSON.stringify(flag("--allowedTools")));
for (const k of Object.keys(process.env)) if (/^ANTHROPIC_/.test(k)) fail("an API key reached the run: " + k);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  if (!prompt.includes("What is in a.ts?")) fail("the question is missing from the prompt");
  const s = JSON.parse(readFileSync(flag("--mcp-config"), "utf8")).mcpServers.walkmycode;
  const mcp = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const rpc = (m) => mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  mcp.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (msg.id === 1) {
        out({ type: "system", subtype: "init", mcp_servers: [{ name: "walkmycode", status: "connected" }] });
        rpc({ id: 2, method: "tools/call", params: { name: "read_file", arguments: { path: "a.ts" } } });
      } else if (msg.id === 2) {
        const text = (msg.result.isError ? "the tool failed: " : "a.ts holds: ") + msg.result.content[0].text;
        out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
        out({ type: "result", is_error: false, result: text });
        mcp.kill();
        process.exit(0);
      }
    }
  });
  rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
});
`;

let dir = "";
let server: Server;
let toolUrl = "";
const saved = { claude: process.env.WALKMYCODE_CLAUDE, key: process.env.ANTHROPIC_API_KEY };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "wmc-fake-claude-"));
  writeFileSync(join(dir, "fake.mjs"), FAKE);
  const bin = join(dir, process.platform === "win32" ? "claude.cmd" : "claude");
  // A .cmd shim on Windows, like npm's and WinGet's: the path that once lost the empty argument.
  writeFileSync(bin, process.platform === "win32" ? `@"${process.execPath}" "${join(dir, "fake.mjs")}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${join(dir, "fake.mjs")}" "$@"\n`);
  if (process.platform !== "win32") chmodSync(bin, 0o755);
  process.env.WALKMYCODE_CLAUDE = bin;
  process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-reach-the-run";
  // What POST /api/cli-tool does: hand the call to the run and answer with the page's result.
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const b = JSON.parse(body) as { job: string; key: string; name: string; input: Record<string, unknown> };
      const pending = toolCall(b.job, b.key, b.name, b.input);
      res.writeHead(pending ? 200 : 404, { "content-type": "application/json" });
      const r = pending && (await pending);
      res.end(JSON.stringify(r ? { result: r.text, ...(r.isError ? { isError: true } : {}) } : { error: "no such run" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  toolUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cli-tool`;
});

after(() => {
  server?.close();
  for (const [k, v] of [["WALKMYCODE_CLAUDE", saved.claude], ["ANTHROPIC_API_KEY", saved.key]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

async function round(history: HistoryEntry[]): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await cliRound({ model: "claude-sonnet-5-5", mode: "ask", mapSummary: "1 file: a.ts", history, toolUrl, signal: new AbortController().signal, send: (e) => events.push(e) });
  return events;
}

describe("Claude Code provider", () => {
  it("finds the claude set in WALKMYCODE_CLAUDE", () => {
    assert.equal(findClaude(), process.env.WALKMYCODE_CLAUDE);
  });

  it("knows who pays from auth status: the plan, an API account, or signed out", () => {
    assert.equal(parseAuth('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'), "plan");
    assert.equal(parseAuth('{"loggedIn":true,"authMethod":"console","apiProvider":"firstParty"}'), "api");
    assert.equal(parseAuth('{"loggedIn":true,"authMethod":"api_key"}'), "api");
    assert.equal(parseAuth('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock"}'), "api");
    assert.equal(parseAuth('{"loggedIn":false}'), "signed_out");
    assert.equal(parseAuth("Unknown command: auth"), "unknown");
  });

  it("refuses an API-billed sign-in, and a hosted WalkMyCode", async () => {
    process.env.FAKE_AUTH_METHOD = "console";
    try {
      assert.equal((await cliReadiness())?.code, "cli_not_plan");
    } finally {
      delete process.env.FAKE_AUTH_METHOD;
    }
    process.env.WALKMYCODE_MODE = "hosted";
    try {
      assert.equal((await cliReadiness())?.code, "cli_hosted");
    } finally {
      delete process.env.WALKMYCODE_MODE;
    }
  });

  it("sends the bridge to this server on loopback, whatever address the page used", () => {
    assert.equal(cliToolUrl("http://192.168.1.5:3000/api/claude"), "http://127.0.0.1:3000/api/cli-tool");
    assert.equal(cliToolUrl("http://localhost:4123/api/claude?x=1"), "http://127.0.0.1:4123/api/cli-tool");
  });

  it("says when Claude Code isn't signed in, and notices at once when it is", async () => {
    process.env.FAKE_SIGNED_OUT = "1";
    try {
      assert.equal((await cliReadiness())?.code, "cli_signed_out");
    } finally {
      delete process.env.FAKE_SIGNED_OUT;
    }
    assert.equal(await cliReadiness(), null);
  });

  it("answers through the page's tools: a tool round, then the answer", { timeout: 30_000 }, async () => {
    const question: HistoryEntry = { role: "user", content: "What is in a.ts?" };
    const first = await round([question]);
    const errors = first.filter((e) => e.type === "error");
    assert.deepEqual(errors, []);
    const asked = first.find((e) => e.type === "message") as Extract<StreamEvent, { type: "message" }>;
    assert.equal(asked.finish, "tool-calls");
    assert.deepEqual(asked.toolCalls.map((c) => [c.toolName, c.input]), [["read_file", { path: "a.ts" }]]);

    const id = asked.toolCalls[0].toolCallId;
    const second = await round([
      question,
      { role: "assistant", message: asked.message },
      { role: "tool", content: [{ type: "tool-result", toolCallId: id, toolName: "read_file", output: { type: "text", value: "export const a = 1;" } }] },
    ]);
    assert.deepEqual(second.filter((e) => e.type === "error"), []);
    const text = second.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    assert.equal(text, "a.ts holds: export const a = 1;");
    assert.equal((second.at(-1) as Extract<StreamEvent, { type: "message" }>).finish, "stop");
  });

  it("hands a failed tool to Claude Code as an error", { timeout: 30_000 }, async () => {
    const question: HistoryEntry = { role: "user", content: "What is in a.ts?" };
    const asked = (await round([question])).find((e) => e.type === "message") as Extract<StreamEvent, { type: "message" }>;
    const second = await round([
      question,
      { role: "assistant", message: asked.message },
      { role: "tool", content: [{ type: "tool-result", toolCallId: asked.toolCalls[0].toolCallId, toolName: "read_file", output: { type: "error-text", value: "No such file." } }] },
    ]);
    assert.equal(second.flatMap((e) => (e.type === "text" ? [e.text] : [])).join(""), "the tool failed: No such file.");
  });

  it("reports a Claude Code that exits at once, without bringing the server down", { timeout: 30_000 }, async () => {
    process.env.FAKE_EXIT_AT_ONCE = "1";
    try {
      const events = await round([{ role: "user", content: "What is in a.ts?" }]);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "error");
    } finally {
      delete process.env.FAKE_EXIT_AT_ONCE;
    }
  });

  it("refuses tool results from a run that has ended, and says why", async () => {
    const events = await round([
      { role: "user", content: "What is in a.ts?" },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "cli-gone", toolName: "read_file", output: { type: "text", value: "x" } }] },
    ]);
    assert.equal(events.length, 1);
    assert.match(events[0].type === "error" ? String(events[0].error.detail) : "", /already stopped/);
  });
});
