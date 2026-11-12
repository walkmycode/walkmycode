// "Whose address is this?" (SERVICES.md §13): a public address the code sends
// requests to may be one of the workspace's own apps, deployed. WalkMyCode lists
// each such host with where it is set, who calls it, how many of its requests
// each app's routes answer and a guess, and draws nothing new for it. The host
// is resolved, as a name config gives a service would be, only when the
// service's own deploy config gives it the address (a CI health check, Caddy,
// nginx, Traefik, an Ingress host, fly.toml, render.yaml, a CNAME...) or the
// user says whose it is; the user's answer wins.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { buildMap, hostKey } from "../src/analyzer/build";
import { caddyAddresses, ciAddresses, cnameAddresses, flyAddresses, vercelAddresses } from "../src/analyzer/config/deploy";
import { configKindOf, isConfigPath, redactConfigText, redactSource } from "../src/analyzer/config/files";
import { readK8sRoutes, readNginx } from "../src/analyzer/config/gateway";
import { domainAddresses, traefikAddresses } from "../src/analyzer/config/hosting";
import { upgradeMap } from "../src/analyzer/migrate";
import type { Assertion, CodeMap, SourceFile } from "../src/analyzer/types";
import { kindWord } from "../src/components/Inspector";
import { layoutFor, type LinkItem } from "../src/components/mapLayout";
import { answerFor, changesArrows, withAnswer } from "../src/lib/answers";
import { mapSummary } from "../src/lib/claude/prompts";
import { describeEdge } from "../src/lib/claude/system";
import { answersOf } from "../src/lib/store";
import { combineRepos } from "../src/lib/workspace";
import { readDir } from "../scripts/readDir";
import { buildFixture, readFixture } from "./analyzer.helpers";

const AT = "2026-10-01T00:00:00.000Z";
const HOST = "api.acme-shop.com";
const toApi: Assertion[] = [{ setting: HOST, host: HOST, service: "svc-api", answeredAt: AT }];
const PAGE = "file:web/app/page.tsx";
const LIB = "file:web/lib/api.ts";
const ROUTE = "route:api/main.py#";
const OUTSIDE = "svc:api-acme-shop-com";

/** What a map draws: node ids, and each edge's id, confidence, note and evidence. */
function drawn(map: CodeMap) {
  return {
    nodes: map.nodes.map((n) => n.id).sort(),
    edges: map.edges.map((e) => JSON.stringify([e.id, e.confidence, e.note ?? null, e.evidence])).sort(),
    links: map.system.links.map((l) => `${l.id} ${l.confidence} ${l.count}`).sort(),
  };
}
const edge = (map: CodeMap, id: string) => map.edges.find((e) => e.id === id);
const node = (map: CodeMap, id: string) => map.nodes.find((n) => n.id === id)!;

/** The fixture with more files: a deploy workflow, say. */
async function withFiles(extra: Record<string, string>): Promise<SourceFile[]> {
  return [...(await readFixture("public-api")), ...Object.entries(extra).map(([path, content]) => ({ path, content }))];
}

describe("before an answer (public-api)", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("public-api")).map;
  });

  it("matches by path are guesses, and the generic helper's arrow goes to an outside service", () => {
    assert.equal(map.system.kind, "services");
    const calls = map.edges.filter((e) => e.kind === "calls-route");
    assert.deepEqual(calls.map((e) => e.to).sort(), [`${ROUTE}GET /items`, `${ROUTE}GET /items/{item_id}`, `${ROUTE}POST /orders`]);
    assert.ok(calls.every((e) => e.confidence === "likely"));
    assert.equal(edge(map, `uses-service:${LIB}->${OUTSIDE}`)?.confidence, "certain");
    assert.ok(map.edges.every((e) => e.evidence.every((v) => v.role !== "user")));
    assert.equal(map.missingRoutes, undefined);
  });

  it("lists the host: where it is set, who calls it, how many requests each app answers, and the guess", () => {
    assert.deepEqual(map.publicHosts, [
      {
        host: HOST,
        origin: "https://api.acme-shop.com",
        setAt: [{ file: "web/.env.example", line: 1, text: "NEXT_PUBLIC_API_URL=https://api.acme-shop.com", role: "config" }],
        services: ["svc-web"],
        calls: 5,
        links: 5,
        matches: { "svc-api": 3 },
        guess: "svc-api",
      },
    ]);
  });

  it("the outside card asks, rather than calling it another company's API", () => {
    assert.equal(kindWord(node(map, OUTSIDE), map), "an address on the internet — is it one of yours? Its requests match api's routes");
    const card = layoutFor(map, { kind: "system" }).nodes.find((n) => n.id === OUTSIDE);
    assert.deepEqual(card?.type === "svc" ? card.card.lines : null, ["an address on the internet", "is it one of yours?"]);
    assert.match(mapSummary(map), /- https:\/\/api\.acme-shop\.com \(set at web\/\.env\.example:1; 5 requests from web\): not answered; 3 of its requests match api's routes, so it may be api \(GUESS\)/);
  });

  it("no guess when no app's routes answer a clear majority", async () => {
    const sources = (await readFixture("public-api")).map((s) => (s.path === "api/main.py" ? { ...s, content: 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/items")\ndef items():\n    return []\n' } : s));
    const { map: m } = await buildMap(sources, { name: "public-api" });
    assert.deepEqual(m.publicHosts?.[0].matches, { "svc-api": 1 });
    assert.equal(m.publicHosts?.[0].guess, undefined);
    assert.equal(kindWord(node(m, OUTSIDE), m), "outside service — another company's API");
  });
});

describe("the user says it is the api", () => {
  let none: CodeMap;
  let told: CodeMap;
  before(async () => {
    none = (await buildFixture("public-api")).map;
    told = (await buildFixture("public-api", { assertions: toApi })).map;
  });

  it("path matches are certain, citing the request, where the address is set, and the answer", () => {
    for (const id of [`${PAGE}->${ROUTE}GET /items`, `${PAGE}->${ROUTE}GET /items/{item_id}`, `${PAGE}->${ROUTE}POST /orders`]) {
      const e = edge(told, `calls-route:${id}`);
      assert.equal(e?.confidence, "certain", id);
      assert.equal(e?.note, undefined);
      assert.deepEqual(
        e?.evidence.slice(1).map((v) => [v.file, v.line, v.role, v.host]),
        [
          ["web/.env.example", 1, "config", undefined],
          ["web/.env.example", 1, "user", HOST],
        ],
      );
      assert.equal(e?.evidence[2].text, "you told WalkMyCode: api.acme-shop.com is api");
      assert.ok(e!.evidence[0].file === "web/app/page.tsx" && !e!.evidence[0].role);
    }
  });

  it("the outside node is gone; the generic helper draws an arrow to the api as a whole", () => {
    assert.equal(told.nodes.find((n) => n.id === OUTSIDE), undefined);
    assert.ok(!told.nodes.some((n) => n.kind === "service" && !n.internal));
    const e = edge(told, `uses-service:${LIB}->svc-int:svc-api`);
    assert.equal(e?.confidence, "certain");
    assert.ok(e!.evidence.some((v) => v.role === "user") && e!.evidence.some((v) => !v.role));
    const card = node(told, "svc-int:svc-api");
    assert.deepEqual([card.internal, card.service, card.name], [true, "svc-api", "api"]);
    assert.equal(kindWord(card, told), "another service in this system — code you can open");
  });

  it("a door the api doesn't have is called but not found, certain, and draws nothing", () => {
    assert.deepEqual(told.missingRoutes, [{ service: "svc-api", method: "GET", path: "/reports/weekly", calls: [{ file: "web/app/page.tsx", line: 13, text: "await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reports/weekly`);" }], confidence: "certain" }]);
    assert.ok(!told.edges.some((e) => e.evidence.some((v) => v.file === "web/app/page.tsx" && v.line === 13)));
  });

  it("the system view and the AI say 'you told WalkMyCode'; the answer is on the map", () => {
    assert.deepEqual(told.system.links.map((l) => `${l.id} ${l.confidence}`).sort(), ["calls-route:svc-web->svc-api certain", "uses-service:svc-web->svc-api certain"]);
    const link = layoutFor(told, { kind: "system" }).edges.find((x): x is LinkItem => x.type === "link" && x.source === "svc-web" && x.target === "svc-api");
    assert.match(link!.label, /4 you told WalkMyCode/);
    assert.match(link!.told!, /api\.acme-shop\.com is api/);
    assert.match(mapSummary(told), /- https:\/\/api\.acme-shop\.com \(set at web\/\.env\.example:1; 5 requests from web\): YOU TOLD WALKMYCODE it is api/);
    assert.match(describeEdge(told, edge(told, `calls-route:${PAGE}->${ROUTE}GET /items`)!, true), /\[YOU TOLD WALKMYCODE: api\.acme-shop\.com is api — the user's answer, not proven by the code\]$/);
    assert.deepEqual(told.publicHosts?.[0].answer, toApi[0]);
    assert.equal(told.publicHosts?.[0].links, 4);
  });

  it("naming the service works as well as its id, and an address with its scheme or port is the same address", async () => {
    const byName = (await buildFixture("public-api", { assertions: [{ setting: HOST, host: HOST, service: "api", answeredAt: AT }] })).map;
    assert.deepEqual(drawn(byName), drawn(told));
    assert.equal(byName.publicHosts?.[0].answer?.service, "svc-api");
    assert.equal(hostKey("https://API.acme-shop.com:443/v1"), HOST);
  });

  it("'another company's service / not sure', or a service not on the map, draws exactly what no answer draws", async () => {
    for (const service of [null, "svc-nowhere"]) {
      const m = (await buildFixture("public-api", { assertions: [{ setting: HOST, host: HOST, service, answeredAt: AT }] })).map;
      assert.deepEqual(drawn(m), drawn(none));
    }
    const out = (await buildFixture("public-api", { assertions: [{ setting: HOST, host: HOST, service: null, answeredAt: AT }] })).map;
    assert.equal(kindWord(node(out, OUTSIDE), out), "outside service — you said this address is another company's, or you're not sure");
  });

  it("an old answer about a setting still loads as one, beside an answer about an address", async () => {
    const both = (await buildFixture("public-api", { assertions: [...toApi, { setting: "NEXT_PUBLIC_API_URL", service: "svc-web", answeredAt: AT }] })).map;
    assert.deepEqual(drawn(both), drawn(told));
    assert.deepEqual(answersOf(both), toApi);
    const back = upgradeMap(JSON.parse(JSON.stringify(told)), "cli");
    assert.deepEqual(back.publicHosts, told.publicHosts);
    assert.deepEqual(answersOf(back), toApi);
  });
});

describe("the answers flow keeps address answers by key", () => {
  it("a key with a dot is an address; any change to one draws the map again", () => {
    const one = withAnswer([], HOST, "svc-api", AT);
    assert.deepEqual(one, toApi);
    assert.equal(changesArrows([], one), true);
    // "Another company's" can take back what deploy config said, so it draws again too.
    assert.equal(changesArrows([], withAnswer([], HOST, null, AT)), true);
    assert.deepEqual(withAnswer(one, HOST, undefined), []);
    assert.deepEqual(withAnswer([], "VITE_API_URL", null, AT), [{ setting: "VITE_API_URL", service: null, answeredAt: AT }]);
  });

  it("answerFor reads the workspace's answers, else the one the map was built with", async () => {
    const told = (await buildFixture("public-api", { assertions: toApi })).map;
    assert.deepEqual(answerFor(told, undefined, HOST), toApi[0]);
    assert.equal(answerFor(told, [], HOST), undefined);
  });
});

describe("the service's own deploy config gives it the address", () => {
  const workflow = ["name: Deploy", "on: push", "jobs:", "  deploy:", "    runs-on: ubuntu-latest", "    steps:", "      - name: Smoke check", "        working-directory: api", "        run: |", "          # the API answers after the deploy", "          curl -fsS https://api.acme-shop.com/health", ""].join("\n");

  it("without an answer: solid, citing the request, where the address is set, and the deploy line", async () => {
    const { map } = await buildMap(await withFiles({ ".github/workflows/deploy.yml": workflow }), { name: "public-api" });
    const e = edge(map, `calls-route:${PAGE}->${ROUTE}GET /items/{item_id}`);
    assert.equal(e?.confidence, "certain");
    assert.deepEqual(
      e?.evidence.map((v) => `${v.file}:${v.line}${v.role ? ` ${v.role}` : ""}`),
      ["web/app/page.tsx:7", "web/.env.example:1 config", ".github/workflows/deploy.yml:11 config"],
    );
    assert.ok(map.edges.every((x) => x.evidence.every((v) => v.role !== "user")));
    assert.equal(map.nodes.find((n) => n.id === OUTSIDE), undefined);
    assert.equal(edge(map, `uses-service:${LIB}->svc-int:svc-api`)?.confidence, "certain");
    assert.equal(map.missingRoutes?.[0].confidence, "certain");
    const api = map.services.find((s) => s.id === "svc-api")!;
    assert.ok(api.hostnames.includes(HOST));
    assert.deepEqual(api.addresses, [{ host: HOST, evidence: { file: ".github/workflows/deploy.yml", line: 11, text: "curl -fsS https://api.acme-shop.com/health", role: "config" } }]);
    assert.deepEqual(map.publicHosts?.[0].config, { service: "svc-api", evidence: api.addresses![0].evidence });
    assert.equal(map.files.find((f) => f.path === ".github/workflows/deploy.yml")?.configKind, "deploy");
    // Nothing to ask: the outside card is gone and the AI is told what the config says.
    assert.match(mapSummary(map), /deploy config says it is api \(\.github\/workflows\/deploy\.yml:11\), so requests to it resolve as to that service/);
  });

  it("a user's 'another company's' answer wins over deploy config", async () => {
    const sources = await withFiles({ ".github/workflows/deploy.yml": workflow });
    const out = (await buildMap(sources, { name: "public-api", assertions: [{ setting: HOST, host: HOST, service: null, answeredAt: AT }] })).map;
    const plain = (await buildFixture("public-api")).map;
    assert.deepEqual(drawn(out), drawn(plain));
  });

  it("two repos: the api repo's own workflow names it, and that repo holds one app", async () => {
    const files = await readFixture("public-api");
    const pick = (dir: string) => files.filter((s) => s.path.startsWith(`${dir}/`)).map((s) => ({ path: s.path.slice(dir.length + 1), content: s.content }));
    const deploy = ["jobs:", "  deploy:", "    steps:", "      - name: Deploy to VPS", "        run: |", "          cd ~/apps/api", "          curl -sf https://api.acme-shop.com/ | grep -q ok", ""].join("\n");
    const { sources, repos } = combineRepos([
      { label: "web", files: pick("web") },
      { label: "api", files: [...pick("api"), { path: ".github/workflows/deploy.yml", content: deploy }] },
    ]);
    const { map } = await buildMap(sources, { name: "shop", repos });
    assert.equal(map.services.find((s) => s.id === "svc-api")?.addresses?.[0].evidence.file, "api/.github/workflows/deploy.yml");
    assert.equal(edge(map, "calls-route:file:web/app/page.tsx->route:api/main.py#GET /items")?.confidence, "certain");
  });

  it("not from a workflow that only passes the address on, downloads, notifies, or says it in a comment; not from a README", async () => {
    const passOn = ["jobs:", "  build:", "    steps:", "      - run: |", "          docker build --build-arg NEXT_PUBLIC_API_URL=https://api.acme-shop.com .", "          # curl -sf https://api.acme-shop.com/health", "          curl -fsSL https://api.acme-shop.com/install.sh | sh", "          curl -X POST -d '{}' https://api.acme-shop.com/hooks/deployed", "        env:", "          API: https://api.acme-shop.com", ""].join("\n");
    const { map } = await buildMap(await withFiles({ ".github/workflows/build.yml": passOn, "README.md": "Health: curl -sf https://api.acme-shop.com/health\n" }), { name: "public-api" });
    assert.equal(map.services.find((s) => s.id === "svc-api")?.addresses, undefined);
    assert.equal(map.files.some((f) => f.path === ".github/workflows/build.yml"), false, "a workflow that names no address is not read");
    assert.deepEqual(drawn(map), drawn((await buildFixture("public-api")).map));
  });

  it("an address two services are given is neither's", async () => {
    const caddy = (to: string) => `api.acme-shop.com {\n    reverse_proxy ${to}:8000\n}\n`;
    const compose = "services:\n  web:\n    build: ./web\n  api:\n    build: ./api\n";
    const { map } = await buildMap(await withFiles({ "docker-compose.yml": compose, "web/Caddyfile": caddy("web"), "api/Caddyfile": caddy("api") }), { name: "public-api" });
    assert.ok(!map.services.some((s) => s.addresses));
    assert.match(map.warnings.join("\n"), /api\.acme-shop\.com is given to both the web service \(web\/Caddyfile:1\) and the api service \(api\/Caddyfile:1\), so I don't know whose it is/);
  });
});

describe("deploy files that name an address", () => {
  it("CI: a health check after deploying, a deployment URL, a health-check action; not tools, uploads or secrets", () => {
    const yml = [
      "jobs:",
      "  deploy:",
      "    environment:",
      "      name: production",
      "      url: https://shop.example.org",
      "    steps:",
      "      - uses: jtalk/url-health-check-action@v4",
      "        with:",
      "          url: https://status.example.org/ping",
      "      - name: Download",
      "        run: wget -q -O tool https://tools.example.org/tool-linux",
      "      - name: Tools",
      "        run: curl -fsSL https://get.docker.com | sh",
      "      - name: Ask GitHub",
      "        run: curl -sf https://api.github.com/repos/acme/shop",
      "      - name: Ping",
      "        run: curl -sf https://${{ secrets.HOST }}/health",
      "      - name: Smoke",
      "        run: |",
      "          sleep 3",
      "          curl -sf https://api.example.org/ \\",
      "            | grep -q version",
    ].join("\n");
    assert.deepEqual(
      ciAddresses(".github/workflows/deploy.yml", yml).map((a) => `${a.host}:${a.line}`),
      ["shop.example.org:5", "status.example.org:9", "api.example.org:21"],
    );
    assert.equal(configKindOf(".github/workflows/deploy.yml", yml), "deploy");
    assert.equal(configKindOf(".github/workflows/ci.yml", "jobs:\n  t:\n    steps:\n      - run: npm test\n"), null);
    assert.equal(isConfigPath(".github/workflows/deploy.yml"), true);
    assert.equal(isConfigPath(".gitlab-ci.yml"), true);
    assert.equal(isConfigPath(".github/dependabot.yml"), false);
  });

  it("a GitLab job's cd names its folder", () => {
    const yml = "deploy:\n  script:\n    - cd services/api\n    - curl -f https://api.example.org/healthz\n";
    assert.deepEqual(ciAddresses(".gitlab-ci.yml", yml), [{ host: "api.example.org", file: ".gitlab-ci.yml", line: 4, how: "a health check after deploying", dir: "services/api" }]);
  });

  it("Caddy, Traefik labels, nginx server_name (Windows line endings too), Ingress and HTTPRoute hosts", () => {
    assert.deepEqual(caddyAddresses("Caddyfile", "{\n  email ops@example.org\n}\napi.example.org, www.example.org {\n  reverse_proxy /api/* backend:8000\n}\n"), [
      { host: "api.example.org", file: "Caddyfile", line: 4, how: "a Caddy site", to: "backend:8000" },
      { host: "www.example.org", file: "Caddyfile", line: 4, how: "a Caddy site", to: "backend:8000" },
    ]);
    const compose = 'services:\n  api:\n    build: ./api\n    labels:\n      - "traefik.http.routers.api.rule=Host(`api.example.org`) || Host(`www.example.org`)"\n  web:\n    labels:\n      traefik.http.routers.web.rule: Host(`example.org`)\n';
    assert.deepEqual(
      traefikAddresses("docker-compose.yml", compose).map((a) => `${a.host} ${a.to} :${a.line}`),
      ["api.example.org api :5", "www.example.org api :5", "example.org web :8"],
    );
    const nginx = "# the site's front door\r\nupstream app { server web:3000; }\r\nserver {\r\n  server_name example.org _;\r\n  location / {\r\n    set $u http://app;\r\n    proxy_pass $u;\r\n  }\r\n}\r\n";
    assert.deepEqual(readNginx("deploy/nginx.conf", nginx).addresses, [{ host: "example.org", file: "deploy/nginx.conf", line: 4, how: "nginx server_name", to: "web:3000" }]);
    const ingress = "apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: shop\nspec:\n  rules:\n    - host: api.example.org\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service:\n                name: users\n                port:\n                  number: 8080\n";
    assert.deepEqual(readK8sRoutes("k8s/ingress.yaml", ingress).addresses, [{ host: "api.example.org", file: "k8s/ingress.yaml", line: 7, how: "an Ingress host", to: "users:8080" }]);
    const route = "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: shop\nspec:\n  hostnames:\n    - shop.example.org\n  rules:\n    - backendRefs:\n        - name: web\n          port: 3000\n";
    assert.deepEqual(readK8sRoutes("k8s/route.yaml", route).addresses, [{ host: "shop.example.org", file: "k8s/route.yaml", line: 7, how: "an HTTPRoute hostname", to: "web:3000" }]);
  });

  it("fly.toml, render.yaml, app.yaml, vercel.json and a CNAME file", () => {
    assert.deepEqual(flyAddresses("api/fly.toml", 'app = "acme-api"\nprimary_region = "lhr"\n'), [{ host: "acme-api.fly.dev", file: "api/fly.toml", line: 1, how: "fly.toml's app (Fly serves it at <app>.fly.dev)", dir: "api" }]);
    assert.deepEqual(
      domainAddresses("render.yaml", "services:\n  - type: web\n    name: api\n    rootDir: api\n    domains:\n      - api.example.org\n"),
      [{ host: "api.example.org", file: "render.yaml", line: 6, how: "render.yaml's domains", to: "api", dir: "api" }],
    );
    assert.deepEqual(domainAddresses("app.yaml", "name: shop\nservices:\n  - name: api\ndomains:\n  - domain: api.example.org\n").map((a) => `${a.host} ${a.to}`), ["api.example.org api"]);
    assert.deepEqual(vercelAddresses("web/vercel.json", '{\n  "alias": ["shop.example.org"]\n}\n'), [{ host: "shop.example.org", file: "web/vercel.json", line: 2, how: "vercel.json's alias", dir: "web" }]);
    assert.deepEqual(cnameAddresses("docs/CNAME", "docs.example.org\n"), [{ host: "docs.example.org", file: "docs/CNAME", line: 1, how: "the CNAME file", dir: "docs" }]);
    assert.deepEqual(cnameAddresses("CNAME", "two.example.org\nlines.example.org\n"), []);
  });

  it("a workflow keeps ${{ secrets.X }} as written and hides anything that looks like a key", () => {
    const yml = "      - uses: appleboy/ssh-action@v1\n        with:\n          key: ${{ secrets.VPS_SSH_KEY }}\n          script: |\n            curl -H \"Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345\" https://api.example.org/\n            echo ghp_abcdefghijklmnopqrstuvwxyz0123456789\n";
    const shown = redactConfigText(yml, ".github/workflows/deploy.yml");
    assert.match(shown, /key: \$\{\{ secrets\.VPS_SSH_KEY \}\}/);
    assert.match(shown, /Authorization: Bearer •••/);
    assert.doesNotMatch(shown, /abcdefghijklmnopqrstuvwxyz/);
    assert.equal(redactSource(".github/workflows/deploy.yml", yml), shown);
  });

  it("the folder reader keeps .github/workflows' YAML and nothing else of .github", async () => {
    const root = await mkdtemp(join(tmpdir(), "walkmycode-ci-"));
    try {
      await mkdir(join(root, ".github", "workflows"), { recursive: true });
      await mkdir(join(root, ".github", "scripts"), { recursive: true });
      await mkdir(join(root, ".vscode"), { recursive: true });
      await writeFile(join(root, ".github", "workflows", "deploy.yml"), "jobs: {}\n");
      await writeFile(join(root, ".github", "workflows", "notify.js"), "fetch('https://x.example.org')\n");
      await writeFile(join(root, ".github", "dependabot.yml"), "version: 2\n");
      await writeFile(join(root, ".github", "scripts", "check.js"), "1\n");
      await writeFile(join(root, ".vscode", "settings.json"), "{}\n");
      await writeFile(join(root, "app.ts"), "export {};\n");
      assert.deepEqual((await readDir(root)).map((s) => s.path).sort(), [".github/workflows/deploy.yml", "app.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("no answers, no deploy config: nothing changes", () => {
  for (const name of ["monolith", "compose-shop", "vite-api", "flutter-app"]) {
    it(`${name}: no public address, no address on a service, and an answer about an address nothing calls draws the same map`, async () => {
      const plain = (await buildFixture(name)).map;
      assert.equal(plain.publicHosts, undefined);
      assert.ok(plain.services.every((s) => !s.addresses));
      assert.ok(plain.files.every((f) => f.configKind !== "deploy"));
      const other = (await buildFixture(name, { assertions: [{ setting: "nowhere.example.org", host: "nowhere.example.org", service: plain.services[0].id, answeredAt: AT }] })).map;
      assert.deepEqual(drawn(other), drawn(plain));
    });
  }
});
