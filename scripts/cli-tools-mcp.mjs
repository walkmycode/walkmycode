// WalkMyCode's tools for a `claude -p` run (src/lib/providers/cli.ts): a stdio MCP server whose every
// tool call is forwarded to the WalkMyCode server (POST to the run's url), which hands it to the page and
// answers with the page's result. Started by Claude Code, Codex or the Gemini CLI for one run; no dependencies.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// The run's address, job and key come from its private run file (WMC_RUN_FILE), so they never sit on
// a command line other programs can list; WMC_TOOL_URL, WMC_JOB, WMC_KEY and WMC_TOOLS_FILE still work.
const run = process.env.WMC_RUN_FILE ? JSON.parse(readFileSync(process.env.WMC_RUN_FILE, "utf8")) : {};
const url = run.url ?? process.env.WMC_TOOL_URL;
const job = run.job ?? process.env.WMC_JOB;
const key = run.key ?? process.env.WMC_KEY;
const tools = JSON.parse(readFileSync(run.tools ?? process.env.WMC_TOOLS_FILE, "utf8"));
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

async function call(name, args) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job, key, name, input: args ?? {} }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { content: [{ type: "text", text: body.error ?? `WalkMyCode answered ${res.status}.` }], isError: true };
    return { content: [{ type: "text", text: String(body.result ?? "") }], ...(body.isError ? { isError: true } : {}) };
  } catch (e) {
    return { content: [{ type: "text", text: `WalkMyCode couldn't be reached: ${e.message}` }], isError: true };
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // a notification
  if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "walkmycode", version: "1" } } });
  if (msg.method === "tools/list") return send({ id: msg.id, result: { tools } });
  if (msg.method === "tools/call") return send({ id: msg.id, result: await call(msg.params?.name, msg.params?.arguments) });
  if (msg.method === "ping") return send({ id: msg.id, result: {} });
  send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
});
