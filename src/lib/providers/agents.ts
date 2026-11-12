// The AI apps on the user's computer that can answer on the user's own subscription (issue #12):
// Claude Code (a Claude plan), Codex (a ChatGPT plan) and the Gemini CLI (a Google account). What
// differs between them is here, as plain data and functions: how to find the program, how to tell
// whether it is signed in to a plan rather than an API key, the command that runs one question with
// WalkMyCode's tools (the stdio bridge, scripts/cli-tools-mcp.mjs), and how to read what it prints.
// cli.ts runs them all the same way. No React and no server-only imports, so tests can load it.
// The command lines follow iReliabee's, which runs the same three.
import type { ProviderId } from "./catalogue";

export type AgentId = Extract<ProviderId, "claude-code" | "codex" | "gemini-cli">;
export type Who = "plan" | "api" | "signed_out" | "unknown";

/** One line of a run's output, read: the run started (and whether WalkMyCode's tools did), text of the
 * answer, the answer finished, or a failure in the app's own words. */
export type AgentLine = { kind: "init"; bridge?: string } | { kind: "text"; text: string } | { kind: "done"; text?: string } | { kind: "error"; text: string } | null;

export interface RunFiles {
  /** The bridge's start command, as Claude Code and Codex put it in their MCP config. */
  command: string;
  args: string[];
  /** The bridge's only setting: the private run file holding its address, job and key. */
  env: Record<string, string>;
}

export interface Agent {
  id: AgentId;
  /** The program's name for people, the command to type, where to get it. */
  name: string;
  command: string;
  url: string;
  /** What signs it in, for "sign in once": "your Claude account". */
  account: string;
  /** WALKMYCODE_CLAUDE and friends: a path that wins over the search. */
  override: string;
  /** Kept out of the run so it answers on the plan, never on a key the server holds. */
  strip: (name: string) => boolean;
  /** The arguments that ask whether (and how) it is signed in; null reads `whoFromFiles` instead. */
  authArgs: string[] | null;
  who: (out: string) => Who;
  /** Arguments for one question; `write` puts a file in the run's folder. The prompt goes on stdin. */
  run: (o: { model: string; dir: string; tools: string[]; bridge: RunFiles; system: string; write: (path: string, text: string) => void }) => { args: string[]; stdin: string };
  read: (line: string) => AgentLine;
}

/** A file in the run's folder. No node:path: the setup sheet and the guide's errors load this in the page. */
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}/${name}`;

const parse = (line: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** A TOML string for Codex's -c values: JSON's quoting is valid TOML. */
const toml = (v: string) => JSON.stringify(v);

const claude: Agent = {
  id: "claude-code",
  name: "Claude Code",
  command: "claude",
  url: "https://claude.com/product/claude-code",
  account: "your Claude account",
  override: "WALKMYCODE_CLAUDE",
  strip: (k) => /^ANTHROPIC_/.test(k) || k === "CLAUDECODE" || (/^CLAUDE_CODE_/.test(k) && k !== "CLAUDE_CODE_GIT_BASH_PATH"),
  authArgs: ["auth", "status"],
  // After iReliabee's assistant_auth.parse: a claude.ai login is the plan; a Console login, an API key
  // or Bedrock/Vertex is billed per token.
  who: (out) => {
    const s = parse(out.slice(Math.max(0, out.indexOf("{"))));
    if (!s) return "unknown";
    if (!s.loggedIn) return "signed_out";
    if (s.apiProvider && s.apiProvider !== "firstParty") return "api";
    if (!s.authMethod) return "unknown";
    return s.authMethod === "claude.ai" ? "plan" : "api";
  },
  run: ({ model, dir, tools, bridge, system, write }) => {
    write("system.md", system);
    write("mcp.json", JSON.stringify({ mcpServers: { walkmycode: bridge } }));
    return {
      // Its own system prompt, none of the user's settings, hooks or CLAUDE.md (--setting-sources ""),
      // no built-in tools (--tools "" must reach it as an empty argument), only WalkMyCode's.
      args: ["-p", "--model", model, "--system-prompt-file", join(dir, "system.md"), "--setting-sources", "", "--mcp-config", join(dir, "mcp.json"), "--strict-mcp-config", "--tools", "", "--allowedTools", tools.map((t) => `mcp__walkmycode__${t}`).join(","), "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence"],
      stdin: "",
    };
  },
  read: (line) => {
    const ev = parse(line);
    if (!ev) return null;
    if (ev.type === "system" && ev.subtype === "init") {
      const s = (ev.mcp_servers as { name: string; status: string }[] | undefined)?.find((x) => x.name === "walkmycode");
      return { kind: "init", bridge: s?.status ?? "missing" };
    }
    const e = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (ev.type === "stream_event" && e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) return { kind: "text", text: e.delta.text };
    if (ev.type === "result") return ev.is_error ? { kind: "error", text: str(ev.result) } : { kind: "done", text: str(ev.result) };
    return null;
  },
};

const codex: Agent = {
  id: "codex",
  name: "Codex",
  command: "codex",
  url: "https://developers.openai.com/codex/cli",
  account: "your ChatGPT account",
  override: "WALKMYCODE_CODEX",
  strip: (k) => /^OPENAI_/.test(k) || (/^CODEX_/.test(k) && k !== "CODEX_HOME"),
  authArgs: ["login", "status"],
  who: (out) => (/logged in using chatgpt/i.test(out) ? "plan" : /logged in using an api key|api key/i.test(out) ? "api" : /not logged in/i.test(out) ? "signed_out" : "unknown"),
  run: ({ model, dir, tools, bridge, system }) => {
    const set = (k: string, v: string) => ["-c", `${k}=${v}`];
    return {
      // None of the user's config or rules, no git checks, nothing kept, a read-only sandbox, never
      // asking; WalkMyCode's tools required and pre-approved. Codex has no system prompt flag here, so
      // WalkMyCode's instructions lead the prompt.
      args: [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "read-only",
        "--json",
        "-C",
        dir,
        ...(model && model !== "default" ? ["-m", model] : []),
        ...set("approval_policy", toml("never")),
        ...set("mcp_servers.walkmycode.command", toml(bridge.command)),
        ...set("mcp_servers.walkmycode.args", `[${bridge.args.map(toml).join(",")}]`),
        ...Object.entries(bridge.env).flatMap(([k, v]) => set(`mcp_servers.walkmycode.env.${k}`, toml(v))),
        ...set("mcp_servers.walkmycode.required", "true"),
        ...set("mcp_servers.walkmycode.default_tools_approval_mode", toml("approve")),
        ...set("mcp_servers.walkmycode.enabled_tools", `[${tools.map(toml).join(",")}]`),
        "-",
      ],
      stdin: system,
    };
  },
  read: (line) => {
    const ev = parse(line);
    if (!ev) return null;
    const item = ev.item as { type?: string; text?: string } | undefined;
    if (ev.type === "thread.started") return { kind: "init" };
    if (ev.type === "item.completed" && item?.type === "agent_message" && item.text) return { kind: "text", text: item.text.endsWith("\n") ? item.text : `${item.text}\n\n` };
    if (ev.type === "turn.completed") return { kind: "done" };
    if (ev.type === "turn.failed") return { kind: "error", text: str((ev.error as { message?: string } | undefined)?.message) || "Codex stopped." };
    if (ev.type === "error") return { kind: "error", text: str(ev.message) || "Codex stopped." };
    return null;
  },
};

/** Gemini CLI's own tools, all turned off for a run: WalkMyCode's tools read the project instead. */
const GEMINI_BUILTINS = ["run_shell_command", "write_file", "replace", "read_file", "read_many_files", "list_directory", "glob", "search_file_content", "grep", "web_fetch", "google_web_search", "save_memory", "write_todos"];

const gemini: Agent = {
  id: "gemini-cli",
  name: "Gemini CLI",
  command: "gemini",
  url: "https://github.com/google-gemini/gemini-cli",
  account: "your Google account",
  override: "WALKMYCODE_GEMINI",
  strip: (k) => k === "GEMINI_API_KEY" || k === "GOOGLE_API_KEY" || k === "GOOGLE_GENAI_USE_VERTEXAI",
  authArgs: null, // it has no status command: whoFromFiles reads ~/.gemini/settings.json
  who: (settings) => {
    const s = parse(settings);
    const t = str((s?.security as { auth?: { selectedType?: string } } | undefined)?.auth?.selectedType) || str(s?.selectedAuthType);
    if (!t) return "signed_out";
    return t === "oauth-personal" || t === "login-with-google" || t === "cloud-shell" ? "plan" : "api";
  },
  run: ({ model, tools, bridge, system, write }) => {
    // A settings file in the run's own folder: the bridge, trusted so its calls need no approval, and
    // every built-in tool off.
    write(
      ".gemini/settings.json",
      JSON.stringify({ mcpServers: { walkmycode: { ...bridge, trust: true, includeTools: tools } }, tools: { exclude: GEMINI_BUILTINS }, excludeTools: GEMINI_BUILTINS }),
    );
    return { args: ["-p", "", "--skip-trust", "--allowed-mcp-server-names", "walkmycode", "-o", "stream-json", ...(model && model !== "auto" ? ["-m", model] : [])], stdin: system };
  },
  read: (line) => {
    const ev = parse(line);
    if (!ev) return null;
    if (ev.type === "init") return { kind: "init" };
    if (ev.type === "message" && ev.role === "assistant" && str(ev.content)) return { kind: "text", text: str(ev.content) };
    if (ev.type === "result") return ev.status === "error" ? { kind: "error", text: str((ev.error as { message?: string } | undefined)?.message) || "Gemini stopped." } : { kind: "done" };
    if (ev.type === "error") return { kind: "error", text: str(ev.message) || "Gemini stopped." };
    return null;
  },
};

export const AGENTS: Record<AgentId, Agent> = { "claude-code": claude, codex, "gemini-cli": gemini };
export const isAgent = (id: string | null | undefined): id is AgentId => !!id && id in AGENTS;

/** Its own words about who it is signed in as, read as a reason it can't answer: a plan limit, a
 * sign-in, or Google turning personal accounts away from the Gemini CLI. */
export function whyNot(text: string): "signed_out" | "limit" | "unsupported" | null {
  if (/IneligibleTierError|no longer supported for Gemini Code Assist|migrate to the Antigravity/i.test(text)) return "unsupported";
  if (/\/login|not logged in|sign in|authenticat|codex login/i.test(text)) return "signed_out";
  if (/usage limit|rate limit|limit reached|hit your limit|limit · resets|resets at|quota/i.test(text)) return "limit";
  return null;
}
