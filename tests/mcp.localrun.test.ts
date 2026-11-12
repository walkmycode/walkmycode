// WalkMyCode for Claude's local-run socket and route (mcp/src/web.ts, routes.ts):
// the page server's own cookie and Origin, and the user's consent, are all
// needed; a page with them runs code; nothing gets in from another site.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import WebSocket from "ws";
import { Bridge } from "../mcp/src/bridge";
import { apiRoutes } from "../mcp/src/routes";
import { cookieName, startWeb } from "../mcp/src/web";
import { createLocalRun } from "../src/lib/localrun/hub";
import { killAll } from "../src/lib/localrun/processes";
import { LOCALRUN_SOCKET_PATH, type ServerMsg } from "../src/lib/localrun/protocol";

const dir = mkdtempSync(join(tmpdir(), "wmc-mcp-localrun-"));
// Its own home, so the page server never reuses the real ~/.walkmycode page port (a live
// session's, or another test file's running at the same time).
const savedHome = process.env.WALKMYCODE_HOME;
process.env.WALKMYCODE_HOME = dir;
after(() => {
  killAll();
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("WalkMyCode for Claude: running code on this computer", () => {
  it("needs the cookie, its own Origin and consent; then it runs code", async () => {
    const nodeDir = dirname(process.execPath);
    const lr = createLocalRun({ configFile: () => join(dir, "config.json"), env: { ...process.env, PATH: nodeDir, Path: nodeDir } });
    const web = await startWeb({
      bridge: new Bridge(),
      uiDir: join(process.cwd(), "mcp", "test-page"),
      workspace: () => null,
      token: "mcp-token",
      api: apiRoutes({ saveAnswers: async () => false, localRun: lr }),
      localRun: lr,
    });
    const origin = web.origin;
    const cookie = `${cookieName(web.port)}=mcp-token`;
    const url = `ws://127.0.0.1:${web.port}${LOCALRUN_SOCKET_PATH}`;
    const tryOpen = (headers: Record<string, string>, o: { origin?: string } = {}) =>
      new Promise<number | "open">((done) => {
        const w = new WebSocket(url, { headers, ...(o.origin ? { origin: o.origin } : {}) });
        w.on("open", () => {
          done("open");
          w.close();
        });
        w.on("unexpected-response", (_r, res) => done(res.statusCode ?? 0));
        w.on("error", () => done(0));
      });
    try {
      assert.equal(await tryOpen({ cookie }, { origin }), 403, "off until allowed");
      // The route: only with the cookie, from its own Origin, as JSON.
      const post = (headers: Record<string, string>) =>
        fetch(`${origin}/api/localrun`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ allowed: true }) });
      assert.equal((await post({ origin })).status, 403, "no cookie");
      assert.equal((await post({ cookie, origin: "https://evil.example" })).status, 403, "another site");
      assert.equal(lr.allowed(), false);
      const ok = await post({ cookie, origin });
      assert.equal(ok.status, 200);
      const body = (await ok.json()) as { allowed: boolean; socket: { url: string; token: string | null } };
      assert.equal(body.allowed, true);
      assert.deepEqual(body.socket, { url: LOCALRUN_SOCKET_PATH, token: null });

      assert.equal(await tryOpen({}, { origin }), 403, "no cookie");
      assert.equal(await tryOpen({ cookie }, { origin: "https://evil.example" }), 403, "another site");
      assert.equal(await tryOpen({ cookie: `${cookieName(web.port)}=guess` }, { origin }), 403, "wrong token");

      const w = new WebSocket(url, { headers: { cookie }, origin });
      const got: ServerMsg[] = [];
      const end = new Promise<ServerMsg>((done) =>
        w.on("message", (d) => {
          const m = JSON.parse(String(d)) as ServerMsg;
          got.push(m);
          if (m.type === "run-exit" || m.type === "run-fail") done(m);
        }),
      );
      await new Promise((r) => w.on("open", r));
      w.send(JSON.stringify({ type: "run", id: "a", lang: "javascript", code: "console.log(6 * 7)" }));
      const m = await end;
      assert.equal(m.type, "run-exit");
      assert.match(got.map((x) => (x.type === "run-out" ? x.text : "")).join(""), /42/);
      w.close();
    } finally {
      await web.close();
    }
  });
});
