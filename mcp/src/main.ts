// The entry point of the bundle (`npm run build:mcp` → mcp/dist/server.mjs, run
// with `node mcp/dist/server.mjs`). Next to it the build puts web-tree-sitter.wasm
// (found beside the bundle), the grammars in wasm/, and the page in ui/ (the
// `mcp` front-end target). The Claude Code plugin and the Desktop extension
// carry this same folder as server/. WALKMYCODE_UI_DIR serves another page folder
// (mcp/test-page, say); WALKMYCODE_HOME moves ~/.walkmycode; WALKMYCODE_NO_BROWSER=1
// never opens a browser. The old LANTERN_* names still work when the new ones are unset.
// Started by an AI app (no arguments, stdin a pipe) it is the MCP server over
// stdio; started by a person with a folder it runs in terminal mode
// (mcp/src/cli.ts decides, mcp/src/terminal.ts runs it).
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isatty } from "node:tty";
import { fileURLToPath } from "node:url";
import { decideMode, helpText } from "./cli";
import { log } from "./log";
import { LANTERN_MCP_VERSION, runStdio } from "./server";
import { runTerminal } from "./terminal";
import { FolderError, loadGrammarsFrom } from "./workspace";

const here = dirname(fileURLToPath(import.meta.url));
// ~/.walkmycode (or the old ~/.lantern) holds the maps, the answers and keys.env (src/lib/providers/keys.ts reads WALKMYCODE_HOME too).
process.env.WALKMYCODE_HOME ??= process.env.LANTERN_HOME ?? homedir();
const uiDir = process.env.WALKMYCODE_UI_DIR ?? process.env.LANTERN_UI_DIR ?? join(here, "ui");

// How the user ran it, for the help: through npx (the package's bin), or node and this file.
const script = process.argv[1] ?? "";
const near = script ? relative(process.cwd(), script) : "";
const cmd = /[\\/]node_modules[\\/]|[\\/]_npx[\\/]/.test(script) ? "npx walkmycode-mcp" : `node ${near && !near.startsWith("..") && !isAbsolute(near) ? near.replace(/\\/g, "/") : script || "server.mjs"}`;

// isatty(0) rather than process.stdin.isTTY: nothing opens stdin before MCP mode needs it.
const mode = decideMode(process.argv.slice(2), isatty(0));

if (mode.mode === "help") {
  process.stdout.write(helpText(LANTERN_MCP_VERSION, cmd));
} else if (mode.mode === "version") {
  process.stdout.write(`${LANTERN_MCP_VERSION}\n`);
} else if (mode.mode === "error") {
  process.stderr.write(`walkmycode: ${mode.message}\nRun with --help for how to use it.\n`);
  process.exitCode = 2;
} else {
  loadGrammarsFrom({ folder: join(here, "wasm") });
  if (mode.mode === "mcp") {
    runStdio({ uiDir }).catch((e: unknown) => {
      log("could not start:", e);
      process.exit(1);
    });
  } else {
    runTerminal({ uiDir, folders: mode.folders, name: mode.name }).catch((e: unknown) => {
      if (e instanceof FolderError) process.stderr.write(`walkmycode: ${e.message}\n`);
      else log("could not start:", e);
      process.exit(1);
    });
  }
}
