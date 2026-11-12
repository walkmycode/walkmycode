// "Choose folder…" and "Open it here" on WalkMyCode for Claude's start screen (mcp/src/pickFolder.ts,
// POST /api/folder/pick and /api/folder/open, mcp/src/routes.ts), and the code view's Save
// (POST /api/files/save): each system's own dialog, the routes behind the page's cookie and Origin.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Bridge } from "../mcp/src/bridge";
import { dialogCommand, NoFolderDialog, pickFolder } from "../mcp/src/pickFolder";
import { apiRoutes } from "../mcp/src/routes";
import { cookieName, startWeb } from "../mcp/src/web";

const dir = mkdtempSync(join(tmpdir(), "wmc-folderpick-"));
const savedHome = process.env.WALKMYCODE_HOME;
process.env.WALKMYCODE_HOME = dir;
after(() => {
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("the system's folder dialog", () => {
  it("uses each system's own: the Forms dialog on Windows, Finder on a Mac, zenity then kdialog on Linux", () => {
    assert.equal(dialogCommand("win32")[0].cmd, "powershell.exe");
    assert.ok(dialogCommand("win32")[0].args.includes("-STA"));
    assert.equal(dialogCommand("darwin")[0].cmd, "osascript");
    assert.deepEqual(dialogCommand("linux").map((c) => c.cmd), ["zenity", "kdialog"]);
  });

  it("answers the path picked, null on cancel, and tries the next dialog when one isn't installed", async () => {
    assert.equal(await pickFolder("darwin", async () => "/Users/a/code/app/\n"), "/Users/a/code/app");
    assert.equal(await pickFolder("win32", async () => "C:\\code\\app"), "C:\\code\\app");
    assert.equal(await pickFolder("win32", async () => "C:\\"), "C:\\");
    assert.equal(await pickFolder("darwin", async () => ""), null);
    const tried: string[] = [];
    assert.equal(await pickFolder("linux", async (cmd) => (tried.push(cmd), cmd === "zenity" ? "missing" : "/home/a/app\n")), "/home/a/app");
    assert.deepEqual(tried, ["zenity", "kdialog"]);
    await assert.rejects(pickFolder("linux", async () => "missing"), NoFolderDialog);
  });
});

describe("the folder and save routes", () => {
  it("need the page's cookie and Origin; pick, open and save answer in words", async () => {
    const opened: string[] = [];
    const web = await startWeb({
      bridge: new Bridge(),
      uiDir: join(process.cwd(), "mcp", "test-page"),
      workspace: () => null,
      token: "pick-token",
      api: apiRoutes({
        saveAnswers: async () => false,
        pickFolder: async () => "C:\\code\\app",
        openFolder: async (p) => (p === "nowhere" ? { status: 400, why: "nowhere isn't a folder." } : (opened.push(p), null)),
        saveFile: async (_w, path) => (path === "lib/a.ts" ? null : { status: 404, why: `${path} isn't a file WalkMyCode read for this project.` }),
      }),
    });
    const origin = web.origin;
    const cookie = `${cookieName(web.port)}=pick-token`;
    const post = (path: string, body: unknown, headers: Record<string, string> = { cookie, origin }) =>
      fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    try {
      assert.equal((await post("/api/folder/pick", {}, { origin })).status, 403, "no cookie");
      assert.equal((await post("/api/folder/pick", {}, { cookie, origin: "https://evil.example" })).status, 403, "another site");
      assert.deepEqual(await (await post("/api/folder/pick", {})).json(), { path: "C:\\code\\app" });

      assert.equal((await post("/api/folder/open", { path: "C:\\code\\app" })).status, 200);
      assert.deepEqual(opened, ["C:\\code\\app"]);
      const bad = await post("/api/folder/open", { path: "nowhere" });
      assert.equal(bad.status, 400);
      assert.match(((await bad.json()) as { error: string }).error, /isn't a folder/);
      assert.equal((await post("/api/folder/open", { path: "" })).status, 400);

      assert.equal((await post("/api/files/save", { workspace: "w", path: "lib/a.ts", text: "x" })).status, 200);
      const refused = await post("/api/files/save", { workspace: "w", path: "lib/new.ts", text: "x" });
      assert.equal(refused.status, 404);
      assert.match(((await refused.json()) as { error: string }).error, /isn't a file WalkMyCode read/);
      assert.equal((await post("/api/files/save", { workspace: "w", path: "lib/a.ts", text: "x" }, { origin })).status, 403, "no cookie");
    } finally {
      await web.close();
    }
  });
});
