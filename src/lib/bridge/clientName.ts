// The AI app on the other end of the MCP connection, by the name people know it
// by. Any MCP client can run WalkMyCode's server (Claude Code, Claude Desktop,
// Antigravity, Cursor, VS Code, Windsurf, Zed, the Gemini CLI…): it says who it
// is in the initialize handshake (clientInfo), the server turns that into a
// friendly name here, and the page uses it in every line it says about the
// client ("Antigravity isn't listening", "From Cursor:"). Pure: the server and
// the page both import it.

/** What a client sends as clientInfo (the MCP Implementation: name, version, maybe a title). */
export interface ClientInfo {
  name?: string;
  title?: string;
  version?: string;
}

/** Said when the client gave no name (or before it has). */
export const FALLBACK_CLIENT = "your AI app";

/** Who answers when no client is connected at all (terminal mode): the model picked in Settings → AI model. */
export const STANDALONE_NAME = "your AI model";

/** Known clients: a pattern over clientInfo's name and title, and the name to show. Order matters. */
const KNOWN: [RegExp, string][] = [
  [/claude/i, "Claude"],
  [/antigravity/i, "Antigravity"],
  [/cursor/i, "Cursor"],
  [/copilot/i, "GitHub Copilot"],
  [/visual[\s-]*studio[\s-]*code|\bvs[\s-]*code\b|vscode/i, "VS Code"],
  [/windsurf|codeium/i, "Windsurf"],
  [/\bzed\b/i, "Zed"],
  [/gemini/i, "Gemini CLI"],
  [/\bcline\b/i, "Cline"],
  [/\bgoose\b/i, "Goose"],
  [/\bcontinue\b/i, "Continue"],
];

/** "my-mcp_client" → "My Mcp Client"; at most 40 characters of letters, digits and spaces. */
function prettify(raw: string): string {
  const words = raw
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 40)
    .trim();
}

/** The client's friendly name: "Claude", "Antigravity", "Cursor"…, the raw name prettified, or "your AI app". */
export function clientName(info: ClientInfo | null | undefined): string {
  const seen = [info?.name, info?.title].filter((s): s is string => typeof s === "string" && !!s.trim()).join(" ");
  if (!seen) return FALLBACK_CLIENT;
  for (const [re, name] of KNOWN) if (re.test(seen)) return name;
  return prettify(info?.title?.trim() || info?.name || "") || FALLBACK_CLIENT;
}

/** The name at the start of a sentence: "your AI app" → "Your AI app"; "Cursor" stays. */
export function capName(name: string): string {
  return name ? name[0].toUpperCase() + name.slice(1) : name;
}
