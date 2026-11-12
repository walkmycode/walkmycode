// WalkMyCode for Claude talks MCP over stdout, so stdout carries the protocol and
// nothing else: everything WalkMyCode says about itself goes to stderr, which MCP
// clients keep as the server's log.

export function log(...parts: unknown[]): void {
  process.stderr.write(`[walkmycode] ${parts.map((p) => (p instanceof Error ? p.message : String(p))).join(" ")}\n`);
}

/** console.log and friends write to stdout; once the protocol owns it, send them to stderr instead. */
export function keepStdoutForProtocol(): void {
  const toStderr = (...args: unknown[]) => log(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
}
