// The subscription apps (src/lib/providers/agents.ts): who pays, the command each run uses, and how
// each app's output is read. The whole loop runs against a fake Claude Code in claudeCodeProvider.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENTS, whyNot } from "../src/lib/providers/agents";

const bridge = { command: "node", args: ["bridge.mjs"], env: { WMC_RUN_FILE: "C:/tmp/run/run.json" } };
const files: Record<string, string> = {};
const write = (p: string, t: string) => (files[p] = t);

describe("agents: who pays", () => {
  it("Codex: a ChatGPT login is the plan, an API key is not", () => {
    assert.equal(AGENTS.codex.who("Logged in using ChatGPT"), "plan");
    assert.equal(AGENTS.codex.who("Logged in using an API key - sk-…"), "api");
    assert.equal(AGENTS.codex.who("Not logged in"), "signed_out");
  });

  it("Gemini CLI: a Google login is the plan; an API key or Vertex is not; no choice is signed out", () => {
    assert.equal(AGENTS["gemini-cli"].who('{"security":{"auth":{"selectedType":"oauth-personal"}}}'), "plan");
    assert.equal(AGENTS["gemini-cli"].who('{"security":{"auth":{"selectedType":"gemini-api-key"}}}'), "api");
    assert.equal(AGENTS["gemini-cli"].who('{"selectedAuthType":"vertex-ai"}'), "api");
    assert.equal(AGENTS["gemini-cli"].who(""), "signed_out");
  });

  it("keeps each maker's API keys out of its app's run", () => {
    assert.ok(AGENTS.codex.strip("OPENAI_API_KEY") && AGENTS.codex.strip("CODEX_API_KEY") && !AGENTS.codex.strip("CODEX_HOME"));
    assert.ok(AGENTS["gemini-cli"].strip("GEMINI_API_KEY") && AGENTS["gemini-cli"].strip("GOOGLE_API_KEY") && !AGENTS["gemini-cli"].strip("GOOGLE_CLOUD_PROJECT"));
    assert.ok(AGENTS["claude-code"].strip("ANTHROPIC_API_KEY") && !AGENTS["claude-code"].strip("CLAUDE_CODE_GIT_BASH_PATH"));
  });
});

describe("agents: one run", () => {
  it("Codex: read-only, no user config, the bridge required and approved, the key only in the run file", () => {
    const r = AGENTS.codex.run({ model: "gpt-6.1-sol", dir: "C:/tmp/run", tools: ["read_file", "search"], bridge, system: "SYSTEM", write });
    const a = r.args.join(" ");
    for (const want of ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "-s read-only", "--json", "-m gpt-6.1-sol", 'approval_policy="never"', "mcp_servers.walkmycode.required=true", 'default_tools_approval_mode="approve"', 'enabled_tools=["read_file","search"]', 'mcp_servers.walkmycode.env.WMC_RUN_FILE="C:/tmp/run/run.json"']) assert.ok(a.includes(want), want);
    assert.equal(r.args.at(-1), "-", "the prompt comes on stdin");
    assert.equal(r.stdin, "SYSTEM");
    assert.ok(!/[0-9a-f]{48}/.test(a), "no key on the command line");
  });

  it("Gemini CLI: a settings file in the run's folder with the bridge trusted and its own tools off", () => {
    const r = AGENTS["gemini-cli"].run({ model: "auto", dir: "C:/tmp/run", tools: ["read_file"], bridge, system: "SYSTEM", write });
    const s = JSON.parse(files[".gemini/settings.json"]);
    assert.equal(s.mcpServers.walkmycode.trust, true);
    assert.deepEqual(s.mcpServers.walkmycode.includeTools, ["read_file"]);
    assert.ok(s.tools.exclude.includes("run_shell_command") && s.tools.exclude.includes("write_file"));
    assert.deepEqual(r.args, ["-p", "", "--skip-trust", "--allowed-mcp-server-names", "walkmycode", "-o", "stream-json"]);
  });
});

describe("agents: reading the output", () => {
  it("Codex's events", () => {
    const read = AGENTS.codex.read;
    assert.deepEqual(read('{"type":"thread.started","thread_id":"x"}'), { kind: "init" });
    assert.deepEqual(read('{"type":"item.completed","item":{"type":"agent_message","text":"The task table is in prisma/schema.prisma."}}'), { kind: "text", text: "The task table is in prisma/schema.prisma.\n\n" });
    assert.equal(read('{"type":"item.completed","item":{"type":"mcp_tool_call","tool":"read_file"}}'), null);
    assert.deepEqual(read('{"type":"turn.completed","usage":{}}'), { kind: "done" });
    assert.deepEqual(read('{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}'), { kind: "error", text: "You've hit your usage limit." });
  });

  it("the Gemini CLI's events", () => {
    const read = AGENTS["gemini-cli"].read;
    assert.deepEqual(read('{"type":"message","role":"assistant","content":"Hello","delta":true}'), { kind: "text", text: "Hello" });
    assert.equal(read('{"type":"message","role":"user","content":"Hi"}'), null);
    assert.deepEqual(read('{"type":"result","status":"success"}'), { kind: "done" });
    assert.deepEqual(read('{"type":"result","status":"error","error":{"message":"quota"}}'), { kind: "error", text: "quota" });
  });

  it("knows a plan limit, a sign-in, and Google turning personal accounts away", () => {
    assert.equal(whyNot("Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals."), "unsupported");
    assert.equal(whyNot("You've hit your usage limit · resets 3pm"), "limit");
    assert.equal(whyNot("Not logged in. Run codex login."), "signed_out");
    assert.equal(whyNot("Something else"), null);
  });
});
