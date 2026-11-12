// How the server was started, from its command line (mcp/src/main.ts). Two ways:
//  - by an AI app (Claude Code, Claude Desktop, Antigravity, Cursor…), with no
//    arguments and stdin a pipe: MCP over stdio, as always;
//  - by a person in a terminal, with a folder (`node mcp/dist/server.mjs .`,
//    `npx walkmycode-mcp ~/code/app`, `… open <folder>`): terminal mode
//    (mcp/src/terminal.ts) maps it, opens the page and answers there with the AI
//    key in Settings → AI model, no AI app needed.
// Run bare in a terminal (stdin a TTY), it prints the help instead of sitting
// there waiting for MCP messages nobody will type. Pure, so tests check every case.

/** The most folders one workspace takes (as walkmycode_open's `paths`). */
export const MAX_FOLDERS = 12;

export type Mode =
  | { mode: "mcp" }
  | { mode: "help" }
  | { mode: "version" }
  | { mode: "terminal"; folders: string[]; name?: string }
  | { mode: "error"; message: string };

/** What to do, from the arguments after the script (process.argv.slice(2)) and whether stdin is a terminal. */
export function decideMode(argv: readonly string[], stdinIsTTY: boolean): Mode {
  if (!argv.length) return stdinIsTTY ? { mode: "help" } : { mode: "mcp" };
  const folders: string[] = [];
  let name: string | undefined;
  let open = false;
  let options = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (options && a === "--") {
      options = false;
      continue;
    }
    if (options && (a === "--help" || a === "-h")) return { mode: "help" };
    if (options && (a === "--version" || a === "-v" || a === "-V")) return { mode: "version" };
    if (options && (a === "--name" || a.startsWith("--name="))) {
      const value = a === "--name" ? argv[++i] : a.slice("--name=".length);
      if (value === undefined || !value.trim() || (a === "--name" && value.startsWith("-"))) return { mode: "error", message: "--name needs a name for the workspace, e.g. --name shop." };
      if (value.trim().length > 80) return { mode: "error", message: "--name is at most 80 characters." };
      name = value.trim();
      continue;
    }
    if (options && a.startsWith("-") && a !== "-") return { mode: "error", message: `Unknown option ${a}.` };
    // The first word may be a command: `open <folder…>`, or `help`.
    if (!folders.length && !open && options) {
      if (a === "help") return { mode: "help" };
      if (a === "open") {
        open = true;
        continue;
      }
    }
    if (!a.trim()) return { mode: "error", message: "An empty folder path was given." };
    folders.push(a);
  }
  if (!folders.length) return { mode: "error", message: open ? "open needs a folder: open . (this folder) or open ~/code/my-app." : "Which folder? Give one, e.g. . for this folder." };
  if (folders.length > MAX_FOLDERS) return { mode: "error", message: `At most ${MAX_FOLDERS} folders make one workspace; ${folders.length} were given.` };
  return name ? { mode: "terminal", folders, name } : { mode: "terminal", folders };
}

/** The help text; `cmd` is how the user ran it (npx walkmycode-mcp, or node mcp/dist/server.mjs). */
export function helpText(version: string, cmd = "walkmycode-mcp"): string {
  const usage: [string, string][] = [
    [`${cmd} <folder>`, "map a folder, open the page in your browser and answer there"],
    [`${cmd} <folder> <folder> …`, "several folders as one workspace (--name to name it)"],
    [`${cmd} open <folder>`, "the same"],
    [`${cmd} .`, "this folder"],
    [cmd, "started by an AI app (stdin not a terminal): the MCP server over stdio"],
  ];
  const width = Math.max(...usage.map(([u]) => u.length)) + 3;
  return `WalkMyCode ${version}: a live map of your code in the browser, explained by an AI.

Usage:
${usage.map(([u, what]) => `  ${u.padEnd(width)}${what}`).join("\n")}

Options:
  --name <name>   a name for a workspace of several folders
  -h, --help      this help
  -v, --version   the version

In a terminal, answers use the AI key in Settings → AI model on the page (or ANTHROPIC_API_KEY,
OPENAI_API_KEY, GEMINI_API_KEY … in the environment). Press Ctrl+C to stop.

To let an AI app (Claude Code, Claude Desktop, Antigravity, Cursor…) drive the page instead, add
this server to it as an MCP server with no arguments: see docs/MCP.md.

Environment: WALKMYCODE_NO_BROWSER=1 never opens a browser (the URL is printed); WALKMYCODE_HOME=<dir>
keeps the maps and keys in <dir>/.walkmycode instead of ~/.walkmycode.
`;
}
