// GET /api/claude-link (src/lib/claudeLink.ts): this checkout's MCP server bundle,
// and whether a WalkMyCode server is listening on the port it last took
// (~/.walkmycode/page-port, written by mcp/src/workspace.ts keepPort). Only the
// port is probed: the page's per-launch token stays with the server and Claude.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDirIn, homeBase } from "./dataDir";
import type { ClaudeLink } from "./claudeLink";

/** Is something accepting connections on 127.0.0.1:port? */
function listening(port: number, ms = 400): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: "127.0.0.1", port });
    const end = (ok: boolean) => {
      s.destroy();
      done(ok);
    };
    s.setTimeout(ms, () => end(false));
    s.once("connect", () => end(true));
    s.once("error", () => end(false));
  });
}

export async function claudeLink(cwd = process.cwd(), home = homeBase(homedir())): Promise<ClaudeLink> {
  const file = join(cwd, "mcp", "dist", "server.mjs");
  const bundle = existsSync(file) ? file : null;
  const dist = join(cwd, "mcp", "dist");
  const marketplace = existsSync(join(dist, ".claude-plugin", "marketplace.json")) ? dist : null;
  let running: number | null = null;
  try {
    const port = Number((await readFile(join(dataDirIn(home), "page-port"), "utf8")).trim());
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && (await listening(port))) running = port;
  } catch {
    // never launched: not running
  }
  return { bundle, marketplace, running };
}
