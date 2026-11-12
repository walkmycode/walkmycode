// Config readers (SERVICES.md §9 task 3): compose (both environment forms,
// overrides), Dockerfile, .env.example with redaction, Helm templates that
// must be skipped, and real .env files that are never read.
// (tests/config.test.ts is the provider settings file, hence this name.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { extractConfig } from "../src/analyzer/config";
import { kindOfImage, readCompose } from "../src/analyzer/config/compose";
import { readDockerfile } from "../src/analyzer/config/dockerfile";
import { readEnvFile } from "../src/analyzer/config/envfile";
import { configKindOf, configLangOf, isConfigPath, REDACTED, redactConfigText, redactSource, redactValue } from "../src/analyzer/config/files";
import { KEEP } from "../scripts/readDir";
import { buildFixture, readFixture } from "./analyzer.helpers";

const COMPOSE = `services:
  web:
    build: ./web
    container_name: shop-web
    ports:
      - "3000:3000"
      - "127.0.0.1:9229:9229/tcp"
    environment:
      USERS_URL: \${USERS_URL:-http://users:8080}
      DEBUG: true
  users:
    build:
      context: ./services/users
      dockerfile: docker/Dockerfile.prod
    ports:
      - target: 8080
        published: 8000
    expose:
      - "9100"
    networks:
      backend:
        aliases:
          - users-internal
    environment:
      - DATABASE_URL=postgres://app:hunter2@postgres:5432/shop
      - API_TOKEN=abc
      - EMPTY
    depends_on:
      postgres:
        condition: service_healthy
    command: ["node", "src/index.js"]
  worker:
    build: .
    links:
      - "users:accounts"
    depends_on: [users]
  postgres:
    image: postgres:16
  cache:
    image: redis:7-alpine
  bus:
    image: redpandadata/redpanda:latest
  edge:
    image: nginx:1.27
  billing:
    image: ghcr.io/acme/billing:2
`;

describe("compose", () => {
  const { services, warnings } = readCompose("deploy/docker-compose.yml", COMPOSE);
  const by = (n: string) => services.find((s) => s.name === n)!;

  it("reads every service with the line of its name", () => {
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      services.map((s) => [s.name, s.line]),
      [["web", 2], ["users", 11], ["worker", 32], ["postgres", 37], ["cache", 39], ["bus", 41], ["edge", 43], ["billing", 45]],
    );
    for (const s of services) assert.equal(s.file, "deploy/docker-compose.yml");
  });

  it("binds build folders relative to the compose file, with the named Dockerfile", () => {
    assert.equal(by("web").dir, "deploy/web");
    assert.equal(by("users").dir, "deploy/services/users");
    assert.equal(by("users").dockerfile, "deploy/services/users/docker/Dockerfile.prod");
    assert.equal(by("worker").dir, "deploy");
    assert.equal(by("web").kind, "app");
  });

  it("tells infrastructure from an app built elsewhere by the image name", () => {
    assert.equal(by("postgres").kind, "db");
    assert.equal(by("cache").kind, "cache");
    assert.equal(by("bus").kind, "broker");
    assert.equal(by("edge").kind, "gateway");
    assert.equal(by("billing").kind, "placeholder");
    assert.equal(by("billing").image, "ghcr.io/acme/billing:2");
    assert.equal(kindOfImage("ghcr.io/acme/postgres-tools:1"), "db");
    assert.equal(kindOfImage("acme/users"), null);
  });

  it("reads the map form of environment, with ${VAR:-default} filled in", () => {
    assert.deepEqual(by("web").env.USERS_URL, { value: "http://users:8080", line: 9 });
    assert.deepEqual(by("web").env.DEBUG, { value: "true", line: 10 });
  });

  it("reads the list form of environment and redacts as it reads", () => {
    const env = by("users").env;
    assert.deepEqual(env.DATABASE_URL, { value: "postgres://app:•••@postgres:5432/shop", line: 25 });
    assert.deepEqual(env.API_TOKEN, { value: "•••", line: 26 });
    assert.equal(env.EMPTY, undefined, "a bare name has no value to record");
  });

  it("reads short and long ports, expose, hostnames, aliases and links", () => {
    assert.deepEqual(by("web").ports, [
      { host: 3000, container: 3000 },
      { host: 9229, container: 9229 },
    ]);
    assert.deepEqual(by("users").ports, [{ host: 8000, container: 8080 }, { container: 9100 }]);
    assert.deepEqual(by("web").hostnames, ["web", "shop-web"]);
    assert.deepEqual(by("users").hostnames, ["users", "users-internal", "accounts"]);
  });

  it("reads depends_on in both forms and the start command", () => {
    assert.deepEqual(by("users").dependsOn, ["postgres"]);
    assert.deepEqual(by("worker").dependsOn, ["users"]);
    assert.equal(by("users").entry, "node src/index.js");
    assert.equal(by("users").entryLine, 31);
  });

  it("warns (and reads nothing) when the YAML is broken", () => {
    const r = readCompose("docker-compose.yml", "services:\n  web: [unclosed\n");
    assert.deepEqual(r.services, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /could not read docker-compose\.yml/);
  });
});

describe("compose overrides", () => {
  const base = "services:\n  api:\n    build: ./api\n    ports:\n      - \"8000:8000\"\n    environment:\n      LOG_LEVEL: info\n      USERS_URL: http://users:8080\n";
  const over = "services:\n  api:\n    environment:\n      LOG_LEVEL: debug\n    ports:\n      - \"9229:9229\"\n  mailhog:\n    image: mailhog/mailhog\n";

  it("merges overrides in file-name order after the base file", () => {
    const { facts, warnings } = extractConfig([
      { path: "docker-compose.override.yml", content: over },
      { path: "docker-compose.yml", content: base },
    ]);
    assert.deepEqual(warnings, []);
    const api = facts.services.find((s) => s.name === "api")!;
    assert.equal(api.file, "docker-compose.yml");
    assert.deepEqual(api.also, [{ file: "docker-compose.override.yml", line: 2 }]);
    assert.deepEqual(api.env.LOG_LEVEL, { value: "debug", line: 4, file: "docker-compose.override.yml" });
    assert.deepEqual(api.env.USERS_URL, { value: "http://users:8080", line: 8 });
    assert.deepEqual(api.ports, [
      { host: 8000, container: 8000 },
      { host: 9229, container: 9229 },
    ]);
    assert.ok(facts.services.some((s) => s.name === "mailhog"));
    const lvl = facts.envValues.filter((v) => v.name === "LOG_LEVEL");
    assert.deepEqual(lvl, [{ name: "LOG_LEVEL", value: "debug", file: "docker-compose.override.yml", line: 4, scope: "api" }]);
  });

  it("stands a .env.example in for an env_file, and environment: wins over it", () => {
    const compose = "services:\n  site:\n    build: .\n    env_file:\n      - .env\n    environment:\n      PORT: \"8002\"\n";
    const example = "# comment\nPORT=3000\nSITE_URL=https://example.test # the public address\nPAYSTACK_SECRET_KEY=sk_live_abcdefghijklmnop\n";
    const { facts } = extractConfig([
      { path: "site/docker-compose.yml", content: compose },
      { path: "site/.env.example", content: example },
    ]);
    const site = facts.services.find((s) => s.name === "site")!;
    assert.deepEqual(site.envFiles, ["site/.env.example"]);
    assert.deepEqual(site.env.PORT, { value: "8002", line: 7 });
    assert.deepEqual(site.env.SITE_URL, { value: "https://example.test", line: 3, file: "site/.env.example" });
    assert.deepEqual(site.env.PAYSTACK_SECRET_KEY, { value: "•••", line: 4, file: "site/.env.example" });
    assert.ok(facts.envValues.every((v) => v.scope === "site"), "values from a referenced env file are scoped to its service");
  });
});

describe("Dockerfile", () => {
  it("reads EXPOSE, both ENV forms and the last CMD as a command line", () => {
    const d = readDockerfile('FROM node:20\nENV NODE_ENV=production PORT="8080"\nENV API_KEY abc123\nEXPOSE 8080 9090/tcp\nCMD ["npm", "start"]\nCMD ["node", \\\n  "src/index.js"]\n');
    assert.equal(d.fromLine, 1);
    assert.deepEqual(d.expose, [
      { port: 8080, line: 4 },
      { port: 9090, line: 4 },
    ]);
    assert.deepEqual(d.env, [
      { name: "NODE_ENV", value: "production", line: 2 },
      { name: "PORT", value: "8080", line: 2 },
      { name: "API_KEY", value: "•••", line: 3 },
    ]);
    assert.deepEqual(d.entry, { text: "node src/index.js", line: 6 });
    assert.equal(d.framework, "Node.js");
  });

  it("joins ENTRYPOINT and CMD, and hints the framework", () => {
    const d = readDockerfile('FROM python:3.12\nENTRYPOINT ["uvicorn"]\nCMD ["app.main:app", "--port", "9000"]\n');
    assert.deepEqual(d.entry, { text: "uvicorn app.main:app --port 9000", line: 2 });
    assert.equal(d.framework, "uvicorn");
  });

  it("scopes a Dockerfile's ENV to the compose service built from its folder", () => {
    const { facts } = extractConfig([
      { path: "docker-compose.yml", content: "services:\n  users:\n    build: ./users\n" },
      { path: "users/Dockerfile", content: "FROM node:20\nENV USERS_PORT=8080\nCMD node server.js\n" },
      { path: "tools/Dockerfile", content: "FROM alpine\nENV X=1\n" },
    ]);
    assert.deepEqual(
      facts.envValues.map((v) => [v.name, v.scope]),
      [
        ["USERS_PORT", "users"],
        ["X", undefined],
      ],
    );
    const df = facts.services.find((s) => s.source === "dockerfile" && s.dir === "users")!;
    assert.equal(df.name, "users");
    assert.equal(df.entry, "node server.js");
    assert.equal(df.line, 3);
  });
});

describe(".env.example and secrets", () => {
  it("reads NAME=value lines and hides secrets by name, by shape and inside URLs", () => {
    const lines = readEnvFile('NEXT_PUBLIC_API_URL=http://localhost:3000\nexport DATABASE_URL="postgres://app:pw@db:5432/app"\nSTRIPE_SECRET_KEY=sk_test_abcdefghijklmnop\nGITHUB=ghp_abcdefghijk123\nHASH=0123456789abcdef0123456789abcdef\n# NOT_READ=1\nlower=nope\n');
    assert.deepEqual(lines, [
      { name: "NEXT_PUBLIC_API_URL", value: "http://localhost:3000", line: 1 },
      { name: "DATABASE_URL", value: "postgres://app:•••@db:5432/app", line: 2 },
      { name: "STRIPE_SECRET_KEY", value: "•••", line: 3 },
      { name: "GITHUB", value: "•••", line: 4 },
      { name: "HASH", value: "•••", line: 5 },
    ]);
  });

  it("redactValue keeps ordinary values", () => {
    assert.equal(redactValue("USERS_URL", "http://users:8080"), "http://users:8080");
    assert.equal(redactValue("PASSWORD", ""), "");
    assert.equal(redactValue("DB_PASS", "x"), "•••");
  });

  it("redacts a whole config file line for line, and does it only once", () => {
    const text = "STRIPE_SECRET_KEY=sk_test_abcdefghijklmnop\r\n  - DATABASE_URL=postgres://app:pw@postgres:5432/shop\n      API_TOKEN: \"abc\"\nENV AWS_KEY=AKIAABCDEFGHIJKL OTHER=1\nimage: postgres:16\n";
    const out = redactConfigText(text);
    assert.equal(out.split("\n").length, text.split("\n").length);
    assert.equal(out, "STRIPE_SECRET_KEY=•••\r\n  - DATABASE_URL=postgres://app:•••@postgres:5432/shop\n      API_TOKEN: \"•••\"\nENV AWS_KEY=••• OTHER=1\nimage: postgres:16\n");
    assert.equal(redactConfigText(out), out);
    assert.equal(redactSource("lib/auth.ts", "const KEY = 'sk_live_abcdefghijk';"), "const KEY = 'sk_live_abcdefghijk';", "code is never rewritten");
    assert.equal(redactConfigText("ARG NPM_TOKEN=abcdef123456\nARG NODE_ENV=production\n"), "ARG NPM_TOKEN=•••\nARG NODE_ENV=production\n", "Dockerfile ARG defaults too");
    // Kept by name to be classified, then not Kubernetes after all: still written redacted.
    assert.equal(redactSource("deploy/vars.yml", "db_password: hunter2\napi_url: http://x\n"), "db_password: •••\napi_url: http://x\n");
  });

  it("never reads a real .env: the readers skip it and build.ts marks it secret", async () => {
    for (const p of [".env", ".env.local", ".env.production", "web/.env.development.local"]) {
      assert.equal(isConfigPath(p) || KEEP.test(p), false, p);
    }
    for (const p of [".env.example", "web/.env.sample", ".env.template", ".env.dist"]) assert.equal(isConfigPath(p), true, p);
    const { map } = await buildMap(
      [
        { path: ".env", content: "STRIPE_SECRET_KEY=sk_live_realrealrealreal\n" },
        { path: ".env.example", content: "STRIPE_SECRET_KEY=sk_test_exampleexample\nAPI_URL=http://api:8000\n" },
        { path: "package.json", content: '{"name":"x"}' },
        { path: "index.ts", content: "export const a = 1;\n" },
      ],
      { name: "x" },
    );
    assert.equal(map.files.find((f) => f.path === ".env")?.skipped, "secret");
    const ex = map.files.find((f) => f.path === ".env.example")!;
    assert.equal(ex.lang, "config");
    assert.equal(ex.configKind, "envfile");
    assert.equal(ex.skipped, undefined);
    const json = JSON.stringify(map);
    assert.ok(!json.includes("sk_live_") && !json.includes("sk_test_"));
    assert.equal(map.services[0].env.API_URL.value, "http://api:8000");
    assert.equal(map.services[0].env.STRIPE_SECRET_KEY.value, "•••");
  });

  it("the monolith fixture's .env.example is read, redacted and kept in the map files", async () => {
    const sources = await readFixture("monolith");
    assert.ok(sources.some((s) => s.path === ".env.example"), "the CLI reader keeps .env.example");
    const { map } = await buildFixture("monolith");
    const [svc] = map.services;
    assert.deepEqual(svc.env.STRIPE_SECRET_KEY, { value: "•••", file: ".env.example", line: 3 });
    assert.deepEqual(svc.env.NEXT_PUBLIC_API_URL, { value: "http://localhost:3000", file: ".env.example", line: 1 });
    assert.ok(!JSON.stringify(map).includes("sk_test_"));
  });
});

describe("which files are config", () => {
  it("skips a Helm template, and reads plain Kubernetes YAML only with apiVersion + kind", () => {
    const tpl = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Values.name }}\n";
    assert.equal(configKindOf("charts/shop/templates/deployment.yaml", tpl), "helm");
    assert.equal(configKindOf("k8s/users.yaml", tpl), "helm", "{{ }} marks a template wherever it is");
    assert.equal(configKindOf("k8s/users.yaml", "apiVersion: v1\nkind: Service\nmetadata:\n  name: users\n"), "k8s");
    assert.equal(configKindOf("deploy/notes.yaml", "title: not kubernetes\n"), null);
    assert.equal(configKindOf("charts/shop/values.yaml", "image: x\n"), "helm");
    const { facts, warnings } = extractConfig([{ path: "charts/shop/templates/deployment.yaml", content: tpl }]);
    assert.deepEqual(facts.services, []);
    assert.deepEqual(warnings, []);
  });

  it("classifies config files by name, and leaves code files their own language", () => {
    const cases: [string, string | null][] = [
      ["docker-compose.yml", "compose"],
      ["compose.yaml", "compose"],
      ["docker-compose.override.yml", "compose"],
      ["services/users/Dockerfile", "dockerfile"],
      ["Dockerfile.dev", "dockerfile"],
      ["api.dockerfile", "dockerfile"],
      ["web/next.config.js", "gateway"],
      ["deploy/nginx-site.conf", "gateway"],
      ["openapi.yaml", "openapi"],
      ["protos/users.proto", "proto"],
      ["wrangler.toml", "wrangler"],
      ["pnpm-workspace.yaml", "workspace"],
      ["catalog-info.yaml", "declared"],
      ["src/app.ts", null],
      ["locales/en.yaml", null],
    ];
    for (const [p, k] of cases) assert.equal(configKindOf(p, ""), k, p);
    assert.equal(configLangOf("web/next.config.js", ""), null, "next.config.js stays JavaScript");
    assert.equal(configLangOf("protos/users.proto", ""), "proto");
    assert.equal(configLangOf("Dockerfile", ""), "config");
  });

  it("puts compose-shop's config files in the map as config, never parsed", async () => {
    const { map, facts } = await buildFixture("compose-shop");
    const f = (p: string) => map.files.find((x) => x.path === p);
    assert.equal(f("docker-compose.yml")?.lang, "config");
    assert.equal(f("docker-compose.yml")?.configKind, "compose");
    assert.equal(f("services/users/Dockerfile")?.configKind, "dockerfile");
    assert.equal(f("services/users/Dockerfile")?.service, "svc-users");
    assert.equal(f("web/next.config.js")?.lang, "js");
    assert.equal(f("web/next.config.js")?.configKind, "gateway");
    assert.equal(facts["docker-compose.yml"], undefined);
    assert.ok(!map.nodes.some((n) => n.file === "docker-compose.yml"));
    assert.ok(!JSON.stringify(map).includes(":pw@"), "the compose password is never in the map");
  });
});

describe("Kubernetes Secret documents", () => {
  it("hides every value under data and stringData, whatever the key is called", () => {
    const src = [
      "apiVersion: v1",
      "kind: ConfigMap",
      "data:",
      "  username: plain",
      "---",
      "apiVersion: v1",
      "kind: Secret",
      "metadata:",
      "  name: db",
      "data:",
      "  username: YWRtaW4=",
      "stringData:",
      "  cert: |",
      "    -----BEGIN CERTIFICATE-----",
      "    MIIB",
      "type: Opaque",
    ].join("\n");
    const out = redactConfigText(src).split("\n");
    assert.equal(out.length, 16, "line count kept");
    assert.equal(out[3], "  username: plain", "a ConfigMap is not a Secret");
    assert.equal(out[8], "  name: db", "metadata is left alone");
    assert.equal(out[10], `  username: ${REDACTED}`);
    assert.equal(out[12], "  cert: |");
    assert.equal(out[13], `    ${REDACTED}`);
    assert.equal(out[14], `    ${REDACTED}`);
    assert.equal(out[15], "type: Opaque", "the block ends where the indent does");
  });
});
