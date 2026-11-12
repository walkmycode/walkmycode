// WalkMyCode's MCP server works with any MCP client: the page names the one
// connected (src/lib/bridge/clientName.ts), from the clientInfo it sent in the
// initialize handshake.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capName, clientName, FALLBACK_CLIENT } from "../src/lib/bridge/clientName";

describe("the connected client's name", () => {
  it("knows the common MCP clients by the names they send", () => {
    const cases: [string, string][] = [
      ["claude-code", "Claude"],
      ["claude-ai", "Claude"],
      ["Claude Desktop", "Claude"],
      ["antigravity", "Antigravity"],
      ["Google Antigravity", "Antigravity"],
      ["cursor-vscode", "Cursor"],
      ["Visual Studio Code", "VS Code"],
      ["vscode", "VS Code"],
      ["GitHub Copilot", "GitHub Copilot"],
      ["windsurf-client", "Windsurf"],
      ["Codeium", "Windsurf"],
      ["Zed", "Zed"],
      ["gemini-cli-mcp-client", "Gemini CLI"],
    ];
    for (const [raw, want] of cases) assert.equal(clientName({ name: raw, version: "1.0.0" }), want, raw);
  });

  it("prettifies a name it doesn't know, prefers a title, and falls back when there is none", () => {
    assert.equal(clientName({ name: "walkmycode-test" }), "Walkmycode Test");
    assert.equal(clientName({ name: "acme_agent" }), "Acme Agent");
    assert.equal(clientName({ name: "acme-agent", title: "Acme Agent Pro" }), "Acme Agent Pro");
    assert.equal(clientName({ name: "MyIDE" }), "MyIDE");
    assert.equal(clientName({ name: "" }), FALLBACK_CLIENT);
    assert.equal(clientName({ name: "---" }), FALLBACK_CLIENT);
    assert.equal(clientName(undefined), FALLBACK_CLIENT);
    assert.equal(clientName(null), FALLBACK_CLIENT);
    assert.ok(clientName({ name: "x".repeat(200) }).length <= 40);
  });

  it("starts a sentence with a capital", () => {
    assert.equal(capName(FALLBACK_CLIENT), "Your AI app");
    assert.equal(capName("Antigravity"), "Antigravity");
  });
});
