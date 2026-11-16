// Ports browsers refuse (src/lib/blockedPorts.ts): the local-run socket got 6566 from the system, and Run,
// the terminal and Debug failed with "Could not connect" until a restart (owner, 14 Nov).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BROWSER_BLOCKED_PORTS, browserBlocks, listenBrowsable } from "../src/lib/blockedPorts";
import { startSocketServer } from "../src/lib/localrun/socket";

describe("ports a browser refuses", () => {
  it("knows the ones the system can hand out", () => {
    for (const p of [6566, 6000, 5060, 10080]) assert.equal(browserBlocks(p), true, String(p));
    for (const p of [3000, 6565, 6567, 50123]) assert.equal(browserBlocks(p), false, String(p));
  });

  it("asks again when it gets one, and keeps a port asked for by number", async () => {
    const given = [6566, 6667, 50123];
    let closed = 0;
    const port = await listenBrowsable(async () => given.shift()!, async () => void closed++);
    assert.equal(port, 50123);
    assert.equal(closed, 2);
    assert.equal(await listenBrowsable(async (p) => p, async () => {}, 4321), 4321);
  });

  it("the desktop app's list (src-tauri/src/server.rs) is the same, above 1024", { skip: !existsSync("src-tauri/src/server.rs") }, () => {
    const rs = readFileSync("src-tauri/src/server.rs", "utf8");
    const m = /BLOCKED_PORTS: &\[u16\] = &\[([^\]]+)\]/.exec(rs);
    assert.ok(m, "BLOCKED_PORTS in server.rs");
    const rust = m[1].split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
    assert.deepEqual(rust, [...BROWSER_BLOCKED_PORTS].filter((p) => p >= 1024).sort((a, b) => a - b));
  });

  it("the local-run socket never listens on one", async () => {
    const lr = { connect: () => null, allowed: () => false } as never;
    const running = await startSocketServer(lr);
    try {
      assert.equal(browserBlocks(running.port), false);
    } finally {
      await running.close();
    }
  });
});
