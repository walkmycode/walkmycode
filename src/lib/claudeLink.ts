// "Use my Claude subscription" on the full app (src/components/SetupAI.tsx): the
// command that registers WalkMyCode for Claude with Claude Code, and what the card
// says about it. Claude never answers in this tab: it opens WalkMyCode's own page
// (127.0.0.1, served by the MCP server) and answers there. GET /api/claude-link
// (src/lib/claudeLinkServer.ts) says where this checkout's server bundle is and
// whether a WalkMyCode server is running now. Plain code, no React, no Node.

/** docs/MCP.md §5. Not on npm yet (docs/DISTRIBUTION.md): shown only where no local bundle is known.
 * The package name is provisional until the trademark check. */
export const MCP_COMMAND = "claude mcp add -s user walkmycode -- npx -y walkmycode-mcp@latest";

export interface ClaudeLink {
  /** mcp/dist/server.mjs of this checkout, absolute; null when it is not built. */
  bundle: string | null;
  /** mcp/dist of this checkout when the build wrote its plugin marketplace there (walkmycode-local). */
  marketplace?: string | null;
  /** The port of a WalkMyCode server answering on 127.0.0.1 now, else null. */
  running: number | null;
}

/** The registration command: `node` on this checkout's bundle when there is one. -s user so it
 * loads in every folder, not just the one it was run in. */
export function mcpCommand(link: ClaudeLink | null): string {
  if (!link?.bundle) return MCP_COMMAND;
  return `claude mcp add -s user walkmycode -- node "${link.bundle}"`;
}

/** The Claude Code plugin from this checkout's build, the way to recommend: its /walkmycode command has
 * every WalkMyCode tool allowed, so Claude doesn't ask before each one. null when there's no build. */
export function pluginCommands(link: ClaudeLink | null): string[] | null {
  if (!link?.marketplace) return null;
  return [`claude plugin marketplace add "${link.marketplace}"`, "claude plugin install walkmycode@walkmycode-local"];
}

/** One line on where things stand, for under the steps; null while unknown. */
export function linkStatus(link: ClaudeLink | null): { ok: boolean; text: string } | null {
  if (!link) return null;
  if (link.running) return { ok: true, text: `WalkMyCode for Claude is running (127.0.0.1:${link.running}). Ask in the tab Claude opened, or ask Claude for the link.` };
  if (!link.bundle) return { ok: false, text: "This copy has no server bundle yet: run npm run build:mcp in the WalkMyCode folder first." };
  return { ok: false, text: "Not running yet: run the command once, then ask Claude in a new session." };
}
