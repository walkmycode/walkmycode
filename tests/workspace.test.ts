// Several folders, one map (SERVICES.md §6, §9 task 10, §10 two-repo variant):
// paths are prefixed with the repo label, each repo root is its own package,
// the same system comes out whether the code sits in one folder or two, and
// services named in one repo are bound to the code in another (§6.5).
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap, SourceFile } from "../src/analyzer/types";
import { runTool } from "../src/lib/claude/tools";
import { nodeAt } from "../src/lib/store";
import { combineRepos, defaultName, MAX_FILES_PER_WORKSPACE, splitRepos, tooMany, uniqueLabels } from "../src/lib/workspace";
import { buildFixture, readFixture } from "./analyzer.helpers";

const f = (path: string, content: string): SourceFile => ({ path, content });

describe("combineRepos", () => {
  it("leaves one repo's paths as they are", () => {
    const files = [f("src/a.ts", "a"), f("package.json", "{}")];
    const { sources, repos } = combineRepos([{ label: "shop", files }]);
    assert.deepEqual(sources, files);
    assert.deepEqual(repos, [{ label: "shop", prefix: "", kind: "local" }]);
  });

  it("prefixes every path with its repo's label when there are several", () => {
    const { sources, repos } = combineRepos([
      { label: "web", files: [f("src/index.ts", "w")] },
      { label: "api", files: [f("src/index.ts", "a")], kind: "demo" },
    ]);
    assert.deepEqual(
      sources.map((s) => s.path),
      ["web/src/index.ts", "api/src/index.ts"],
    );
    assert.deepEqual(repos, [
      { label: "web", prefix: "web/", kind: "local" },
      { label: "api", prefix: "api/", kind: "demo" },
    ]);
  });

  it("keeps labels apart and safe as a path segment", () => {
    assert.deepEqual(uniqueLabels(["api", "api", "web", "API"]), ["api", "api-2", "web", "API-3"]);
    assert.deepEqual(uniqueLabels(["a/b", ".hidden", ""]), ["a-b", "hidden", "repo"]);
  });

  it("splits a workspace's files back into its repos", () => {
    const { sources, repos } = combineRepos([
      { label: "web", files: [f("a.ts", "1")] },
      { label: "api", files: [f("b.py", "2")] },
    ]);
    const files = Object.fromEntries(sources.map((s) => [s.path, s.content]));
    assert.deepEqual(splitRepos(files, repos), [
      { label: "web", files: [f("a.ts", "1")] },
      { label: "api", files: [f("b.py", "2")] },
    ]);
    assert.deepEqual(splitRepos({ "x.ts": "1" }, [{ label: "one", prefix: "" }]), [{ label: "one", files: [f("x.ts", "1")] }]);
  });

  it("refuses a folder that would take the workspace past its limit, with a reason", () => {
    assert.equal(tooMany(4000, 8000), null);
    const why = tooMany(MAX_FILES_PER_WORKSPACE, 1);
    assert.ok(why && /12,001 files/.test(why) && /at most 12,000/.test(why), why ?? "");
  });

  it("names a workspace nobody named after its repos", () => {
    assert.equal(defaultName(["shop"]), "shop");
    assert.equal(defaultName(["web", "services"]), "web + services");
    assert.equal(defaultName(["a", "b", "c", "d", "e"]), "a + b + c + 2 more");
  });
});

/** compose-shop as two repos: `web` (= web/) and `services` (= services/ plus a
 * copy of docker-compose.yml whose build paths are relative to it). */
async function twoRepos(): Promise<{ sources: SourceFile[]; repos: CodeMap["repos"] }> {
  const all = await readFixture("compose-shop");
  const web = all.filter((s) => s.path.startsWith("web/")).map((s) => f(s.path.slice("web/".length), s.content));
  const compose = all
    .find((s) => s.path === "docker-compose.yml")!
    .content.replace("build: ./web", "build: ../web")
    .replace(/build: \.\/services\//g, "build: ./");
  const services = [...all.filter((s) => s.path.startsWith("services/")).map((s) => f(s.path.slice("services/".length), s.content)), f("docker-compose.yml", compose)];
  return combineRepos([
    { label: "web", files: web },
    { label: "services", files: services },
  ]);
}

describe("compose-shop as two repos", () => {
  let one: CodeMap;
  let two: CodeMap;
  let again: CodeMap;
  let files: Record<string, string>;
  before(async () => {
    one = (await buildFixture("compose-shop")).map;
    const { sources, repos } = await twoRepos();
    files = Object.fromEntries(sources.map((s) => [s.path, s.content]));
    two = (await buildMap(sources, { name: "shop", repos })).map;
    again = (await buildMap(sources, { name: "shop", repos })).map;
  });

  it("records both repos", () => {
    assert.deepEqual(
      two.repos.map((r) => [r.label, r.prefix]),
      [
        ["web", "web/"],
        ["services", "services/"],
      ],
    );
    assert.ok(two.files.every((x) => x.path.startsWith("web/") || x.path.startsWith("services/")), "every path starts with a repo label");
  });

  it("finds the same services as the one-folder map, each with its repo", () => {
    assert.equal(two.system.kind, "services");
    assert.deepEqual(
      two.services.map((s) => [s.id, s.kind]),
      one.services.map((s) => [s.id, s.kind]),
    );
    const repoOf = Object.fromEntries(two.services.map((s) => [s.id, s.repo]));
    assert.equal(repoOf["svc-web"], "web");
    assert.equal(repoOf["svc-users"], "services");
    assert.equal(repoOf["svc-orders"], "services");
    assert.deepEqual(two.services.find((s) => s.id === "svc-users")!.areas, ["services/users"]);
    // The compose file is in the services repo; web's build folder is the web repo's root.
    assert.deepEqual(two.services.find((s) => s.id === "svc-web")!.areas, ["web"]);
    assert.ok(two.services.find((s) => s.id === "svc-web")!.evidence.some((e) => e.file === "services/docker-compose.yml"));
  });

  it("gives the same node and edge ids as the one-folder map, and the same ids every build", () => {
    assert.deepEqual(two.nodes.map((n) => n.id).sort(), one.nodes.map((n) => n.id).sort());
    assert.deepEqual(two.edges.map((e) => e.id).sort(), one.edges.map((e) => e.id).sort());
    assert.deepEqual(
      again.nodes.map((n) => n.id),
      two.nodes.map((n) => n.id),
    );
    assert.deepEqual(
      again.edges.map((e) => e.id),
      two.edges.map((e) => e.id),
    );
  });

  it("resolves web's call to users through the other repo's compose file", () => {
    const e = two.edges.find((x) => x.id === "calls-route:file:web/src/lib/api.ts->route:services/users/src/index.js#GET /users/:id");
    assert.ok(e, "web → users GET /users/:id");
    assert.equal(e.confidence, "certain");
    assert.ok(e.evidence.some((x) => x.file === "services/docker-compose.yml" && x.role === "config"));
    for (const edge of two.edges) for (const ev of edge.evidence) assert.ok(files[ev.file] !== undefined, `${edge.id} cites ${ev.file}, which is in the workspace`);
  });

  it("reads files and finds nodes by their prefixed paths", () => {
    const out = runTool({ map: two, files }, "read_file", { path: "web/src/lib/api.ts" });
    assert.match(out, /^web\/src\/lib\/api\.ts \(lines 1-/);
    const route = two.nodes.find((n) => n.id === "route:services/users/src/index.js#GET /users/:id")!;
    assert.equal(nodeAt(two, "services/users/src/index.js", route.line!)?.id, route.id);
  });
});

describe("each repo root is a package", () => {
  it("never lets one repo's loose files fall into another repo's package", async () => {
    const { sources, repos } = combineRepos([
      { label: "a", files: [f("package.json", `{ "name": "a" }`), f("src/x.ts", "export const x = 1;\n")] },
      { label: "b", files: [f("tools/run.ts", "export const y = 2;\n")] },
    ]);
    const { map } = await buildMap(sources, { name: "ab", repos });
    assert.equal(map.nodes.find((n) => n.id === "file:b/tools/run.ts")?.area, "b");
    assert.equal(map.nodes.find((n) => n.id === "file:a/src/x.ts")?.area, "a");
  });
});

describe("binding across repos (§6.5)", () => {
  const deploy = [
    f(
      "docker-compose.yml",
      [
        "services:",
        "  web:",
        "    image: acme/storefront:1",
        "    ports:",
        '      - "3000:3000"',
        "    environment:",
        "      USERS_URL: http://users:8080",
        "  users:",
        "    image: ghcr.io/acme/users:2",
        "  postgres:",
        "    image: postgres:16",
        "",
      ].join("\n"),
    ),
  ];
  const web = [
    f("package.json", `{\n  "name": "storefront",\n  "dependencies": { "next": "16.0.0", "react": "19.0.0" }\n}\n`),
    f("app/page.tsx", "export default function Page() {\n  async function show() {\n    await fetch(`${process.env.USERS_URL}/users/1`);\n  }\n  return <button onClick={show}>Show</button>;\n}\n"),
  ];
  const users = [
    f("package.json", `{\n  "name": "users-api",\n  "dependencies": { "express": "4.0.0" }\n}\n`),
    f("src/index.js", 'const express = require("express");\nconst app = express();\napp.get("/users/:id", (req, res) => res.json({}));\napp.listen(8080);\n'),
  ];

  let map: CodeMap;
  before(async () => {
    const { sources, repos } = combineRepos([
      { label: "deploy", files: deploy },
      { label: "shop-web", files: web },
      { label: "users", files: users },
    ]);
    map = (await buildMap(sources, { name: "shop", repos })).map;
  });

  it("binds an image-only compose service to the repo with its name, with both lines as evidence", () => {
    const u = map.services.find((s) => s.id === "svc-users")!;
    assert.equal(u.kind, "app");
    assert.equal(u.repo, "users");
    assert.deepEqual(u.areas, ["users"]);
    assert.equal(u.confidence, "likely", "bound by name, so a guess");
    assert.ok(u.evidence.some((e) => e.file === "deploy/docker-compose.yml"));
    assert.ok(u.evidence.some((e) => e.file === "users/package.json"));
  });

  it("binds by the package's own name when the repo label differs (acme/storefront → storefront)", () => {
    const w = map.services.find((s) => s.id === "svc-web")!;
    assert.equal(w.kind, "app");
    assert.equal(w.repo, "shop-web");
    assert.deepEqual(w.areas, ["shop-web"]);
    assert.ok(w.evidence.some((e) => e.file === "shop-web/package.json" && e.line === 2));
  });

  it("resolves a setting in one repo to code in another, citing the config line", () => {
    assert.equal(map.system.kind, "services");
    const e = map.edges.find((x) => x.id === "calls-route:file:shop-web/app/page.tsx->route:users/src/index.js#GET /users/:id");
    assert.ok(e);
    assert.ok(e.evidence.some((x) => x.file === "deploy/docker-compose.yml" && x.role === "config"));
    assert.ok(!map.nodes.some((n) => n.internal), "no placeholder left once the code is here");
  });

  it("turns a placeholder into the service once its repo is added", async () => {
    const orders = [
      f("requirements.txt", "fastapi\nrequests\n"),
      f("app/main.py", 'import requests\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.post("/orders")\ndef create():\n    requests.post("http://payments:9000/charge")\n    return {}\n'),
    ];
    const payments = [
      f("package.json", `{\n  "name": "payments",\n  "dependencies": { "express": "4.0.0" }\n}\n`),
      f("index.js", 'const express = require("express");\nconst app = express();\napp.post("/charge", (req, res) => res.json({}));\napp.listen(9000);\n'),
    ];
    const alone = combineRepos([{ label: "orders", files: orders }]);
    const before = (await buildMap(alone.sources, { name: "orders", repos: alone.repos })).map;
    assert.ok(before.nodes.some((n) => n.id === "svc-int:svc-payments" && n.internal), "payments is a service I can't see");

    const both = combineRepos([
      { label: "orders", files: orders },
      { label: "payments", files: payments },
    ]);
    const after = (await buildMap(both.sources, { name: "shop", repos: both.repos })).map;
    assert.equal(after.system.kind, "services");
    assert.equal(after.services.find((s) => s.id === "svc-payments")?.kind, "app");
    assert.ok(!after.nodes.some((n) => n.internal), "the placeholder is gone");
    const e = after.edges.find((x) => x.id === "calls-route:route:orders/app/main.py#POST /orders->route:payments/index.js#POST /charge");
    assert.ok(e, "orders → payments POST /charge");
    assert.ok(e.evidence.some((x) => x.file === "orders/app/main.py"));
    assert.ok(e.evidence.some((x) => x.file.startsWith("payments/")), "the line that names the payments service is evidence too");
  });
});
