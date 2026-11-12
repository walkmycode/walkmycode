// "Run on: This computer" and the terminal (src/lib/localrun): toolchains
// found on a fake PATH, the commands they run, consent off by default and
// allowed/revoked, the guard and token refusing strangers, a stop killing the
// whole process tree, the time limit, and hosted mode refusing everything.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { after, describe, it } from "node:test";
import WebSocket from "ws";
import { loadLocalRun, saveLocalRun } from "../src/lib/localrun/consent";
import { createLocalRun, hostedRefusal, type Link } from "../src/lib/localrun/hub";
import { killAll, running } from "../src/lib/localrun/processes";
import type { ServerMsg } from "../src/lib/localrun/protocol";
import { localRunHandlers } from "../src/lib/localrun/routes";
import { locateIn, startRun, type RunEvents } from "../src/lib/localrun/run";
import { checkUpgrade, originOf, SOCKET_PATH, startSocketServer } from "../src/lib/localrun/socket";
import { findShells } from "../src/lib/localrun/terminal";
import { cleanVersion, detectToolchains, findOnPath, isStoreStub, localLangOf, nodeStripsTypes, planRun, type Toolchain } from "../src/lib/localrun/toolchains";
import { guarded } from "../src/lib/providers/guard";

const temps: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "wmc-localrun-test-"));
  temps.push(d);
  return d;
};
after(() => {
  killAll();
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// ── toolchains on a fake PATH ──

describe("toolchain detection", () => {
  const winFiles = new Set(
    [
      "C:\\Py312\\python.exe",
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe",
      "C:\\Windows\\py.exe",
      "C:\\node\\node.exe",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\tsx.cmd",
      "C:\\Users\\me\\.cargo\\bin\\cargo.exe",
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "C:\\Windows\\System32\\cmd.exe",
    ].map((p) => p.toLowerCase()),
  );
  const winEnv = {
    PATH: ["C:\\Py312", "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps", "C:\\Windows", "C:\\node", "C:\\Users\\me\\AppData\\Roaming\\npm", "C:\\Users\\me\\.cargo\\bin", "C:\\Windows\\System32", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0"].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ProgramFiles: "C:\\Program Files",
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };
  const winExists = (p: string) => winFiles.has(win32.normalize(p).toLowerCase());
  const versions: Record<string, string> = {
    "python.exe": "Python 3.12.4",
    "py.exe": "Python 3.12.4",
    "node.exe": "v20.11.0",
    "tsx.cmd": "tsx v4.19.0\nnode v20.11.0",
    "cargo.exe": "cargo 1.80.0 (376290515 2024-07-16)",
    "bash.exe": "GNU bash, version 5.2.26(1)-release (x86_64-pc-msys)",
    "powershell.exe": "5.1.26100.1",
    "cmd.exe": "Microsoft Windows [Version 10.0.26200.1]",
  };
  const asked: string[] = [];
  const version = async (path: string) => {
    asked.push(path);
    return versions[win32.basename(path).toLowerCase()] ?? null;
  };

  it("finds programs on PATH with PATHEXT, the way the shell would", () => {
    assert.equal(findOnPath("python", { env: winEnv, platform: "win32", exists: winExists }), "C:\\Py312\\python.exe");
    assert.equal(findOnPath("tsx", { env: winEnv, platform: "win32", exists: winExists }), "C:\\Users\\me\\AppData\\Roaming\\npm\\tsx.cmd");
    assert.equal(findOnPath("go", { env: winEnv, platform: "win32", exists: winExists }), null);
    const nix = new Set(["/usr/bin/python3", "/usr/local/bin/node"]);
    const nixO = { env: { PATH: "/usr/local/bin:/usr/bin" }, platform: "linux" as const, exists: (p: string) => nix.has(posix.normalize(p)) };
    assert.equal(findOnPath("python3", nixO), "/usr/bin/python3");
    assert.equal(findOnPath("python", nixO), null);
  });

  it("names each language's program and version, and says exactly what to install for the rest", async () => {
    const tools = await detectToolchains({ env: winEnv, platform: "win32", exists: winExists, version, gitBash: "C:\\Program Files\\Git\\bin\\bash.exe" });
    const by = Object.fromEntries(tools.map((t) => [t.lang, t]));
    assert.equal(by.python.cmd, "python");
    assert.equal(by.python.version, "Python 3.12.4");
    assert.equal(by.javascript.path, "C:\\node\\node.exe");
    assert.equal(by.typescript.cmd, "tsx", "tsx first for TypeScript");
    assert.equal(by.rust.cmd, "cargo");
    assert.equal(by.shell.path, "C:\\Program Files\\Git\\bin\\bash.exe", "Git Bash, not WSL's bash.exe");
    assert.equal(by.powershell.cmd, "powershell");
    assert.equal(by.batch.cmd, "cmd");
    assert.equal(by.go.path, null);
    assert.match(by.go.install, /https:\/\/go\.dev\/dl\//);
    assert.match(by.java.install, /JDK/);
    assert.match(by.sql.install, /sqlite3/);
    assert.equal(asked.filter((p) => p.endsWith("node.exe")).length, 1, "one version call per program");
  });

  it("skips the Microsoft Store's python stand-in, and says why when it is all there is", async () => {
    assert.equal(isStoreStub("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"), true);
    assert.equal(isStoreStub("C:\\Py312\\python.exe"), false);
    const files = new Set(["c:\\users\\me\\appdata\\local\\microsoft\\windowsapps\\python.exe"]);
    const tools = await detectToolchains({
      env: { PATH: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps", PATHEXT: ".EXE" },
      platform: "win32",
      exists: (p) => files.has(win32.normalize(p).toLowerCase()),
      version: async () => "",
    });
    const py = tools.find((t) => t.lang === "python")!;
    assert.equal(py.path, null);
    assert.match(py.note ?? "", /Microsoft Store/);
    assert.match(py.install, /python\.org/);
  });

  it("runs TypeScript on plain Node only from 22.18 / 23.6", () => {
    assert.equal(nodeStripsTypes("v20.11.0"), false);
    assert.equal(nodeStripsTypes("v22.18.0"), true);
    assert.equal(nodeStripsTypes("v23.5.0"), false);
    assert.equal(nodeStripsTypes("v24.8.0"), true);
    assert.equal(cleanVersion('openjdk version "21.0.2" 2024-01-16\nOpenJDK Runtime'), 'openjdk version "21.0.2" 2024-01-16');
  });

  it("knows the language by the file's ending", () => {
    assert.equal(localLangOf("src/app.py"), "python");
    assert.equal(localLangOf("cmd/main.go"), "go");
    assert.equal(localLangOf("Main.java"), "java");
    assert.equal(localLangOf("x.TS"), "typescript");
    assert.equal(localLangOf("README.md"), null);
  });

  it("builds the command per toolchain", () => {
    const t = (lang: Toolchain["lang"], cmd: string, path = `/bin/${cmd}`): Toolchain => ({ lang, label: lang, cmd, path, version: null, install: "" });
    assert.deepEqual(planRun(t("python", "python"), "/w/a.py")!.steps, [{ file: "/bin/python", args: ["-u", "/w/a.py"] }]);
    assert.deepEqual(planRun(t("python", "py"), "/w/a.py")!.steps[0].args, ["-3", "-u", "/w/a.py"]);
    assert.deepEqual(planRun(t("go", "go"), "/w/m.go")!.steps[0].args, ["run", "/w/m.go"]);
    assert.deepEqual(planRun(t("typescript", "deno"), "/w/m.ts")!.steps[0].args, ["run", "--allow-all", "/w/m.ts"]);
    assert.deepEqual(planRun(t("rust", "cargo"), "/w/src/main.rs", { cargoRoot: "/w" })!.steps[0].args, ["run", "--quiet"]);
    const rustc = planRun(t("rust", "rustc"), "/w/main.rs", { exe: "/tmp/main" })!;
    assert.equal(rustc.steps.length, 2, "compile, then run");
    assert.equal(rustc.steps[1].file, "/tmp/main");
    assert.equal(planRun({ ...t("go", "go"), path: null }, "/w/m.go"), null);
  });

  it("finds the shells: PowerShell first on Windows, cmd and Git Bash when present", () => {
    const shells = findShells({ env: winEnv, platform: "win32", exists: winExists });
    assert.deepEqual(
      shells.map((s) => s.id),
      ["powershell", "cmd", "gitbash"],
    );
    const nix = new Set(["/bin/zsh", "/bin/bash"]);
    const unix = findShells({ env: { PATH: "/bin", SHELL: "/bin/zsh" }, platform: "darwin", exists: (p) => nix.has(posix.normalize(p)) });
    assert.deepEqual(
      unix.map((s) => s.id),
      ["zsh", "bash"],
    );
  });

  it("finds a workspace file on disk, and nothing outside its folders", () => {
    const a = join(tmpdir(), "work", "api");
    const b = join(tmpdir(), "work", "web");
    assert.equal(locateIn([a], ["api"], "src/app.py")?.file, join(a, "src", "app.py"));
    assert.equal(locateIn([a, b], ["api", "web"], "web/src/x.ts")?.root, b);
    assert.equal(locateIn([a], ["api"], "../secret.txt"), null);
    assert.equal(locateIn([a, b], ["api", "web"], "other/x.ts"), null);
    assert.equal(locateIn([], [], "x.py"), null);
  });
});

// ── consent ──

function hub(o: { refusal?: () => string | null } = {}) {
  const dir = tempDir();
  const configFile = join(dir, ".walkmycode", "config.json");
  // node is the one toolchain the tests can count on: it is running them.
  const nodeDir = dirname(process.execPath);
  const lr = createLocalRun({ configFile: () => configFile, refusal: o.refusal, env: { ...process.env, PATH: nodeDir, Path: nodeDir } });
  return { lr, configFile, dir };
}

function fakeLink() {
  const got: ServerMsg[] = [];
  const closed: { code?: number; reason?: string }[] = [];
  const link: Link = { send: (m) => got.push(m), close: (code, reason) => closed.push({ code, reason }) };
  return { link, got, closed };
}

describe("consent", () => {
  it("is off until allowed, keeps the rest of config.json, and revoking closes every socket", async () => {
    const { lr, configFile } = hub();
    assert.equal(loadLocalRun(configFile).allowed, false, "no file: off");
    const off = await lr.status(async () => ({ url: "ws://x", token: "t" }));
    assert.equal(off.available, true);
    assert.equal(off.allowed, false);
    assert.equal(off.socket, null, "no socket before consent");
    assert.deepEqual(off.toolchains, [], "nothing is probed before consent");
    assert.equal(lr.connect(fakeLink().link), null, "no connection before consent");

    lr.save({ timeout_s: 30 });
    writeFileSync(configFile, JSON.stringify({ provider: "anthropic", model: "x", local_run: { allowed: false, timeout_s: 30 } }));
    lr.save({ allowed: true });
    const on = await lr.status(async () => ({ url: "ws://x", token: "t" }));
    assert.equal(on.allowed, true);
    assert.ok(on.allowed_at);
    assert.equal(on.timeout_s, 30);
    assert.deepEqual(on.socket, { url: "ws://x", token: "t" });
    assert.ok(on.toolchains.find((t) => t.lang === "javascript")?.path, "node found");
    const saved = JSON.parse(readFileSync(configFile, "utf8"));
    assert.equal(saved.provider, "anthropic", "other settings kept");
    assert.equal(saved.local_run.allowed, true);

    const a = fakeLink();
    const conn = lr.connect(a.link);
    assert.ok(conn);
    lr.save({ allowed: false });
    assert.equal(a.closed.length, 1, "revoking closes the open socket");
    assert.equal(a.closed[0].code, 4403);
    assert.equal(lr.connect(fakeLink().link), null);
    assert.equal(loadLocalRun(configFile).allowed, false);
  });

  it("reads only an exact allowed: true, and clamps the time limit", () => {
    const f = join(tempDir(), "config.json");
    writeFileSync(f, JSON.stringify({ local_run: { allowed: "yes", timeout_s: 99999 } }));
    assert.deepEqual(loadLocalRun(f), { allowed: false, timeout_s: 3600 });
    assert.equal(saveLocalRun(f, { timeout_s: 0 }).timeout_s, 1);
  });

  it("refuses a message once revoked behind its back (the file changed)", () => {
    const { lr, configFile } = hub();
    lr.save({ allowed: true });
    const a = fakeLink();
    const conn = lr.connect(a.link)!;
    saveLocalRun(configFile, { allowed: false });
    conn.receive({ type: "run", id: "r1", lang: "javascript", code: "1" });
    assert.ok(a.got.some((m) => m.type === "error"));
    assert.equal(a.closed[0]?.code, 4403);
  });
});

// ── hosted mode ──

describe("hosted mode", () => {
  it("refuses everything under WALKMYCODE_MODE=hosted", async () => {
    assert.match(hostedRefusal({ WALKMYCODE_MODE: "hosted" }) ?? "", /hosted/);
    assert.match(hostedRefusal({ LANTERN_MODE: "Hosted" }) ?? "", /hosted/);
    assert.equal(hostedRefusal({ WALKMYCODE_MODE: "byok" }), null);
    assert.equal(hostedRefusal({}), null);

    const { lr, configFile } = hub({ refusal: () => hostedRefusal({ WALKMYCODE_MODE: "hosted" }) });
    // Even a config file that says yes does not count there.
    saveLocalRun(configFile, { allowed: true });
    const s = await lr.status(async () => ({ url: "ws://x", token: "t" }));
    assert.equal(s.available, false);
    assert.equal(s.allowed, false);
    assert.equal(s.socket, null);
    assert.equal(lr.allowed(), false);
    assert.equal(lr.connect(fakeLink().link), null);
    assert.throws(() => lr.save({ allowed: true }));

    const route = localRunHandlers(lr, async () => null);
    const post = guarded(route.POST);
    const r = await post(new Request("http://localhost:3000/api/localrun", { method: "POST", headers: { host: "localhost:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify({ allowed: true }) }));
    assert.equal(r.status, 403);
  });
});

// ── the guard and the token ──

describe("who may connect", () => {
  it("lets only this server's Host, a known Origin and this launch's token upgrade", () => {
    const me = { port: 5123, token: "tok-123", origins: new Set(["http://localhost:3000"]) };
    const ok = { url: `${SOCKET_PATH}?t=tok-123`, host: "127.0.0.1:5123", origin: "http://localhost:3000" };
    assert.equal(checkUpgrade(ok, me), null);
    assert.equal(checkUpgrade({ ...ok, host: "localhost:5123" }, me), null);
    assert.equal(checkUpgrade({ ...ok, url: "/other?t=tok-123" }, me), "404 Not Found");
    assert.equal(checkUpgrade({ ...ok, url: SOCKET_PATH }, me), "403 Forbidden", "no token");
    assert.equal(checkUpgrade({ ...ok, url: `${SOCKET_PATH}?t=tok-124` }, me), "403 Forbidden", "wrong token");
    assert.equal(checkUpgrade({ ...ok, origin: "https://evil.example" }, me), "403 Forbidden", "another site");
    assert.equal(checkUpgrade({ ...ok, origin: undefined }, me), "403 Forbidden", "no Origin");
    assert.equal(checkUpgrade({ ...ok, host: "evil.example:5123" }, me), "403 Forbidden", "DNS rebinding");
    assert.equal(checkUpgrade({ ...ok, host: "192.168.1.5:5123" }, me), "403 Forbidden", "another machine");
  });

  it("takes the origin only from a loopback request", () => {
    assert.equal(originOf(new Request("http://localhost:3000/api/localrun", { headers: { host: "localhost:3000" } })), "http://localhost:3000");
    assert.equal(originOf(new Request("http://192.168.1.5:3000/api/localrun", { headers: { host: "192.168.1.5:3000" } })), null);
  });

  it("guards the route: another site, another machine (even with WALKMYCODE_ALLOW_REMOTE=1) and non-JSON writes get 403", async () => {
    const { lr } = hub();
    const route = localRunHandlers(lr, async () => null);
    const get = guarded(route.GET);
    const post = guarded(route.POST);
    const h = (o: Record<string, string>) => ({ host: "localhost:3000", "sec-fetch-site": "same-origin", ...o });
    assert.equal((await get(new Request("http://localhost:3000/api/localrun", { headers: h({}) }))).status, 200);
    assert.equal((await get(new Request("http://localhost:3000/api/localrun", { headers: h({ "sec-fetch-site": "cross-site" }) }))).status, 403);
    assert.equal((await post(new Request("http://localhost:3000/api/localrun", { method: "POST", headers: h({ "content-type": "text/plain" }), body: '{"allowed":true}' }))).status, 403);
    process.env.WALKMYCODE_ALLOW_REMOTE = "1";
    try {
      const r = await get(new Request("http://192.168.1.5:3000/api/localrun", { headers: h({ host: "192.168.1.5:3000" }) }));
      assert.equal(r.status, 403, "running code stays on this computer even when the app is opened to the LAN");
    } finally {
      delete process.env.WALKMYCODE_ALLOW_REMOTE;
    }
    assert.equal(lr.allowed(), false, "nothing got allowed");
    const yes = await post(new Request("http://localhost:3000/api/localrun", { method: "POST", headers: h({ "content-type": "application/json" }), body: '{"allowed":true}' }));
    assert.equal(yes.status, 200);
    assert.equal(lr.allowed(), true);
  });

  it("refuses sockets without the token or from another site, and runs code for the right one", async () => {
    const { lr } = hub();
    const srv = await startSocketServer(lr, { token: "launch-token" });
    srv.origins.add("http://localhost:3000");
    const url = (t?: string) => `ws://127.0.0.1:${srv.port}${SOCKET_PATH}${t ? `?t=${t}` : ""}`;
    const tryOpen = (u: string, origin: string) =>
      new Promise<number | "open">((done) => {
        const w = new WebSocket(u, { origin });
        w.on("open", () => {
          done("open");
          w.close();
        });
        w.on("unexpected-response", (_req, res) => done(res.statusCode ?? 0));
        w.on("error", () => done(0));
      });
    try {
      assert.equal(await tryOpen(url("launch-token"), "http://localhost:3000"), 403, "not allowed yet");
      lr.save({ allowed: true });
      assert.equal(await tryOpen(url(), "http://localhost:3000"), 403, "no token");
      assert.equal(await tryOpen(url("guess"), "http://localhost:3000"), 403, "wrong token");
      assert.equal(await tryOpen(url("launch-token"), "https://evil.example"), 403, "another site");

      const w = new WebSocket(url("launch-token"), { origin: "http://localhost:3000" });
      const got: ServerMsg[] = [];
      const exit = new Promise<ServerMsg>((done) =>
        w.on("message", (d) => {
          const m = JSON.parse(String(d)) as ServerMsg;
          got.push(m);
          if (m.type === "run-exit" || m.type === "run-fail") done(m);
        }),
      );
      await new Promise((ok) => w.on("open", ok));
      w.send(JSON.stringify({ type: "run", id: "r1", lang: "javascript", code: 'console.log("hi from node"); console.error("to stderr")' }));
      const end = await exit;
      assert.equal(end.type, "run-exit");
      assert.equal((end as { code: number }).code, 0);
      const out = got.filter((m) => m.type === "run-out").map((m) => (m as { text: string }).text).join("");
      assert.match(out, /hi from node/);
      assert.ok(got.some((m) => m.type === "run-out" && m.stream === "err" && /to stderr/.test(m.text)));
      w.close();
    } finally {
      await srv.close();
    }
  });
});

// ── stop, time limit, kill on shutdown ──

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const nodeTool = (): Toolchain => ({ lang: "javascript", label: "JavaScript", cmd: "node", path: process.execPath, version: process.version, install: "" });

type End = Parameters<RunEvents["exit"]>[0] | { failed: string };
function collect() {
  const out: string[] = [];
  let resolve!: (v: End) => void;
  const done = new Promise<End>((r) => (resolve = r));
  const ev: RunEvents = { start: () => {}, out: (_s, t) => out.push(t), exit: (i) => resolve(i), fail: (m) => resolve({ failed: m }) };
  return { out, done, ev };
}

const waitFor = async (f: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("killing what runs", () => {
  // A program that starts a child of its own, prints both pids, then waits forever.
  const tree = `const { spawn } = require("node:child_process");
const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log("pids", process.pid, c.pid);
setInterval(() => {}, 1000);`;

  it("Stop kills the program and the children it started", async () => {
    const c = collect();
    const h = startRun({ lang: "javascript", code: tree, path: "tree.cjs" }, nodeTool(), null, 60, c.ev);
    await waitFor(() => /pids \d+ \d+/.test(c.out.join("")));
    const [, a, b] = /pids (\d+) (\d+)/.exec(c.out.join(""))!.map(Number);
    assert.ok(alive(a) && alive(b));
    h.stop();
    const end = (await c.done) as { stopped: boolean };
    assert.equal(end.stopped, true);
    await waitFor(() => !alive(a) && !alive(b));
  });

  it("stops a run at the time limit", async () => {
    const c = collect();
    startRun({ lang: "javascript", code: "setInterval(() => {}, 1000)" }, nodeTool(), null, 1, c.ev);
    const end = (await c.done) as { timedOut: boolean; ms: number };
    assert.equal(end.timedOut, true);
    assert.ok(end.ms < 6000);
  });

  it("says exactly what to install when the toolchain is missing", async () => {
    const c = collect();
    startRun({ lang: "go", code: "package main" }, { lang: "go", label: "Go", cmd: null, path: null, version: null, install: "x" }, null, 5, c.ev);
    const end = (await c.done) as { failed: string };
    assert.match(end.failed, /Go is not installed.*https:\/\/go\.dev\/dl\//);
  });

  it("kills every run when the socket closes, and killAll leaves nothing running", async () => {
    const { lr } = hub();
    lr.save({ allowed: true });
    const a = fakeLink();
    const conn = lr.connect(a.link)!;
    conn.receive({ type: "run", id: "r1", lang: "javascript", code: tree, path: "tree.cjs" });
    await waitFor(() => a.got.some((m) => m.type === "run-out" && /pids/.test(m.text)));
    const text = a.got.map((m) => (m.type === "run-out" ? m.text : "")).join("");
    const [, p1, p2] = /pids (\d+) (\d+)/.exec(text)!.map(Number);
    conn.closed();
    await waitFor(() => !alive(p1) && !alive(p2));

    const c = collect();
    startRun({ lang: "javascript", code: "setInterval(() => {}, 1000)" }, nodeTool(), null, 60, c.ev);
    await waitFor(() => running() > 0);
    killAll();
    await c.done;
    assert.equal(running(), 0);
  });
});
