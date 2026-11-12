// The long-tail config readers (SERVICES.md §3, §9 task 12): Kubernetes with
// kustomize and Helm, monorepo workspaces (npm, pnpm, turbo, Nx, Cargo, Go),
// wrangler, the team's own catalog files, and the group boxes they give the
// system view.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { configKindOf } from "../src/analyzer/config/files";
import { readBackstage, readCompass, readStructurizr } from "../src/analyzer/config/declared";
import { readHelm, readK8s } from "../src/analyzer/config/k8s";
import { readWorkspaces, readWrangler } from "../src/analyzer/config/workspaces";
import type { CodeMap, SourceFile } from "../src/analyzer/types";
import { layoutFor, type GroupItem, type SvcItem } from "../src/components/mapLayout";
import "./analyzer.helpers"; // loads the grammars

const f = (path: string, content: string): SourceFile => ({ path, content });
const yaml = (...lines: string[]) => lines.join("\n") + "\n";

const USERS_K8S = yaml(
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:",
  "  name: users",
  "spec:",
  "  template:",
  "    metadata:",
  "      labels:",
  "        app: users",
  "        tier: api",
  "    spec:",
  "      containers:",
  "        - name: users",
  "          image: ghcr.io/acme/users:2",
  "          command: [node, src/index.js]",
  "          ports:",
  "            - containerPort: 8080",
  "          env:",
  "            - name: DATABASE_URL",
  "              valueFrom:",
  "                configMapKeyRef:",
  "                  name: users-config",
  "                  key: db",
  "            - name: API_SECRET",
  "              valueFrom:",
  "                secretKeyRef:",
  "                  name: s",
  "                  key: k",
  "            - name: LOG_LEVEL",
  "              value: debug",
  "---",
  "apiVersion: v1",
  "kind: Service",
  "metadata:",
  "  name: users",
  "spec:",
  "  selector:",
  "    app: users",
  "  ports:",
  "    - port: 80",
  "      targetPort: 8080",
  "---",
  "apiVersion: v1",
  "kind: ConfigMap",
  "metadata:",
  "  name: users-config",
  "data:",
  "  db: postgres://app:pw@postgres:5432/shop",
);
const WEB_K8S = yaml(
  "apiVersion: apps/v1",
  "kind: Deployment",
  "metadata:",
  "  name: web",
  "spec:",
  "  template:",
  "    metadata:",
  "      labels:",
  "        app: web",
  "    spec:",
  "      containers:",
  "        - name: web",
  "          image: ghcr.io/acme/web:2",
  "          env:",
  "            - name: USERS_URL",
  "              value: http://users.shop.svc.cluster.local",
  "---",
  "apiVersion: v1",
  "kind: Service",
  "metadata:",
  "  name: web",
  "spec:",
  "  selector:",
  "    app: web",
  "  ports:",
  "    - port: 3000",
);
const KUSTOMIZATION = yaml("namespace: shop", "resources:", "  - users.yaml", "  - web.yaml");

describe("Kubernetes", () => {
  it("is YAML with apiVersion + kind; a Helm template never is", () => {
    assert.equal(configKindOf("k8s/users.yaml", USERS_K8S), "k8s");
    assert.equal(configKindOf("k8s/notes.yaml", "title: not kubernetes\n"), null);
    assert.equal(configKindOf("charts/app/templates/deploy.yaml", "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n"), "helm");
    assert.equal(configKindOf("k8s/kustomization.yaml", KUSTOMIZATION), "k8s");
  });

  it("joins a Service to the workload its selector picks, with hostnames, ports and env", () => {
    const r = readK8s([f("k8s/users.yaml", USERS_K8S)]);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.services.length, 1, "the Deployment is the Service's, not a second service");
    const s = r.services[0];
    assert.equal(s.name, "users");
    assert.equal(s.line, 33, "the `kind: Service` line");
    assert.deepEqual(s.also, [{ file: "k8s/users.yaml", line: 2 }], "and the Deployment's");
    assert.deepEqual(s.hostnames, ["users", "users.default", "users.default.svc", "users.default.svc.cluster.local"]);
    assert.deepEqual(s.ports, [{ container: 80 }, { container: 8080 }]);
    assert.equal(s.image, "ghcr.io/acme/users:2");
    assert.equal(s.kind, "placeholder", "an app image built elsewhere, until a folder claims it");
    assert.equal(s.entry, "node src/index.js");
    // configMapKeyRef followed (password redacted), secretKeyRef never read.
    assert.deepEqual(s.env.DATABASE_URL, { value: "postgres://app:•••@postgres:5432/shop", line: 48, file: "k8s/users.yaml" });
    assert.equal(s.env.LOG_LEVEL.value, "debug");
    assert.ok(!("API_SECRET" in s.env));
    assert.ok(r.envValues.some((v) => v.name === "USERS_SERVICE_HOST" && v.value === "users"));
    assert.ok(r.envValues.some((v) => v.name === "USERS_SERVICE_PORT" && v.value === "80"));
  });

  it("kustomize gives the resources it lists its namespace", () => {
    const r = readK8s([f("k8s/kustomization.yaml", KUSTOMIZATION), f("k8s/users.yaml", USERS_K8S), f("k8s/web.yaml", WEB_K8S)]);
    const users = r.services.find((s) => s.name === "users")!;
    assert.ok(users.hostnames.includes("users.shop.svc.cluster.local"));
    assert.ok(!users.hostnames.includes("users.default"));
  });

  it("reads Chart.yaml and address-like values as guesses, and skips templates", () => {
    const chart = readHelm("charts/shop/Chart.yaml", yaml("apiVersion: v2", "name: shop", "dependencies:", "  - name: postgresql", "  - name: redis"));
    assert.deepEqual(
      chart.declared.map((d) => [d.name, d.kind, d.dependsOn, d.line]),
      [["shop", "helm chart", ["postgresql", "redis"], 2]],
    );
    const values = readHelm("charts/shop/values.yaml", yaml("web:", "  usersUrl: http://users:8080", "  replicas: 2", "apiKey: sk_live_abcdefghijklmnop"));
    assert.deepEqual(values.envValues, [{ name: "WEB_USERS_URL", value: "http://users:8080", file: "charts/shop/values.yaml", line: 2, likely: "from a Helm values file" }]);
    const tpl = readHelm("charts/shop/templates/deploy.yaml", "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n");
    assert.deepEqual([tpl.declared, tpl.envValues, tpl.warnings], [[], [], []]);
  });
});

describe("Kubernetes in a map", () => {
  let map: CodeMap;
  before(async () => {
    const sources = [
      f("k8s/kustomization.yaml", KUSTOMIZATION),
      f("k8s/users.yaml", USERS_K8S),
      f("k8s/web.yaml", WEB_K8S),
      f("charts/shop/templates/deploy.yaml", "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n"),
      f("web/package.json", `{\n  "name": "web",\n  "dependencies": { "next": "16.0.0", "react": "19.0.0" }\n}\n`),
      f("web/lib/api.ts", "export async function getUser(id: string) {\n  return fetch(`${process.env.USERS_URL}/users/${id}`);\n}\n"),
      f("users/package.json", `{\n  "name": "users",\n  "dependencies": { "express": "4.0.0" }\n}\n`),
      f("users/src/index.js", 'const express = require("express");\nconst app = express();\napp.get("/users/:id", (req, res) => res.json({}));\napp.listen(8080);\n'),
    ];
    map = (await buildMap(sources, { name: "shop" })).map;
  });

  it("finds both apps, binding each image to the folder of that name", () => {
    assert.equal(map.system.kind, "services");
    const users = map.services.find((s) => s.id === "svc-users")!;
    assert.equal(users.kind, "app");
    assert.deepEqual(users.areas, ["users"]);
    assert.ok(users.hostnames.includes("users.shop.svc.cluster.local"));
    assert.ok(users.evidence.some((e) => e.file === "k8s/users.yaml" && e.line === 33));
    assert.equal(map.files.find((x) => x.path === "charts/shop/templates/deploy.yaml")?.configKind, "helm");
  });

  it("resolves the cluster DNS name in a Deployment's env to the users service", () => {
    const e = map.edges.find((x) => x.id === "calls-route:file:web/lib/api.ts->route:users/src/index.js#GET /users/:id");
    assert.ok(e, "web → users GET /users/:id");
    assert.ok(e.evidence.some((x) => x.file === "k8s/web.yaml" && x.role === "config"));
    assert.ok(!map.nodes.some((n) => n.kind === "service" && !n.internal && /cluster\.local/.test(n.name)), "never an outside company");
  });
});

describe("workspaces", () => {
  it("npm workspaces: packages, the apps/* vs packages/* hint, and sibling deps", () => {
    const { workspaces } = readWorkspaces([
      f("package.json", `{ "name": "root", "private": true, "workspaces": ["apps/*", "packages/*", "!packages/old"] }`),
      f("apps/web/package.json", `{\n  "name": "@acme/web",\n  "dependencies": { "@acme/ui": "workspace:*", "next": "16" }\n}`),
      f("packages/ui/package.json", `{ "name": "@acme/ui" }`),
      f("packages/old/package.json", `{ "name": "@acme/old" }`),
    ]);
    assert.deepEqual(
      workspaces.map((w) => [w.dir, w.name, w.isApp]),
      [
        ["apps/web", "@acme/web", true],
        ["packages/ui", "@acme/ui", false],
      ],
    );
    assert.deepEqual(workspaces[0].deps, ["@acme/ui", "next"]);
    assert.equal(workspaces[0].line, 2);
  });

  it("pnpm-workspace.yaml (pnpm ignores the package.json field)", () => {
    const { workspaces } = readWorkspaces([f("pnpm-workspace.yaml", "packages:\n  - 'services/**'\n"), f("services/billing/api/package.json", `{ "name": "billing-api" }`)]);
    assert.deepEqual(
      workspaces.map((w) => [w.dir, w.name]),
      [["services/billing/api", "billing-api"]],
    );
  });

  it("Nx: project.json and the nx key say app or library outright", () => {
    const { workspaces } = readWorkspaces([
      f("apps/admin/project.json", `{ "name": "admin", "projectType": "application", "implicitDependencies": ["shared", "!legacy"] }`),
      f("libs/shared/project.json", `{ "name": "shared", "projectType": "library" }`),
      f("package.json", `{ "workspaces": ["tools/*"] }`),
      f("tools/cli/package.json", `{ "name": "cli", "nx": { "tags": ["type:app"] } }`),
    ]);
    const by = Object.fromEntries(workspaces.map((w) => [w.dir, w]));
    assert.equal(by["apps/admin"].isApp, true);
    assert.deepEqual(by["apps/admin"].deps, ["shared"]);
    assert.equal(by["libs/shared"].isApp, false);
    assert.equal(by["tools/cli"].isApp, true);
    assert.equal(configKindOf("turbo.json", "{}"), "workspace", "turbo.json and nx.json only say 'monorepo'; they are kept as config");
    assert.equal(configKindOf("nx.json", "{}"), "workspace");
  });

  it("Cargo [workspace] members and Go modules", () => {
    const cargo = readWorkspaces([
      f("Cargo.toml", '[workspace]\nmembers = [\n  "crates/*",\n  "services/api",\n]\n'),
      f("crates/core/Cargo.toml", '[package]\nname = "core"\n'),
      f("services/api/Cargo.toml", '[package]\nname = "api"\n\n[dependencies]\ncore = { path = "../../crates/core" }\nserde = "1"\n'),
    ]).workspaces;
    assert.deepEqual(
      cargo.map((w) => [w.dir, w.name, w.isApp, w.deps]),
      [
        ["crates/core", "core", false, []],
        ["services/api", "api", true, ["core", "serde"]],
      ],
    );
    const go = readWorkspaces([
      f("go.work", "go 1.22\n\nuse (\n  ./svc/users\n  ./lib/db\n)\n"),
      f("svc/users/go.mod", "module example.com/users\n\nrequire example.com/db v0.0.0\n"),
      f("lib/db/go.mod", "module example.com/db\n"),
      f("tools/go.mod", "module example.com/tools\n"),
    ]).workspaces;
    assert.deepEqual(
      go.map((w) => [w.dir, w.name, w.deps]).sort(),
      [
        ["lib/db", "example.com/db", []],
        ["svc/users", "example.com/users", ["example.com/db"]],
      ],
    );
    // Without go.work, two or more go.mod files are the workspace.
    assert.equal(readWorkspaces([f("a/go.mod", "module x/a\n"), f("b/go.mod", "module x/b\n")]).workspaces.length, 2);
    assert.equal(readWorkspaces([f("go.mod", "module x\n")]).workspaces.length, 0);
  });

  it("a monorepo of two apps and a shared package is a system of services; the package belongs to its importer", async () => {
    const { map } = await buildMap(
      [
        f("package.json", `{ "name": "root", "private": true, "workspaces": ["apps/*", "packages/*"] }`),
        f("turbo.json", "{}"),
        f("apps/web/package.json", `{\n  "name": "web",\n  "dependencies": { "@acme/ui": "*", "next": "16", "react": "19" }\n}`),
        f("apps/web/app/page.tsx", 'import { Button } from "@acme/ui";\nexport default function Page() {\n  return <Button />;\n}\n'),
        f("apps/api/package.json", `{\n  "name": "api",\n  "dependencies": { "express": "4" }\n}`),
        f("apps/api/src/index.js", 'const express = require("express");\nconst app = express();\napp.get("/health", (req, res) => res.json({}));\napp.listen(4000);\n'),
        f("packages/ui/package.json", `{ "name": "@acme/ui" }`),
        f("packages/ui/src/index.tsx", "export function Button() {\n  return <button>ok</button>;\n}\n"),
      ],
      { name: "acme" },
    );
    assert.equal(map.system.kind, "services");
    assert.deepEqual(map.services.filter((s) => s.kind === "app").map((s) => s.id).sort(), ["svc-api", "svc-web"]);
    assert.ok(map.files.some((x) => x.path === "turbo.json" && x.configKind === "workspace"));
    const button = map.nodes.find((n) => n.file === "packages/ui/src/index.tsx");
    assert.equal(button?.service, "svc-web", "the shared package goes to the app that depends on it");
  });
});

describe("wrangler", () => {
  it("a Worker is a service; [vars] are its settings; [[services]] bindings name other Workers", () => {
    const w = readWrangler(
      "workers/web/wrangler.toml",
      ['name = "web"', 'main = "src/index.ts"', "", "[vars]", 'USERS_URL = "https://users.example.workers.dev"', 'API_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"', "", "[[services]]", 'binding = "USERS"', 'service = "users"', ""].join("\n"),
    );
    assert.equal(w.service?.name, "web");
    assert.equal(w.service?.dir, "workers/web");
    assert.equal(w.service?.line, 1);
    assert.equal(w.service?.entry, "wrangler: src/index.ts");
    assert.equal(w.service?.env.API_TOKEN.value, "•••");
    assert.deepEqual(w.bindings, [{ binding: "USERS", service: "users", file: "workers/web/wrangler.toml", line: 9, scope: "web" }]);
  });

  it("env.USERS.fetch() reaches the Worker the binding names, certain, citing the binding", async () => {
    const { map } = await buildMap(
      [
        f("web/wrangler.toml", 'name = "web"\nmain = "src/index.ts"\n\n[[services]]\nbinding = "USERS"\nservice = "users"\n'),
        f("web/package.json", `{ "name": "web" }`),
        f("web/src/index.ts", 'export default {\n  async fetch(req: Request, env: any) {\n    return env.USERS.fetch("https://users/users/1");\n  },\n};\n'),
        f("users/wrangler.toml", 'name = "users"\nmain = "src/index.ts"\n'),
        f("users/package.json", `{ "name": "users", "dependencies": { "hono": "4" } }`),
        f("users/src/index.ts", 'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/users/:id", (c) => c.json({}));\nexport default app;\n'),
      ],
      { name: "workers" },
    );
    assert.equal(map.system.kind, "services");
    const e = map.edges.find((x) => x.kind === "calls-route" && x.to === "route:users/src/index.ts#GET /users/:id");
    assert.ok(e, "web → users GET /users/:id");
    assert.equal(e.confidence, "certain");
    assert.ok(e.evidence.some((x) => x.file === "web/wrangler.toml" && x.line === 5 && x.role === "config"));
  });
});

describe("what the team wrote down", () => {
  it("Backstage: components, their system, dependsOn and APIs", () => {
    const { declared } = readBackstage(
      "catalog-info.yaml",
      yaml(
        "apiVersion: backstage.io/v1alpha1",
        "kind: Component",
        "metadata:",
        "  name: users",
        "spec:",
        "  type: service",
        "  system: shop",
        "  dependsOn: [resource:default/users-db]",
        "  providesApis: [users-api]",
        "---",
        "apiVersion: backstage.io/v1alpha1",
        "kind: Component",
        "metadata:",
        "  name: web",
        "spec:",
        "  type: website",
        "  system: system:default/shop",
        "  consumesApis: [users-api]",
      ),
    );
    assert.deepEqual(
      declared.map((d) => [d.name, d.kind, d.system, d.dependsOn, d.provides, d.consumes, d.line]),
      [
        ["users", "component:service", "shop", ["users-db"], ["users-api"], [], 4],
        ["web", "component:website", "shop", [], [], ["users-api"], 14],
      ],
    );
  });

  it("Compass and Structurizr", () => {
    assert.deepEqual(
      readCompass("compass.yml", yaml("name: billing", "typeId: SERVICE")).declared.map((d) => [d.name, d.kind]),
      [["billing", "compass:service"]],
    );
    const s = readStructurizr(
      "workspace.dsl",
      ["workspace {", "  model {", '    shop = softwareSystem "Shop" {', '      web = container "web"', '      users = container "users"', "    }", '    mail = softwareSystem "Mailer"', "    web -> users", "  }", "}"].join("\n"),
    ).declared;
    assert.deepEqual(
      s.map((d) => [d.name, d.kind, d.system, d.dependsOn]),
      [
        ["web", "structurizr:container", "Shop", ["users"]],
        ["users", "structurizr:container", "Shop", []],
        ["Mailer", "structurizr:system", undefined, []],
      ],
    );
  });

  describe("on the system view", () => {
    let map: CodeMap;
    before(async () => {
      const compose = yaml("services:", "  web:", "    build: ./web", "  users:", "    build: ./users", "  orders:", "    build: ./orders");
      const catalog = yaml(
        "apiVersion: backstage.io/v1alpha1",
        "kind: Component",
        "metadata:",
        "  name: users",
        "spec:",
        "  type: service",
        "  system: accounts",
        "  dependsOn: [component:ledger]",
        "---",
        "apiVersion: backstage.io/v1alpha1",
        "kind: Component",
        "metadata:",
        "  name: orders",
        "spec:",
        "  type: service",
        "  system: accounts",
        "---",
        "apiVersion: backstage.io/v1alpha1",
        "kind: Component",
        "metadata:",
        "  name: ledger",
        "spec:",
        "  type: service",
      );
      const express = (path: string) => `const express = require("express");\nconst app = express();\napp.get("${path}", (req, res) => res.json({}));\napp.listen(8080);\n`;
      map = (
        await buildMap(
          [
            f("docker-compose.yml", compose),
            f("catalog-info.yaml", catalog),
            f("web/package.json", `{ "name": "web", "dependencies": { "express": "4" } }`),
            f("web/index.js", express("/")),
            f("users/package.json", `{ "name": "users", "dependencies": { "express": "4" } }`),
            f("users/index.js", express("/users")),
            f("orders/package.json", `{ "name": "orders", "dependencies": { "express": "4" } }`),
            f("orders/index.js", express("/orders")),
          ],
          { name: "shop" },
        )
      ).map;
    });

    it("gives matching services their group, and a declared-only card for a name nothing else shows", () => {
      const by = Object.fromEntries(map.services.map((s) => [s.id, s]));
      assert.equal(by["svc-users"].group, "accounts");
      assert.equal(by["svc-orders"].group, "accounts");
      assert.equal(by["svc-web"].group, undefined);
      const ledger = by["svc-ledger"];
      assert.ok(ledger);
      assert.equal(ledger.declared, true);
      assert.equal(ledger.confidence, "likely");
      assert.deepEqual(
        ledger.evidence.map((e) => [e.file, e.line, e.role]),
        [["catalog-info.yaml", 21, "config"]],
      );
    });

    it("draws a declared dependency as depends-on, a guess with the file:line, never a call", () => {
      const l = map.system.links.find((x) => x.id === "depends-on:svc-users->svc-ledger");
      assert.ok(l);
      assert.equal(l.confidence, "likely");
      assert.match(l.note ?? "", /the team wrote this in catalog-info\.yaml:4; I did not see it in code/);
      assert.deepEqual(l.edgeIds, []);
      assert.ok(!map.edges.some((e) => e.to.includes("ledger")), "nothing in level 2");
    });

    it("puts one labelled box behind the cards of a group, and none without groups", () => {
      const { nodes } = layoutFor(map, { kind: "system" });
      const boxes = nodes.filter((n): n is GroupItem => n.type === "group");
      assert.ok(boxes.length >= 1);
      assert.ok(boxes.every((b) => b.title === "accounts"));
      const cards = new Map(nodes.filter((n): n is SvcItem => n.type === "svc").map((n) => [n.id, n]));
      for (const id of ["svc-users", "svc-orders"]) {
        const c = cards.get(id)!;
        assert.ok(
          boxes.some((b) => c.x >= b.x && c.y >= b.y && c.x + 240 <= b.x + b.w && c.y + 104 <= b.y + b.h),
          `${id} sits inside an accounts box`,
        );
      }
      const web = cards.get("svc-web")!;
      assert.ok(!boxes.some((b) => web.x >= b.x && web.x < b.x + b.w && web.y >= b.y && web.y < b.y + b.h), "web is outside every box");
      // Boxes come first so they are drawn behind the cards.
      const firstCard = nodes.findIndex((n) => n.type === "svc");
      assert.ok(nodes.findIndex((n) => n.type === "group") < firstCard);
      const plain: CodeMap = { ...map, services: map.services.map((s) => ({ ...s, group: undefined })) };
      assert.equal(layoutFor(plain, { kind: "system" }).nodes.filter((n) => n.type === "group").length, 0);
    });
  });
});
