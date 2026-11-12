// Terminal mode (mcp/src/cli.ts): WalkMyCode with no AI app at all. A person runs
// `node mcp/dist/server.mjs .` (or `npx walkmycode-mcp ~/code/app`): the folders
// are mapped exactly as walkmycode_open maps them, the page server starts, its
// URL (with this launch's token) is printed and opened in the browser, and the
// page answers every question itself with the AI key in Settings → AI model
// (the bridge is "standalone": src/lib/bridge/fallback.ts). Runs until Ctrl+C.
// stdout is the person's here: no MCP protocol runs on it.
import { log } from "./log";
import { createLanternServer, LANTERN_MCP_VERSION, type LanternOptions } from "./server";
import { openWorkspace } from "./workspace";

export interface TerminalOptions extends LanternOptions {
  folders: string[];
  name?: string;
  /** Where the banner goes (default: stdout). */
  print?: (text: string) => void;
}

/** The banner: what is mapped, where the page is, who answers, and how to stop. */
export function banner(o: { name: string; folders: string[]; files: number; url: string; opened: boolean }): string {
  const where = o.folders.length > 1 ? `${o.folders.length} folders as one workspace:\n${o.folders.map((f) => `    ${f}`).join("\n")}` : o.folders[0];
  return [
    "",
    `  WalkMyCode ${LANTERN_MCP_VERSION}`,
    "",
    `  Mapped "${o.name}" (${o.files} files) from ${where}`,
    "",
    `  Page: ${o.url}`,
    `  ${o.opened ? "Opened in your browser; if it didn't appear, open the link above." : "Open the link above in your browser."}`,
    "",
    "  Answers use the AI key in Settings → AI model on the page",
    "  (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY … in the environment).",
    "  Press Ctrl+C to stop.",
    "",
  ].join("\n");
}

/** Map the folders, serve the page and keep going until Ctrl+C. Resolves once it is up; a folder problem rejects (a FolderError, in words to print). */
export async function runTerminal(o: TerminalOptions): Promise<{ url: string; stop: (why: string) => void }> {
  const print = o.print ?? ((text: string) => process.stdout.write(`${text}\n`));
  const lantern = createLanternServer({ ...o, standalone: true });
  let closing = false;
  const stop = (why: string) => {
    if (closing) return;
    closing = true;
    log(`stopping (${why})`);
    // The page server and any local runs hold the process open: close them, then go, even if closing hangs.
    setTimeout(() => process.exit(0), 2_000).unref();
    void lantern.close().finally(() => process.exit(0));
  };
  process.on("unhandledRejection", (e) => log("unhandled rejection:", e));
  process.once("SIGINT", () => stop("Ctrl+C"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP", () => stop("the terminal closed"));

  try {
    log(`mapping ${o.folders.join(", ")}…`);
    const ws = await openWorkspace(o.folders, { name: o.name, cwd: o.cwd, maxFiles: o.maxFiles });
    lantern.session.opened(ws);
    const web = await lantern.session.page();
    const opened = await lantern.session.o.openBrowser(web.url);
    print(banner({ name: ws.info.name, folders: ws.folders, files: ws.info.files, url: web.url, opened }));
    return { url: web.url, stop };
  } catch (e) {
    closing = true;
    await lantern.close().catch(() => {});
    throw e;
  }
}
