// Ports a browser refuses to connect to, whatever is listening there (Chromium's "unsafe ports", which Edge's
// WebView2 in the desktop app shares, and Firefox's): ERR_UNSAFE_PORT, which a page sees only as "could not
// connect". WalkMyCode listens on ports the system hands out, and the system can hand out one of these: 6566
// (the scanner daemon's) made Run, the terminal and Debug fail with "Could not connect to WalkMyCode's server"
// until a restart (owner, 14 Nov). So a server that gets one asks for another. Ports under 1024 never come
// from the system's free range; they are listed for completeness.
// Chromium: net/base/port_util.cc (kRestrictedPorts). Kept in step with src-tauri/src/server.rs (BLOCKED_PORTS).
export const BROWSER_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export const browserBlocks = (port: number): boolean => BROWSER_BLOCKED_PORTS.has(port);

/**
 * Listen on a free port a browser will connect to: `listen(0)` until the port it got isn't one browsers refuse
 * (`close` gives a refused one back first). A port asked for by number is taken as it is. Returns the port.
 */
export async function listenBrowsable(listen: (port: number) => Promise<number>, close: () => Promise<void>, at = 0, tries = 20): Promise<number> {
  if (at) return listen(at);
  for (let i = 0; ; i++) {
    const port = await listen(0);
    if (!browserBlocks(port) || i + 1 >= tries) return port;
    await close();
  }
}
