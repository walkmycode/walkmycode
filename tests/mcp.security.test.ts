// WalkMyCode for Claude's safety rules (docs/MCP.md §6): the page server answers
// only at its own Host, swaps the URL's token for an HttpOnly cookie, serves
// nothing outside the page's folder, and takes a WebSocket only from its own
// Origin with this launch's cookie. And no key, and nothing from a .env file,
// reaches Claude through any tool.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { cookieName, cookieToken, freshToken, hostOk, originOk, sameToken } from "../mcp/src/web";
import { fakeKey, FakePage, FIXTURES, get, pageCookie, parsePageUrl, startLantern, type Started } from "./mcp.helpers";

const pageUrl = (text: string) => /Page: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text)?.[1] ?? "";

let home: string;
const savedHome = process.env.WALKMYCODE_HOME;
before(() => {
  home = mkdtempSync(join(tmpdir(), "walkmycode-sec-"));
  process.env.WALKMYCODE_HOME = home;
});
after(() => {
  if (savedHome === undefined) delete process.env.WALKMYCODE_HOME;
  else process.env.WALKMYCODE_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe("the checks", () => {
  it("accept only this server's own Host and Origin", () => {
    for (const h of ["127.0.0.1:5000", "localhost:5000", "LOCALHOST:5000"]) assert.ok(hostOk(h, 5000), h);
    for (const h of [undefined, "", "127.0.0.1", "127.0.0.1:5001", "evil.test:5000", "127.0.0.1.evil.test:5000", "[::1]:5000", "0.0.0.0:5000"]) assert.ok(!hostOk(h, 5000), String(h));
    for (const o of ["http://127.0.0.1:5000", "http://localhost:5000"]) assert.ok(originOk(o, 5000), o);
    for (const o of [undefined, "null", "http://evil.test", "http://127.0.0.1:5001", "https://127.0.0.1:5000", "http://127.0.0.1:5000.evil.test", "file://"]) assert.ok(!originOk(o, 5000), String(o));
  });

  it("read the token from this port's cookie only, and compare it whole", () => {
    assert.equal(cookieToken(`a=1; ${cookieName(5000)}=abc; b=2`, 5000), "abc");
    assert.equal(cookieToken(`${cookieName(5001)}=abc`, 5000), null);
    assert.equal(cookieToken(undefined, 5000), null);
    assert.ok(sameToken("abc", "abc"));
    for (const t of ["abd", "ab", "abcd", "", null, undefined]) assert.ok(!sameToken(t, "abc"), String(t));
  });

  it("make per-launch tokens of 32 characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(freshToken());
    assert.equal(seen.size, 200);
    for (const t of seen) assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  });
});

describe("the page server (MCP.md §6)", () => {
  let s: Started;
  let url = "";
  let port = 0;
  let token = "";

  before(async () => {
    s = await startLantern();
    url = pageUrl((await s.call("walkmycode_open", { path: join(FIXTURES, "monolith") })).text);
    ({ port, token } = parsePageUrl(url));
  });
  after(() => s.close());

  it("listens on 127.0.0.1 at a port of its own", () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]{32}$/);
    assert.ok(port > 0);
  });

  it("swaps the URL's token for an HttpOnly cookie, and takes it out of the address bar", async () => {
    const r = await get(port, `/?t=${token}`, { Host: `127.0.0.1:${port}` });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, "/");
    assert.deepEqual(r.headers["set-cookie"], [`${cookieName(port)}=${token}; HttpOnly; SameSite=Lax; Path=/`]);
    assert.equal(r.headers["referrer-policy"], "no-referrer");
    const page = await get(port, "/", { Host: `127.0.0.1:${port}`, Cookie: pageCookie(url) });
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>WalkMyCode \(test page\)<\/title>/);
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.equal(page.headers["x-content-type-options"], "nosniff");
  });

  it("refuses a wrong token, no cookie, a wrong Host (DNS rebinding) and anything but GET", async () => {
    const host = `127.0.0.1:${port}`;
    const cookie = pageCookie(url);
    assert.equal((await get(port, `/?t=${token.slice(0, -1)}x`, { Host: host })).status, 403);
    // Without the key, a person sees a small WalkMyCode page that tells them to use
    // Claude's link: HTML, still locked down, and with no token in it.
    const noKey = await get(port, "/", { Host: host });
    assert.equal(noKey.status, 403);
    assert.match(String(noKey.headers["content-type"]), /^text\/html/);
    assert.match(noKey.body, /<!doctype html>/i);
    assert.match(noKey.body, /open WalkMyCode/);
    assert.equal(noKey.headers["x-frame-options"], "DENY");
    assert.equal(noKey.headers["x-content-type-options"], "nosniff");
    assert.match(String(noKey.headers["content-security-policy"]), /default-src 'none'/);
    assert.doesNotMatch(noKey.body, new RegExp(token));
    assert.doesNotMatch(noKey.body, /https?:\/\//, "loads nothing from anywhere");
    assert.equal((await get(port, "/api/files", { Host: host, Cookie: `${cookieName(port)}=nope` })).status, 403);
    assert.equal((await get(port, "/api/files", { Host: host, Cookie: `${cookieName(port + 1)}=${token}` })).status, 403);
    const rebound = await get(port, "/api/files", { Host: `evil.test:${port}`, Cookie: cookie });
    assert.equal(rebound.status, 403);
    assert.doesNotMatch(rebound.body, /lib\/auth/);
    assert.equal((await get(port, `/?t=${token}`, { Host: `evil.test:${port}` })).status, 403);
    assert.equal((await get(port, "/", { Host: host, Cookie: cookie }, "POST")).status, 405);
    assert.equal((await get(port, "/", { Host: `localhost:${port}`, Cookie: cookie })).status, 200);
  });

  it("serves nothing outside the page's folder", async () => {
    const h = { Host: `127.0.0.1:${port}`, Cookie: pageCookie(url) };
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/%2e%2e%2fpackage.json", "/..%5cpackage.json", "/%00", "/page.js/../../package.json", "/%2e%2e%2f%2e%2e%2fpackage.json"]) {
      const r = await get(port, p, h);
      assert.ok(r.status === 400 || r.status === 404, `${p} gave ${r.status}`);
    }
    assert.equal((await get(port, "/page.js", h)).status, 200);
  });

  it("serves the open workspace's map and files to the page that has the cookie", async () => {
    const h = { Host: `127.0.0.1:${port}`, Cookie: pageCookie(url) };
    const ws = JSON.parse((await get(port, "/api/workspace", h)).body) as { workspace: { name: string }; map: { nodes: unknown[] } };
    assert.equal(ws.workspace.name, "monolith");
    assert.ok(ws.map.nodes.length > 5);
    const files = JSON.parse((await get(port, "/api/files", h)).body) as Record<string, string>;
    assert.ok("lib/auth.ts" in files);
    assert.match(files[".env.example"], /STRIPE_SECRET_KEY=•••/);
  });

  it("takes a WebSocket only from its own Origin, with this launch's cookie", async () => {
    await assert.rejects(FakePage.connect(url, { origin: "http://evil.test" }), /refused: 403/);
    await assert.rejects(FakePage.connect(url, { origin: `http://127.0.0.1:${port + 1}` }), /refused: 403/);
    await assert.rejects(FakePage.connect(url, { origin: "null" }), /refused: 403/);
    await assert.rejects(FakePage.connect(url, { cookie: null }), /refused: 403/);
    await assert.rejects(FakePage.connect(url, { cookie: `${cookieName(port)}=${token.slice(0, -1)}x` }), /refused: 403/);
    await assert.rejects(FakePage.connect(url, { host: `evil.test:${port}` }), /refused: 403/);
    assert.equal(s.lantern.bridge.hasPage(), false);
    const page = await FakePage.connect(url, { origin: `http://localhost:${port}` });
    assert.equal(page.messages[0].type, "welcome");
    await page.close();
  });
});

describe("no key, and nothing from a .env file, reaches Claude", () => {
  const keys = {
    openai: `sk-proj-${fakeKey(48, 1)}`,
    anthropic: `sk-ant-api03-${fakeKey(40, 2)}`,
    stripe: `sk_live_${fakeKey(24, 3)}`,
    k8s: fakeKey(36, 4),
    inCode: `sk-ant-api03-${fakeKey(44, 5)}`,
    // A key saved in ~/.walkmycode/keys.env that looks like nothing in particular: only knowing it can hide it.
    saved: "elevenlabsplainwordsecret",
    dbPassword: fakeKey(18, 6),
    codePassword: fakeKey(18, 7),
  };
  let project: string;
  let s: Started;

  before(async () => {
    project = mkdtempSync(join(tmpdir(), "walkmycode-keys-project-"));
    const files: Record<string, string> = {
      ".env": `OPENAI_API_KEY=${keys.openai}\nDATABASE_URL=postgres://admin:${keys.dbPassword}@db/app\n`,
      ".env.local": `ANTHROPIC_API_KEY=${keys.anthropic}\n`,
      ".env.example": `STRIPE_SECRET_KEY=${keys.stripe}\nAPI_URL=http://localhost:4000\n`,
      "deploy/secrets.yaml": `apiVersion: v1\nkind: Secret\nmetadata:\n  name: app\nstringData:\n  token: ${keys.k8s}\n`,
      "package.json": `{ "name": "shop", "dependencies": { "express": "4.21.0" } }\n`,
      "src/config.ts": `export const anthropic = "${keys.inCode}";\nexport const voice = "${keys.saved}";\nexport const db = "postgres://admin:${keys.codePassword}@db:5432/app";\n`,
      "src/server.ts": `import express from "express";\nimport { anthropic, voice } from "./config";\n\nconst app = express();\napp.get("/api/keys", (_req, res) => res.json({ anthropic, voice }));\napp.listen(3000);\n`,
    };
    for (const [p, content] of Object.entries(files)) {
      mkdirSync(dirname(join(project, p)), { recursive: true });
      writeFileSync(join(project, p), content);
    }
    mkdirSync(join(home, ".walkmycode"), { recursive: true });
    writeFileSync(join(home, ".walkmycode", "keys.env"), `ELEVENLABS_API_KEY=${keys.saved}\n`);
    s = await startLantern();
  });
  after(async () => {
    await s.close();
    rmSync(project, { recursive: true, force: true });
  });

  it("hides them in every tool's output, and in what the page sends", async () => {
    const outputs: string[] = [];
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await s.call(name, args);
      outputs.push(`${name} ${JSON.stringify(args)}\n${r.text}`);
      return r;
    };
    const open = await call("walkmycode_open", { path: project });
    assert.equal(open.isError, false, open.text);
    for (const glob of [undefined, "**/*", ".env*", "*.yaml", "deploy"]) await call("list_files", glob ? { glob } : {});
    for (const path of [".env", ".env.local", ".env.example", "deploy/secrets.yaml", "src/config.ts", "src/server.ts", "package.json"]) await call("read_file", { path });
    for (const text of ["sk-", "sk_", "API_KEY", "postgres://", "token", "elevenlabs", keys.openai.slice(0, 14), keys.inCode.slice(0, 20)]) await call("search", { text });
    for (const query of ["src/config.ts", "src/server.ts", "GET /api/keys", "system"]) await call("query_map", { query });

    // The secret files themselves were never read, or were refused.
    assert.match(outputs.find((o) => o.startsWith('read_file {"path":".env"}'))!, /No such file: \.env\b/);
    assert.match(outputs.find((o) => o.startsWith('read_file {"path":"deploy/secrets.yaml"}'))!, /secret file: WalkMyCode never shows or reads it/);
    // The code that holds keys still reads as code, with the keys hidden.
    const config = outputs.find((o) => o.startsWith('read_file {"path":"src/config.ts"}'))!;
    assert.match(config, /export const anthropic = "•••";/);
    assert.match(config, /export const voice = "•••";/);
    assert.match(config, /postgres:\/\/admin:•••@db:5432\/app/);

    // A page sends a question and a selection that carry keys: Claude gets them hidden.
    const page = await FakePage.connect(pageUrl(open.text));
    await page.request({ kind: "question", payload: { text: `Is ${keys.openai} my key? And ${keys.saved}?` } });
    await page.request({ kind: "explain", payload: { path: "src/config.ts", from: 1, to: 2, text: `export const anthropic = "${keys.inCode}";` } });
    const asked = await call("next_request", { wait_s: 2 });
    const selected = await call("next_request", { wait_s: 2 });
    assert.match(asked.text, /"text":"Is ••• my key\? And •••\?"/);
    assert.match(selected.text, /"kind":"explain"/);
    await page.close();

    for (const out of outputs) {
      for (const [name, value] of Object.entries(keys)) assert.ok(!out.includes(value), `the ${name} key reached Claude in:\n${out.slice(0, 400)}`);
      assert.doesNotMatch(out, /OPENAI_API_KEY=|ANTHROPIC_API_KEY=|DATABASE_URL=/, `a .env line reached Claude in:\n${out.slice(0, 400)}`);
    }
  });
});
