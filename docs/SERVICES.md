# WalkMyCode — services, the system view and workspaces

The spec itself is **Part B** below (§0–§12). Part A is the judgement that chose it; the research notes at the end are what it was checked against.

## Status (30 Sep 2026, branch `services`)

All fourteen tasks of §9 are built, and `npm run typecheck` and `npm test` are green.

| Tasks | What landed | Tests |
|---|---|---|
| 1–2 | CodeMap v2 (`types.ts`, `migrate.ts`), the workspace store with the `useRepo` wrapper, the extractor fixes (`urlText`, `varName`, `consts`, named Express handlers, the file-node rule) | `monolith.test.ts`, `resolve.test.ts` |
| 3–4 | Config readers (compose, Dockerfile, `.env.example`, redaction), `services.ts` boundaries, the monolith rule, flow order | `configfiles.test.ts`, `services.test.ts` |
| 5–7 | Resolution by host, env setting and constant; placeholders (`svc-int:`); gateways (next rewrites, Vite/CRA/Angular proxies, nginx, Ingress, HTTPRoute); tables per database and the derived service links | `crossservice.test.ts`, `gateway.test.ts`, `tables.test.ts`, `ireliabee.test.ts` |
| 8–9 | `MapView` views `all` / `system` / `service`, portals, breadcrumb, `EvidenceList`, palette, trace across services, `ResizeObserver` | `layout.test.ts` |
| 10–12 | Workspaces of several repos (browser and CLI), cross-repo binding, channels and gRPC, OpenAPI/AsyncAPI, Kubernetes/Helm/kustomize, npm/pnpm/Nx/Cargo/Go workspaces, wrangler, catalogue files | `workspace.test.ts`, `channels.test.ts`, `longtail.test.ts` |
| 13 | The AI's map summary: one app reads exactly as before, a monorepo adds a `Packages:` line, a system of services gets the §8 picture (services in flow order, gateways, links with their code and config lines, each service's lanes). The guide's rules ask it to name the service it is in. `query_map` answers a service name or id and `"system"`; `list_files` lists the repos at the root; link descriptions name the far end's service and the rewrite or config line behind them | `ai.test.ts` |
| 14 | These docs; `.walkmycode/ireliabee` re-indexed (below) | — |

A large real system (three services) is re-indexed privately as a regression check; its figures are not part of the public repository.

**Where the build differs from the text below**, with the reason:

- *`fetch("/health")` from web* (§10): the spec expected one edge "through the rewrite", but the fixture's only rewrite is `/api/:path*`, which does not cover `/health`. The call falls to the search by path and draws two dashed guesses, one per service, with the note "More than one service has this path…" (`tests/crossservice.test.ts`).
- *The removal test* (§10): without `docker-compose.yml`, `users:8080` is bound to the `services/users` folder by its name, as a guess, rather than becoming a placeholder. `PAYMENTS_URL` has no value and no route answers `billing.py`'s request, so since §13 was built that request goes, dashed, to a stand-in for wherever `PAYMENTS_URL` points, and the summary prints "1 service I can't see the code for" as §10 expected. The summary prints that line exactly when the map has a placeholder (`tests/ai.test.ts`).
- *The 20-question provider run* (§9 task 13, §10 manual checks) has not been done: it needs a real API key. Instead `tests/ai.test.ts` checks the text the model is given — the summary and the `query_map`/`list_files` output on compose-shop cite `docker-compose.yml` lines, and every `path:line` in them is a real line of a real file.
- *Flow order on compose-shop* (§10): the spec lists `web, users, orders`, but its own rule (§4 step 7, callers first) puts orders before users, because orders calls users and publishes to the topic users consumes. The build follows the rule: `web, orders, users`, then postgres, kafka, payments (`tests/layout.test.ts`, `tests/ai.test.ts`).
- *Test files* (§10): the config readers are tested in `configfiles.test.ts`, because `tests/config.test.ts` is the provider settings file. `layoutFor` lives in `src/components/mapLayout.ts` (pure, no React) and `MapView` imports it, so the layout tests need no DOM.
- *Hand-checked set* (§10): there is no `tests/fixtures/expected-edges.json`. The compose-shop edges are asserted one by one (id, confidence, evidence files) across `crossservice.test.ts`, `resolve.test.ts`, `tables.test.ts` and `channels.test.ts`, and `monolith.test.ts` checks every v1 id of both fixtures (`monolith.v1.json`, `compose-shop.v1.json`).
- *Large real-system regression* (§10): run privately against a checkout; not part of the public repository.
- *Summary header*: "3 services (docker-compose.yml)" names the file that first proves each app's boundary, so a system proven by several kinds of file lists each (iReliabee: `frontend/package.json, website/docker-compose.yml`).

# Part A — Adversarial judgement of the two designs

Scoring: (a) honesty of arrows across services, (b) monolith / monorepo / multi-repo without special modes, (c) beginner legibility, (d) disruption to the current analyzer/map, (e) implementation cost (10 = cheap).

| | Design 1 — "System level + drill-in" (SystemView.tsx) | Design 2 — "Service bands" (one map, bands outside lanes) |
|---|---|---|
| (a) honesty | **9** — call resolution order is explicit, every cross-service edge carries the code line *and* the config line, global fallback is always `likely`, bare hosts become placeholders not SaaS, shared DB needs a proven connection string. Weak spot: the placeholder edge is a `calls-route` to a `svc:` node (kind mismatch: calls-route must end on a route). | **9** — same core rules, plus `Evidence.role: "config"`, per-service table scoping by default (no arrow without proof), and hand-checked `expected-edges.json`. Weak spot: rule 3c ("only one service has routes → likely") is a guess by elimination and its note must say so. |
| (b) no special modes | **8** — `system.kind` monolith/monorepo/services is derived, not chosen; table ids stay `table:<name>` for monoliths so every existing map, tour node id and `.walkmycode/*.map.json` survives. Weak spot: table ids flip when a repo gains a compose file (documented, acceptable). | **6** — `shape` is derived too, but **table ids change for every map** (`table:svc-int:<name>/x`), forcing `migrate.ts` and silently breaking tour `node_ids` stored in Claude chat history and any persisted map. Also a monolith gets *two* bands (app + Shared for outside SaaS) by its own rule 3, contradicting "positions identical to v1". |
| (c) legibility | **7** — clear C4 levels, breadcrumb, portals with "← called by orders" badges, hash-persisted level. Weak spot: two React Flow components with independent layouts; switching levels is a context switch and MOTION choreography must exist twice. | **8** — one mental model: the left-to-right lane story stays inside a band, only the service hop goes up/down; portals in the Routes lane; system view = collapsed bands so positions persist; flow-ordered bands. Weak spot: N bands × 40-row lanes is a very tall canvas, `colsPerLane = max over bands` wastes width, and every table/outside edge crosses down to the Shared band (corridor spaghetti). |
| (d) disruption | **8** — additive types, global search kept as last resort, `useRepo` compatibility wrapper, no MapView layout rewrite. | **5** — MapView layout rewritten into React Flow parent/band nodes, forced id migration in store/demo/CLI, Outside lane moves from the right to a bottom band. |
| (e) cost | **5** — 14 tasks, ~10 new files, two views. | **5** — 14 tasks, band layout + crossing edge + migration on top of the same analyzer work. |
| **Total** | **37** | **33** |

**Fatal flaws**
- D2: universal table-id rewrite. WalkMyCode's promise is stable node ids that the AI cites and tours replay; changing `table:user` to `table:svc-int:lantern/user` for a one-package Next app buys nothing and breaks saved tours. Rejected.
- D2: monolith produces an app band + Shared band, so the "unchanged for one app" guarantee is false as written.
- D1: none fatal. Two defects to fix: placeholder edges must be `uses-service` (the request is real) not `calls-route`; "library nodes belong to the app service that imports it most" is non-deterministic across builds — use a stable tie-break.

**Best ideas grafted into the final spec**
- From D2: `Evidence.role: "config"`; `hostPortToService` (`localhost:<H>` → publisher of that host port, likely); "own routes first" and "only one service has routes" steps; module-level `consts` one-hop lookup (`const BASE = process.env.X ?? "…"`); `usedBy` on tables for the "shared by" badge; flow-ordered services; trace "service hop resets the layer clock"; `expected-edges.json` hand-checked set; portals rendered in the Routes lane; `internal: true` wording that never says "another company".
- From D1: monolith table ids unchanged, `system.kind` rule, `ServiceDef.env` table with file:line, `ServiceLink` derived with `edgeIds`, resolution order, placeholder as a service kind, `declared` flag, `Workspace` with persisted `FileSystemDirectoryHandle`, per-repo file cap, CLI multi-dir, shared `EvidenceList`, hash-persisted level, `Ctrl+K` palette, `ResizeObserver` refit.
- Decision on the view: **one `MapView` component, three views** (`all` = today's picture; `system`; `service`) so SHELL keeps one React element and MOTION's choreography is written once. No bands: the drill-in filters the existing lanes and adds portals. The system view is a second layout function in the same component, not a second component.

---

# Part B — FINAL spec: `docs/SERVICES.md`

# WalkMyCode — services, the system view and workspaces

Covers owner requirement (1): "some codebases are monolithic and others are microservice so the code should cater for all of that." Requirements (2) docking/resizing and (3) registration are `docs/SHELL.md` and `docs/ACCOUNTS.md`; §12 lists the touchpoints.

## 0. Decisions

1. **A workspace holds 1..n repos; one map is built from all of them.** With one repo nothing changes. With several, every path is prefixed `<label>/` before the analyzer sees it, so node ids, `Evidence.file`, `repo.files`, `nodeAt`, `read_file`, `search`, `list_files` and citations keep working unchanged.
2. **A service is a deployable unit, proven by config first and code second.** Compose `services:`, Kubernetes `Service`+workload, Dockerfiles, wrangler and workspace `apps/*` define services. Areas (nearest manifest dir, today's notion) stay as they are and become the folder a service is bound to. A shared library area is never a service.
3. **The monolith rule.** Zero or one app-kind service → `system.kind = "monolith"`: no system view, no breadcrumb root, no "Services" section for the AI, table ids unchanged (`table:<name>`). A beginner never sees a one-box diagram. `"monorepo"` = one app + library packages (badges only). `"services"` = ≥2 app-kind services.
4. **The evidence rule is unchanged.** A service→service arrow exists only because ≥1 node→node edge exists; that edge cites the code line and, when config resolved it, the config line (`role: "config"`). Guesses are dashed with a reason. Declared links (compose `depends_on`, Backstage) are drawn thin grey with the note "declared, not seen in code" and never as calls.
5. **Resolution order for an HTTP call**: known third-party host → what the user told WalkMyCode about a public address (§13) → literal internal host (a name config gives a service, and a public address that service's own deploy config gives it, §13) → env var value from config → what the user told WalkMyCode about the setting (§13) → env var name heuristic → the caller's own routes → gateway/rewrite table → "only one service has routes" → today's global search (always `likely` in a multi-service map) → placeholder (bare host) / outside service (dotted host) / "matched no route". A request whose address is a public host is resolved through that host whichever way its URL is built (in the URL, a setting, a constant, a function, a helper, a rewrite), once the user or deploy config says whose the host is.
6. **CodeMap `version: 2`**, additive for monoliths. `upgradeMap()` fills the new fields on a v1 map without touching ids. Multi-service maps scope table ids by database; old maps of such repos are re-indexed (store shows a one-line prompt).
7. **One new dependency: `yaml`** (eemeli/yaml, ESM, browser-safe). Dockerfile, nginx, `.proto`, `.env.example`, TOML are line/regex parsed; `next.config.*` / `vite.config.*` use the existing tree-sitter JS parser. Config files are never tree-sitter parsed and never leave the browser.
8. **One `MapView`, three views**: `all` (today's lanes, used for monolith/monorepo and as an opt-in "show everything"), `system` (one card per service), `service` (today's lanes filtered to one service, plus portals). Same React element across views, refit on container resize.

## 1. Vocabulary

| Word | Meaning | Where |
|---|---|---|
| Workspace | What is open: 1..n repos, one map | `store.ts` `Workspace` |
| Repo | One folder / GitHub repo in the workspace | `Workspace.repos[]`, `CodeMap.repos[]` |
| Area | A package = nearest manifest dir (unchanged) | `MapNode.area`, `CodeMap.areas` |
| Service | A deployable unit (app, db, cache, broker, gateway), or a placeholder for one we can't see | `CodeMap.services[]`, `MapNode.service` |
| System view | Level 1: one card per service, arrows between them | `MapView` view `system` |
| Portal | A stub card inside a service's lanes standing for another service's route/channel/table | derived in `MapView`, never stored |
| Channel | A queue/topic/subject/job-queue name that joins a producer and a consumer | `MapNode.kind === "channel"` |

Levels: **1 — the system** (services); **2 — inside one service** (five lanes); **3 — code** (Code panel / Code room). Outside services and people sit on the system view's right and left edges (C4 context folded into level 1).

## 2. Data model (`src/analyzer/types.ts`, `src/analyzer/facts.ts`)

```ts
// types.ts — v2. Lines marked NEW are additive; v1 fields are untouched.
export type Layer = "ui" | "api" | "logic" | "data" | "external";
export type Lang = "ts" | "tsx" | "js" | "jsx" | "py" | "sql" | "prisma"
  | "config"   // NEW: yaml/json/toml/Dockerfile/nginx/.env.example — kept in files[] and repo.files, parsed by analyzer/config, never by tree-sitter
  | "proto";   // NEW
export type Confidence = "certain" | "likely";

export type EdgeKind =
  | "imports" | "calls" | "calls-route" | "reads" | "writes" | "defines" | "uses-service"
  | "calls-rpc"   // NEW code calls a gRPC method another service implements
  | "publishes"   // NEW code sends to a channel
  | "consumes"    // NEW code receives from a channel
  | "proxies"     // NEW system view only: a gateway service forwards a prefix to a service
  | "depends-on"; // NEW system view only: compose/k8s startup dependency (declared, thin grey)

export interface Evidence {
  file: string; line: number; text: string;
  trigger?: { element: string; label?: string; line: number };
  role?: "code" | "config";   // NEW: "config" when the line is in compose/k8s/next.config/nginx/.env.example
}

export interface MapNode {
  id: string; layer: Layer;
  kind: "component" | "module" | "route" | "table" | "service" | "channel" | "rpc"; // NEW kinds channel, rpc
  name: string; area: string;
  file?: string; line?: number; endLine?: number;
  method?: string; path?: string; handler?: string;
  service?: string;   // NEW owning ServiceDef.id; absent on third-party `service` nodes and on channels owned by no broker
  internal?: boolean; // NEW kind "service": true = placeholder for one of this system's own services whose code is not here
  db?: string;        // NEW kind "table": database identity (ServiceDef.id of a db service, or `own:<serviceId>`)
  usedBy?: string[];  // NEW kind "table": service ids that read/write it (for the "shared by" badge)
  tech?: string;      // NEW kind "channel"|"rpc": "kafka topic", "bullmq queue", "gRPC service"
  note?: string;      // NEW beginner wording attached at build time, e.g. "described in openapi.yaml; I did not find the code"
}

export interface MapEdge {
  id: string; from: string; to: string; kind: EdgeKind; confidence: Confidence;
  evidence: Evidence[]; note?: string; fromFns?: string[]; toFns?: string[];
}

export interface ServiceDef {                       // NEW
  id: string;                    // "svc-users" — slug of name, stable across re-index
  name: string;                  // "users"
  kind: "app" | "db" | "cache" | "broker" | "gateway" | "placeholder";
  repo?: string;                 // repo label when the workspace has >1 repo
  areas: string[];               // areas whose code runs in this service (app kind); [] for infra/placeholder
  hostnames: string[];           // "users", "users:8080", "users.default.svc.cluster.local"; dev aliases "localhost:8000" are in devHosts
  devHosts: string[];            // published host ports: "localhost:8000", "127.0.0.1:8000" (matches are likely)
  ports: { container?: number; host?: number }[];
  image?: string;                // compose/k8s image when not built here
  entry?: Evidence;              // "start here": CMD/ENTRYPOINT, package.json start, uvicorn.run, app.listen
  framework?: string;            // "Next.js" | "Express" | "FastAPI" | ... (label only)
  env: Record<string, { value: string; file: string; line: number }>;  // config table, secrets redacted to "•••"
  dependsOn: string[];           // ServiceDef.ids from compose/k8s depends_on
  evidence: Evidence[];          // the lines that prove the boundary
  confidence: Confidence;        // likely when the boundary comes from a folder-name convention only
  declared?: boolean;            // only from catalog-info.yaml / Chart.yaml (label, not observation)
  group?: string;                // Backstage/Compass `system` name for grouping on the system view
  counts: { ui: number; api: number; logic: number; data: number };
}

export interface GatewayRule {                      // NEW
  source: string[];              // segments, "*" = one segment, "**" = rest
  toService?: string; toHost?: string; strip: number; // segments removed from the front before matching
  prependPath: string[];         // destination path prefix, e.g. ["v1"]
  kind: "next-rewrite" | "vite-proxy" | "cra-proxy" | "nginx" | "ingress" | "httproute";
  ownerService?: string;         // the service whose config declares it (own rules are tried first)
  evidence: Evidence; confidence: Confidence;
}

export interface ServiceLink {                      // NEW: derived by build.ts from node edges
  id: string;                    // `${kind}:${from}->${to}` (+ `@${via}` when via is set)
  from: string; to: string;      // ServiceDef.id
  kind: EdgeKind;                // calls-route | calls-rpc | publishes | consumes | proxies | depends-on | reads | writes
  confidence: Confidence; note?: string;
  via?: string;                  // channel or table node id when the link goes through one
  edgeIds: string[];             // node edges that prove it (each has file:line evidence)
  count: number;
}

export interface FileEntry {
  path: string; lang: Lang; lines: number; area: string; skipped?: string;
  fns?: Record<string, [number, number, string[]]>;
  service?: string;              // NEW
  configKind?: "compose" | "k8s" | "helm" | "dockerfile" | "envfile" | "gateway" | "openapi" | "asyncapi" | "proto" | "workspace" | "declared" | "wrangler"; // NEW
}

export interface CodeMap {
  version: 2;
  name: string; generatedAt: string;
  repos: { label: string; prefix: string; kind: "local" | "demo" | "cli" | "github" }[]; // NEW: prefix "" for one repo
  system: { kind: "monolith" | "monorepo" | "services"; links: ServiceLink[] };            // NEW
  services: ServiceDef[];        // NEW: app services in flow order, then db/cache/broker/gateway, then placeholders
  gateways: GatewayRule[];       // NEW
  areas: string[]; files: FileEntry[]; nodes: MapNode[]; edges: MapEdge[]; warnings: string[];
  stats: { files: number; parsed: number; routes: number; tables: number; edges: number; likely: number; ms: number;
           services: number; links: number; crossService: number };                        // NEW last three
}

export interface SourceFile { path: string; content: string; }
```

Node ids. Unchanged: `file:<path>`, `route:<file>#<METHOD> <path>` (per-file, so identical paths in two services never collide), `svc:<slug>` (outside). New: `svc-int:<ServiceDef.id>` (placeholder or portal target of an internal service), `chan:<tech>/<name>`, `rpc:<proto file>#<Service>`. Tables: `table:<name>` when `system.kind !== "services"`; else `table:<db>/<name>` where `db` is the db ServiceDef.id (`svc-postgres`) or `own:<serviceId>` when unresolved. Two same-named tables in different dbs are two nodes, each with `note: "The orders service also has a users table; I can't tell if it's the same database."` and no arrow between them.

```ts
// facts.ts — additive
export interface HttpCallFact {
  url: string; method?: Method; line: number; callee: string; fromVariable: boolean;
  varName?: string;     // NEW "USERS_URL" when the URL starts with an env read, or a module constant bound to one
  literalBase?: string; // NEW "http://users:8080" when it starts with a module constant bound to a literal
}
export interface ChannelFact { channel: string; op: "publish" | "consume"; tech: "kafka" | "rabbitmq" | "sqs" | "sns" | "nats" | "redis" | "bullmq" | "celery"; line: number; literal: boolean; }
export interface RpcFact { service: string; role: "implements" | "calls"; host?: string; line: number; }
export interface EnvReadFact { name: string; line: number; }
export interface FileFacts {
  /* existing */
  channels: ChannelFact[]; rpc: RpcFact[]; envReads: EnvReadFact[];
  consts: Record<string, { envVar?: string; literal?: string; line: number }>; // module-level `const BASE = process.env.X ?? "http://…"`, `BASE = os.getenv("X", "…")`
}
```

```ts
// src/analyzer/config/types.ts — produced only from config files
export interface ConfigFacts {
  services: { name: string; kind: ServiceDef["kind"]; dir?: string; image?: string; hostnames: string[]; ports: { host?: number; container: number }[];
              env: Record<string, { value: string; line: number }>; envFiles: string[]; dependsOn: string[]; entry?: string; file: string; line: number; source: "compose" | "k8s" | "dockerfile" | "wrangler" | "workspace" | "folder" }[];
  envValues: { name: string; value: string; file: string; line: number; scope?: string }[];   // scope = compose service name / k8s workload
  gateways: GatewayRule[];
  routes: { method: Method; path: string; operationId?: string; serverUrl?: string; file: string; line: number }[]; // OpenAPI
  channels: { name: string; op: "publish" | "consume"; file: string; line: number }[];                                // AsyncAPI
  rpcServices: { name: string; methods: string[]; file: string; line: number }[];                                      // .proto
  workspaces: { dir: string; name?: string; isApp?: boolean; deps: string[]; file: string; line: number }[];
  declared: { name: string; kind: string; system?: string; dependsOn: string[]; provides: string[]; consumes: string[]; file: string; line: number }[];
}
```

`upgradeMap(any): CodeMap` (`src/analyzer/migrate.ts`): v1 → v2 sets `repos: [{label: name, prefix: "", kind}]`, `system: {kind: "monolith", links: []}`, one `ServiceDef {id: "svc-"+slug(name), kind: "app", areas: map.areas, confidence: "likely"}`, `service` on every non-external node, `gateways: []`, stats defaults. **Ids are never rewritten.** Called in `store.restoreRepo`, `api/demo/route.ts` and `scripts/index.ts`.

## 3. Detection heuristics (source → evidence → confidence)

Both readers (`src/lib/localFolder.ts:6` `KEEP`, `scripts/index.ts:13` `KEEP`) admit the files below; `build.ts:152` sends them to `analyzer/config/index.ts` (`isConfigFile`, `extractConfig`) as `lang: "config"|"proto"` entries that stay in `repo.files`. `SECRET_RE` (`build.ts:25`) keeps blocking `.env`, `.env.local`, `.env.*` except `.env.example|.env.sample|.env.template|.env.dist`; every config value passes `redactValue()`: name matching `/(SECRET|TOKEN|KEY|PASSWORD|PASS|PWD|PRIVATE)/i` or value matching `/^(sk|pk|rk|ghp|xox|AKIA)[A-Za-z0-9_-]{8,}|^[A-Fa-f0-9]{32,}$|^[A-Za-z0-9_\-]{40,}$/` → `"•••"`; URL passwords (`://user:pw@`) → `://user:•••@`.

| Source (case-insensitive glob) | Parser | Yields (evidence = the named line, `role: "config"`) | Confidence |
|---|---|---|---|
| `docker-compose*.yml/yaml`, `compose*.yml/yaml`, overrides merged in filename order | `yaml` | `services.<name>` → service. `build` string / `build.context` → `dir` → bound to the area containing that dir (an area is created from the dir if it has no manifest). `image` without `build` → kind by image: `postgres\|mysql\|mariadb\|mongo\|cockroach\|sqlite` db; `redis\|memcached\|keydb` cache; `kafka\|redpanda\|rabbitmq\|nats\|activemq\|mosquitto\|pulsar` broker; `nginx\|traefik\|kong\|envoy\|caddy\|haproxy` gateway; else placeholder ("built elsewhere"). Hostnames: name, `container_name`, `hostname`, `networks.*.aliases[]`, `links[]` alias, each also `:containerPort`. `ports` `H:C` / long form → `devHosts` `localhost:H`, `127.0.0.1:H`. `environment` (list/map) + `env_file` (example variants only) → env values scoped to the service. `depends_on` (list/map) → `dependsOn`. | boundary, hostnames, dir: certain; unknown image kind: likely; `devHosts` matches: likely ("matched by the published port") |
| `*.yml/yaml` containing `apiVersion:` + `kind:` (multi-doc `---`), skipped when text contains `{{` or path contains `/templates/` | `yaml` | `Service` → hostnames `name`, `name.<ns>`, `name.<ns>.svc.cluster.local`, `name:<port>`, env names `<NAME>_SERVICE_HOST/_PORT` (upper, `-.`→`_`). `Deployment\|StatefulSet\|DaemonSet\|Job\|CronJob` → image, `env[]` (`value`; `valueFrom.configMapKeyRef` followed into `ConfigMap.data`; `secretKeyRef` never read); `selector` ⊆ `template.labels` joins Service↔workload. `Ingress` / Gateway API `HTTPRoute` → `GatewayRule` rows (`path`, `pathType`, `backend.service.name`). `kustomization.yaml` `resources[]` → parse those. | names/ports/ingress: certain; image→folder: likely unless compose/Dockerfile agrees |
| `Chart.yaml`, `values.yaml` | `yaml` | chart name, `dependencies[].name`; values keys matching `/(url\|host\|baseurl\|endpoint\|addr)$/i` → env-ish values | likely, note "from a Helm values file" |
| `Dockerfile`, `Dockerfile.*`, `*.dockerfile` | regex | `EXPOSE n`; `ENV K=V` / `ENV K V` → env scoped to the service whose build points here (else the folder's own); last `CMD`/`ENTRYPOINT` → `entry` + framework hint (`uvicorn\|gunicorn\|flask\|node\|next\|npm start`); folder = app service if not bound already | certain |
| `.env.example\|.sample\|.template\|.dist` | regex `^\s*(export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$` | env values scoped to the nearest area | certain for the pairing; redacted as above |
| `next.config.{js,mjs,ts}` | tree-sitter JS (`parser.ts` `parseJsSnippet`) | `rewrites()` array or `{beforeFiles, afterFiles, fallback}`; literal `source`/`destination` only; `:x` → `*`, `:path*` → `**`; absolute destination → `toHost`; `basePath`; `env: {}` → env values | literal pair: certain; `fallback` rows: likely and applied only when the call's first literal segment equals the row's first literal segment |
| `vite.config.*` `server.proxy`, `package.json` `"proxy"` (CRA), `proxy.conf.json` (Angular), `nuxt.config.*` `nitro.devProxy` | tree-sitter JS / JSON | `GatewayRule` prefix → target (+`rewrite` presence ⇒ `strip` likely) | certain when literal |
| `nginx*.conf`, `**/conf.d/*.conf`, `**/sites-*/**` | regex | `upstream <n> { server host:port; }` → name→host; `location [~] /prefix/ { proxy_pass http://<target>[/uri/]; }` → rule (with-URI form strips the prefix) | certain |
| `openapi.{json,yaml,yml}`, `swagger.*`, `**/openapi/**/*.{json,yaml}`, `api-docs.json` | `yaml`/JSON | `paths` × methods, `{x}` → `*`, `operationId`, `servers[].url` host → service via hostname table | route exists: certain (file = the spec); reconciled with parsed handlers (handler wins; spec-only route gets `note` "described in openapi.yaml; I did not find the code") |
| `asyncapi.*` | `yaml` | `channels.<n>.address`, `operations.<n>.action send\|receive` + channel ref | as OpenAPI |
| `**/*.proto` | regex `^\s*service\s+(\w+)\s*\{`, `rpc\s+(\w+)` | rpc service nodes with methods; generated `*_pb2*.py`, `*_pb.js`, `*_grpc_pb.js`, `*.pb.go` skipped for parsing (`GENERATED_RE`) but their names identify the service | certain |
| root `package.json` `workspaces`, `pnpm-workspace.yaml` `packages`, `Cargo.toml` `[workspace] members`, `go.work` `use` / multiple `go.mod`, Nx `project.json`/`nx` key (`implicitDependencies`, `tags`), `turbo.json` presence | JSON/`yaml`/TOML-lite regex | workspace packages → areas with `isApp` hint from `apps/*`, `services/*` vs `packages/*`, `libs/*`; dependency naming a sibling package `name` → area→area library link | declared deps: certain; app/lib from folder convention: likely, overridden by content |
| `apps/*`, `services/*` folders (only when no compose/k8s/Dockerfile/workspace file exists) | folder names | app services | likely, note "I'm going by the folder name" |
| `wrangler.toml` | TOML-lite regex | `name`; `[vars]` → env; `[[services]] binding/service` → `env.<BINDING>.fetch(...)` calls that service | certain |
| `catalog-info.yaml` (Backstage), `compass.yml`, `workspace.dsl` (Structurizr) | `yaml`/regex | `declared[]`: names, `system` (grouping), `dependsOn`, `providesApis/consumesApis`, `a -> b` | system view only, likely, note "the team wrote this in catalog-info.yaml; I did not see it in code" |
| Deploy config (`config/deploy.ts`, `config/hosting.ts`, `gateway.ts`): `.github/workflows/*.yml` and `.gitlab-ci.yml` (a curl/wget health check after deploying, `environment: url:`, a health-check action's `url:`; never a download, an installer, a POST, a tool's or CI's own host, a `${{ }}` host, a comment), `Caddyfile` sites, nginx `server_name`, compose Traefik `Host()` labels, Ingress `rules[].host`, HTTPRoute `hostnames`, `fly.toml` (`<app>.fly.dev`), `render.yaml` and `app.yaml` `domains`, `vercel.json` `alias`, `CNAME`. Read only when they name a public address (`configKind: "deploy"`); the folder readers let `.github/workflows` through as config files only | line/regex, `yaml` | `ServiceDef.addresses` + `hostnames`: the service the config says the address leads to (a compose service, a backend, an upstream), else the service whose folder the step or file is in, else the repo's one app; an address two services are given is neither's (warning) | certain |

Code-side facts (extractors):

- **`urlText` fix** (`js.ts:20-34`): skip the backtick child *before* testing `first`: `if (c.type === "`") continue; if (c.type === "template_substitution") { if (first) { fromVariable = true; varName = envVarOf(c, f.consts) } url += "*" } else url += c.text; first = false;`. `` `${process.env.USERS_URL}/users/${id}` `` → `{url: "*/users/*", fromVariable: true, varName: "USERS_URL"}`. `binary_expression` and Python `strText`/`urlOf` (`py.ts:12-58`) gain the same `varName`/`literalBase`.
- **`envVarOf`**: `process.env.X`, `import.meta.env.X`, `Deno.env.get("X")`, `env.X`, `c.env.X`, `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")`, `settings.X`, `config.X`, `config("X")`; a bare identifier is looked up in `f.consts` (module-level, same file, one hop: `const BASE = process.env.X ?? "http://users:8080"` records both `envVar` and the literal default, which also feeds `envValues` with the code line as evidence).
- **Every env read** → `envReads` (js.ts:389-402, py.ts:239-256 keep calling `serviceForEnv` for third-party hints).
- **Express/Fastify/Koa route span** (`js.ts:302-309`): when `handler` is an identifier defined in the same file, `endLine` = that function's end from `f.fns`/`f.nested`. **File node rule** (`build.ts:412`): also add the file node when the file has any `http`, `sql`, `channels` or `rpc` fact outside every route span, so `containerAt` never returns null for a real fact.
- **gRPC**: Python `add_(\w+)Servicer_to_server(` → implements; `(\w+)Stub(` + nearest `grpc.(insecure_|secure_)?channel("host:port")` in the same function/file → calls with host; Node `server.addService(<pkg>.(\w+).service` → implements, `new <pkg>.(\w+)("host:port"` → calls. Go is out of scope (no grammar).
- **Channels** (`src/analyzer/extract/channels.ts`, shared tables for js/py; literal first argument → `literal: true`): kafkajs `producer.send({topic})` / `consumer.subscribe({topic|topics})`; confluent/aiokafka/kafka-python `produce(topic=)` / `send("t")` / `subscribe([...])`; amqplib `sendToQueue(q)`, `publish(exchange, key)` (name `exchange/key`), `consume(q)`, `bindQueue`; pika `basic_publish(exchange=, routing_key=)`, `basic_consume(queue=)`; SQS `SendMessageCommand({QueueUrl})`/`send_message(QueueUrl=)` vs `ReceiveMessageCommand`/`receive_message` (name = last URL segment; env → `varName` rules); SNS `PublishCommand({TopicArn})` (last ARN segment); NATS `publish/subscribe/request(subject)`; Redis `publish/subscribe/psubscribe(channel)`, `xadd(stream)`/`xreadgroup(...stream)`; BullMQ `new Queue("n")`+`.add(` vs `new Worker("n"`; Celery `@app.task` + `.delay()/.apply_async(queue=)` (channel = queue, default `celery`), `send_task("name")` → the module defining that task (certain when found; placeholder likely otherwise). Task names and queue names are never conflated (`task_routes` maps explicitly).

## 4. From config facts to services (`src/analyzer/services.ts`, new; runs in `buildMap` after parsing, before nodes)

```
1. seeds := compose services ∪ k8s Services (joined to workloads) ∪ wrangler names ∪ Dockerfile folders ∪ workspace apps ∪ folder-convention apps
   merge by normalisedName (lower; [-_. ] → "-"; strip -service|-svc|-api|-app suffix), priority compose > k8s > Dockerfile > wrangler > workspace > folder;
   the highest-priority source sets areas/kind/confidence, every source appends evidence.
2. area binding: build.context / Dockerfile dir / workspace dir → the area at or under that dir. An `image`-only compose service with an app-looking image
   (not in the infra tables) is a placeholder until §6.5 binds it to a repo.
3. app vs library for every area with no seed: app iff ≥1 route node OR an entrypoint (Dockerfile CMD, package.json "start"/"main" + server framework import,
   `if __name__ == "__main__"`, uvicorn/gunicorn/flask run, Next.js app/ or pages/, JSX + next|vite|react-scripts|@angular/core|svelte|nuxt in the manifest).
   Otherwise library: not a service. A library's nodes get `service` = the app service that imports it (import edges or workspace deps, transitively);
   ≥2 importers → the one with the most import edges, ties broken by service order; the nodes carry a "shared library <area>" badge and are drawn in every importer's level 2.
4. hostnames for an app with no config: `<area basename>` (likely) and devHosts `localhost:<port>` from `app.listen(3000)`, `uvicorn.run(port=)`, `PORT` default (likely).
5. db identity per app service: first of DATABASE_URL|DB_URL|POSTGRES_URL|MYSQL_URL|MONGO_URL|REDIS_URL|DB_HOST|POSTGRES_HOST in its env table (compose > k8s > Dockerfile > .env.example > code default)
   → host resolved through the hostname table → a db/cache ServiceDef; dbId = `${svcId}/${dbname}` when the URL has a db name, else svcId. Unresolved → `own:<serviceId>`.
   A schema/migration file in a library area that ≥2 app services import defines tables in each importer's db.
6. system.kind := "services" if ≥2 app-kind services; "monorepo" if 1 app + ≥1 library area; else "monolith".
7. flow order: topological order of the aggregated service graph (calls-route | calls-rpc | publishes→consumes), ties: has UI nodes first, then name; cycles broken by name.
   Infra after apps, placeholders last. Stored as the order of map.services so UI and AI agree.
8. placeholders are created lazily by §5 for bare hostnames no seed owns (name = host without port, deduped).
9. declared[] entries matching no seed → ServiceDef {declared: true}; matching ones only add `group`.
```

Every `ServiceDef.evidence` has ≥1 line: the `services.<name>:` line, the `kind: Service` line, the Dockerfile CMD line, or the `app.listen` line.

## 5. Resolving a call across services (`build.ts` HTTP block, lines 523-582 rewritten)

Tables built once: `hostTable: Map<host, {service, confidence, evidence}>` (lower-cased, with and without port); `devHostTable` (`localhost:<H>` → publisher, likely); `envTable: Map<VAR, {value, evidence, scope?}[]>` (lookup order: caller's own compose scope → unscoped → any); `gatewayRules` sorted longest `source` first, the caller's own service's rules first; `routesByService`.

`resolveHost(host)`: `serviceForHost` → outside (unchanged); a public host the user answered (§13 "Whose address is this?") → the app named, certain (evidence `role: "user"`), or outside when they said "another company's / not sure" (this wins over deploy config); `hostTable[host] ?? hostTable[hostWithoutPort]` → service certain (the table also holds the public addresses a service's own deploy config gives it, cited by their deploy line); `devHostTable[host]` → service likely ("localhost:8000 is the port docker-compose.yml:15 publishes for users"); bare host (no dotted TLD, or ends `.local|.internal|.svc.cluster.local`, not localhost) → placeholder ServiceDef `{kind: "placeholder", name: host-without-port}` + node `svc-int:<id>` `{kind: "service", internal: true, layer: "external"}`; dotted host → outside `svc:<host>` (today's `build.ts:553-556`).

`resolveEnv(VAR, caller)`: k8s form `^(.+)_SERVICE_HOST$` → service by name, certain. `envTable[VAR]` → `callSegments(value)` → `resolveHost(host)`, carrying the value's path as `basePath`; evidence += the config line. No value, but the user told WalkMyCode where `VAR` points (§13) → that app service, certain; evidence += `{role: "user", text: "you told WalkMyCode: VAR → backend"}` at the line that reads `VAR`. Unresolved → name heuristic `^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)?([A-Z0-9]+?)_(?:SERVICE_|SVC_)?(?:URL|HOST|BASE_URL|BASEURL|ENDPOINT|API_URL|API|ADDR)$`, stem normalised equal to a service name → likely, note "matched by the setting's name USERS_URL (I found no value for it in your config)". Otherwise null.

```
for each HttpCallFact h in file p; S := serviceOf(p); from := containerAt(p, h.line)   // never null after §3 file-node rule
  {segs, host} := callSegments(h.url); ev := [codeLine]; target := null; conf := "certain"; notes := []; basePath := []; leadingVar := h.fromVariable
  0. public address (§13 "Whose address is this?"): the request's address, read as 1-3 read its base (a literal host, a setting's value
     or code default, a constant, the function or helper it goes through, a rewrite), is a public dotted host, listed in publicHosts.
     When the user names its app, or that app's own deploy config gives it the address (and the user did not say otherwise):
                                      → target := that app, certain; segs := the address's path + the request's;
                                        ev += the line that sets the address + the deploy line, or {role: "user", "you told WalkMyCode: <host> is <app>"}
        path matches                  → calls-route certain
        literal path, no route        → visibly built on the address (in the URL, a constant, or a helper whose own request is `${BASE}${path}`):
                                        missing route, certain, no arrow; through a function: drawn as if nobody had said
        path all variable             → uses-service certain to svc-int:<app> (the service as a whole), never an outside node
  1. host:
     a. serviceForHost(host)          → uses-service certain to svc:<slug>  (unchanged)                                        stop
     b. r := resolveHost(host)        → target := r.service; conf := r.confidence; ev += r.evidence; leadingVar := false
        placeholder                   → uses-service certain to svc-int:<id>, warning "I can't see the code of <host> (called from p:line); add its folder to the workspace"   stop
        outside (dotted)              → uses-service certain to svc:<host> (today)                                             stop
  2. else h.varName / h.literalBase:
     literalBase                      → as 1 with that host
     r := resolveEnv(varName, S)      → target := r.service; conf := r.confidence; basePath := r.basePath; ev += r.evidence; leadingVar := (r came from the name heuristic)
     null                             → fall to 5 with leadingVar = true (today's behaviour)
  3. else path-only:
     a. S's own routes match          → target := S, certain
     b. gateway rule matches          → target := rule.toService ?? resolveHost(rule.toHost); segs := rule.prependPath + segs.slice(rule.strip); ev += rule.evidence;
                                        conf := rule.confidence; notes += "goes through the rewrite in next.config.js:6"
     c. S has no routes and exactly one app service has routes → target := it, likely, note "only the users service has routes that could answer this"
  4. candidates := target ? routesByService[target] : ALL routes
     hits := best matches of matchRoute(basePath-stripped segs, routeSegments(r.path), leadingVar || (target && h.fromVariable && "allow 1 dropped segment")) filtered by method
  5. no target (global search)        → hits as today; conf := "likely" always when system.kind === "services";
                                        note := hits span >1 service ? "More than one service has this path; a base-URL setting or a rewrite would let me tell them apart"
                                                                     : "matched by the path only, across services"
  6. no hits: target with code        → warning "<target> has no <METHOD> <path> that I can see (called from p:line)"; no arrow
              no target, host         → handled in 1; else unmatched counter (today)
  7. conf := certain only if target certain, one distinct path in one service, method known; else likely with notes joined by "; ".
     The "starts with a variable" note is added only when leadingVar is still true after step 2 (name-heuristic or unresolved case).
  8. addEdge(from, rn.id, "calls-route", conf, ev[], note, fnAt, rn.handler)  // every ev entry is pushed; config lines carry role: "config"
```

`segs.every("*")` guard (`build.ts:578`) stays. Edge ids stay `${kind}:${from}->${to}` so several call sites merge with appended evidence.

**Worked example A** — `` fetch(`${process.env.USERS_URL}/users/${id}`) `` in `web/src/lib/api.ts:12`. Fact `{url: "*/users/*", fromVariable: true, varName: "USERS_URL", method: "GET"}`. `resolveEnv` → `docker-compose.yml:21 USERS_URL=http://users:8080` (scope web) → `resolveHost("users:8080")` → `svc-users` certain (`docker-compose.yml:9`). Candidates = users' routes; `["*","users","*"]` drop 1 → `["users","*"]` vs `GET /users/:id` score 3, unique → **certain**, evidence `[api.ts:12 (code), docker-compose.yml:21 (config)]`, no note. Without the compose value: name heuristic → likely, "matched by the setting's name USERS_URL". Without any service named users: step 5, likely. Never an outside-service node.

**Worked example B** — `requests.get("http://users:8080/users")` in `services/orders/app/main.py:40`. `host = users:8080`, `segs ["users"]`; 1b → `svc-users` certain; `GET /users` scores 2, `GET /users/:id` fails on length → **certain**, evidence `[main.py:40, docker-compose.yml:9]`, no "starts with a variable" note. Without compose: placeholder `svc-int:users` with `uses-service` certain and a warning; adding the users repo later merges the placeholder by normalised name (§6.5).

**Worked example C** — `fetch("/api/users/1")` in `web/app/page.tsx:30` with `next.config.js` `{source: "/api/:path*", destination: "http://users:8080/:path*"}`. 3a: web has no `/api/users/*`. 3b: rule `["api","**"]` matches, strip 1 → `["users","1"]`, `toHost users:8080` → `svc-users` → `GET /users/:id` → **certain**, evidence includes `next.config.js:6`, note "goes through the rewrite in next.config.js:6". Inspector row: "sends a request to GET /users/:id (users service) — through the /api rewrite in next.config.js:6". The rewrite is an evidence line, not a box; a gateway becomes a `proxies` link on the system view only when it is a separate service (nginx/traefik container, Ingress).

**Other link kinds.** gRPC: node `rpc:<proto>#Users` (layer api, `service` = implementer); edge `calls-rpc` certain when the host resolves or exactly one implementer exists, else likely; vendored proto with no implementer → the rpc node belongs to a placeholder. Channels: node `chan:<tech>/<name>` (layer external, `service` = broker ServiceDef if compose has one); `publishes`/`consumes` certain for literal names, likely for variable/env/wildcard names ("the queue name is built at run time"). Shared tables (§4 step 5): a `reads`/`writes` edge from service A into a table whose `db` belongs to service B's database. `depends-on`: compose/k8s only, system view only. Declared: system view only, likely, never in level 2.

**Tables** (`build.ts:424-431`): `tableId(name, p) = system.kind === "services" ? `table:${dbOf(serviceOf(p))}/${name}` : `table:${name}``. `MapNode.db` and `usedBy` set; `defines` matched within the same db. Same db identity (same resolved host + db name, or the same compose db service) → one node shared by both services (certain; the connection string proves it). Different or unknown db → separate nodes, badge, no arrow.

**Trace** (`store.ts:123-145`): depth 8; when `serviceOf(e.from) !== serviceOf(e.to)` the layer-order test is skipped (a service hop resets the layer clock); `chan` nodes are layer 1.5 (publish forward from any layer, consume forward into any layer); returns `{nodes, edges, services}`.

## 6. Workspace model

6.1 **Store** (`src/lib/store.ts`):
```ts
export interface RepoSource { label: string; kind: "local" | "demo" | "github"; handle?: FileSystemDirectoryHandle; fileCount: number; addedAt: string; }
export interface Workspace { id: string; name: string; repos: RepoSource[]; map: CodeMap; files: Record<string, string>; needsReindex?: boolean; }
```
`setWorkspace/useWorkspace/restoreWorkspace`; `useRepo()` stays as a wrapper returning `{map, files, source: {kind, label: name}}` so `Guide`, `Inspector`, `FileTree`, `tools.ts` compile unchanged. IndexedDB version 2, key `"workspace"`; `onupgradeneeded` wraps the old `"repo"` value as a one-repo workspace through `upgradeMap`; `needsReindex = true` when the old map's repo now has config files or `version < 2` and `system.kind` may be `"services"` — the map page shows "Your map was made by an older WalkMyCode; re-open the folder to rebuild it" (demo sources refetch `/api/demo`). `FileSystemDirectoryHandle` is structured-cloneable, so "Refresh" re-reads a local repo after `handle.requestPermission({mode: "read"})`.

6.2 **Prefixing** (`src/lib/workspace.ts` `combineRepos(repos: {label, files}[]) → {sources, repos}`): one repo → paths unchanged, `prefix ""`. ≥2 → `path = label + "/" + path`, labels deduped (`api`, `api-2`). `buildMap(sources, {name, repos})`: each repo root counts as a manifest dir even without a manifest, so `areaOf` never lets repo A's files fall into repo B's area; `displayName` strips the repo prefix when the area does. `MAX_FILES` 4000 per repo, 12 000 per workspace; the Connect page refuses the 12 001st with a message.

6.3 **Browser picker** (`src/app/page.tsx`, `localFolder.ts`): the connect card becomes a list — "Add a folder" (FS Access API or `<input webkitdirectory>` fallback, first segment stripped per pick as today), each row label · file count · remove; demos are added as repos too; "Map it" (disabled until ≥1 repo). Map page header: `{name} · 2 repos · 3 services · …`; "change repo" → "workspace" (back to the list, repos kept).

6.4 **CLI** (`scripts/index.ts`): `npm run index -- <dir> [<dir>…] [--name <name>]`. One dir: unchanged output. Several: labels = basenames (deduped), paths prefixed, `--name` required. Prints `system: services (web, users, orders) · 7 links (2 guesses)` and unresolved env vars. `api/demo/route.ts` applies `upgradeMap` and otherwise is unchanged.

6.5 **Cross-repo binding**: hostname and env tables are the union across repos. A compose service in repo A with `image: acme/users` and no local build binds to repo B when B's label, root manifest name, or Dockerfile `LABEL` normalises to `users`; a placeholder created by §5 is merged into a later-added repo's app service by normalised name. Every merge records both evidence lines.

## 7. UI

7.1 **`MapView` views** (`src/components/MapView.tsx`), prop `view: {kind: "all"} | {kind: "system"} | {kind: "service"; id: string}`, kept in the URL hash (`#system`, `#svc-users`, `#svc-users/route:…`) so reload and pop-out restore it. Defaults: monolith/monorepo → `all` (today's picture, byte-identical positions); services → `system`, or `all` when `map.nodes.length ≤ 150`. `all` is always reachable ("show everything") for services too; cross-service edges are drawn directly there, as today.

7.2 **System view** (`layoutSystem()` in the same component, node type `svc`): one card per ServiceDef — app (chalkboard card: name, framework, "6 routes · 2 tables", repo badge when >1 repo, "why is this a service?" → boundary evidence in Details); db (cylinder, "shared by users, orders"); cache; broker (channels on hover); gateway; placeholder (dashed outline, "I can't see this code — add its folder"); outside services on the far right in today's colour; declared-only dotted grey. Columns by flow rank (§4 step 7): rank 0 = front doors, infra and channels second-to-last, outside services last; `group` draws a labelled React Flow parent box. Edges: `calls-route`/`calls-rpc` yellow, `publishes`/`consumes` purple `#c9a8e0` (legend "message"), `reads`/`writes` green, `proxies` yellow dotted, `depends-on`/declared thin grey `#5b554c` dotted (legend "declared, not seen in code"); dashed when likely; label = count ("12 requests · 2 guesses"). Edge click → Details tab lists the underlying node edges grouped by target with counts; each row opens both the code line and the config line. Double-click/Open → `service` view. Menu: "Explain this service", "Tour how A talks to B" (tour job seeded with the link's evidence), "Trace" (lights the service path). Hidden when `system.kind !== "services"`; `monorepo` shows "one app + N shared packages" in the header and package badges on cards.

7.3 **Service view** (level 2): today's five lanes with visible nodes = `n.service === id` (library nodes appear in every importer, badge "shared library <area>") plus **portals** derived in `useMemo`: for each `calls-route`/`calls-rpc`/`publishes`/`consumes`/shared-table edge that crosses the boundary, a stub card `portal:<edgeId>` in the lane of the far end — Routes lane for routes/rpc ("→ users · GET /users/:id", sub "door in the users service · click to jump"), Outside lane (retitled "Outside & other services") for channels and placeholders, Database lane for a shared table ("shared with orders"). Portal click selects the real target, switches `view` (breadcrumb animates) and `fitView({nodes: [target]})`. Inbound routes get a badge "← called by orders". Positions stay a pure function of `[map, visible]`; a monolith map never derives portals.

7.4 **Breadcrumb** (`src/components/Breadcrumb.tsx`, in the map panel header `map/page.tsx:187-194`): `System › users service › GET /users/:id`; crumbs are buttons; root crumb is the workspace name when there is no system level.

7.5 **Search / palette** (`src/components/Palette.tsx`, `Ctrl+K` and the existing find box): matches names, files, paths, hostnames and env var names (`USERS_URL` finds the users service); results grouped "in users service / in web"; picking one switches view before selecting. Prefixes `svc:`, `route:`, `table:`, `chan:`.

7.6 **Evidence** (`src/components/EvidenceList.tsx`, shared by Inspector, Details and both views): "why is this arrow here?" chip on every selected edge; rows show a `config` chip for `role: "config"` and open that file in the Code panel (config files are in `repo.files`; `CodeView` gets a plain-text mode for `lang: "config"|"proto"`).

7.7 **Inspector** (`Inspector.tsx:19-32`) wording: internal service portal → "another service in this system — code you can open"; placeholder → "one of this app's own services — its code isn't in this workspace"; channel → "a queue or topic — messages wait here for another service to pick up"; rpc → "a gRPC service — doors called by name, not by URL". A "Service" line on every card: `in the users service · docker-compose.yml:12`. OUT/IN words: `calls-rpc` "calls (gRPC)", `publishes` "puts messages on", `consumes` "picks messages up from", `depends-on` "is started after". Never "another company" for `internal` nodes.

7.8 **Refit**: `ResizeObserver` on the map panel replaces the `window` listener (`MapView.tsx:146-154`) — also what SHELL needs. `onlyRenderVisibleElements` when > 400 nodes.

7.9 **Header** (`map/page.tsx:171,182`): `{name} · {repos} repos · {services} services · {parsed} files · {routes} routes · {tables} tables · {edges} links ({likely} guesses)`; monolith prints today's line. `FileTree` groups by repo label when >1 and shows config files with a gear glyph.

7.10 **Trace/tours**: `lit` becomes `{nodes, edges, services}`; when the current service view is not in `services`, the header shows "The trace continues in orders service →". A tour step whose nodes live in another service switches view before highlighting; a step naming only `svc-int:`/`svc:` ids switches to the system view.

## 8. AI map summary and tools (`src/lib/claude/prompts.ts`, `tools.ts`)

Monolith: exactly today's summary (`# Repo:` header, `Areas (packages):` line) — the AI is never told about services that do not exist. Monorepo: today's plus one line `Packages: <area> (library) …`. Services:

```
# Workspace: shop (2 repos: web, services) — 3 services (docker-compose.yml), 7 links (2 guesses)
Level 1 = services, level 2 = one service's lanes.
## Services (in flow order)
- web — Next.js app in web/ (hosts web:3000; dev localhost:3000). Calls: users ×12 (via next.config.js rewrites), orders ×4. Talks outside to Stripe.
- users — Express app in services/users (hosts users, users:8080; env USERS_URL; start: node server.js). 6 routes, 2 tables in postgres/shop. Called by: web, orders. Consumes kafka topic orders.created.
- orders — FastAPI app in services/orders (host orders:8000). 5 routes, 3 tables in postgres/shop. Calls: users (GET /users/:id — services/orders/app/main.py:40). Publishes kafka topic orders.created.
- postgres — database (docker-compose.yml:30), shared by users and orders. kafka — broker (docker-compose.yml:41).
- Not in this workspace: payments (called at http://payments:9000 from services/orders/app/billing.py:22)
## Gateways: /api/* → users (web/next.config.js:6)
## Links between services (evidence)
- web → users: calls-route ×12 (web/src/lib/api.ts:12 → services/users/src/index.js:14, resolved through docker-compose.yml:21) …
- orders → users via kafka topic orders.created: GUESS (literal topic, one producer, one consumer)
- users → postgres: depends-on (declared in docker-compose.yml:18, not a call)
## Inside each service   (today's per-layer lists, capped per service: 40 ui, 60 routes, 40 logic, 40 tables; services beyond 12 summarised as counts)
### web … ### users … ### orders …
## Outside services: Stripe, Resend
Node ids: file:<path>, route:<file>#<METHOD> <path>, table:<db>/<name>, svc:<slug> (outside), svc-int:<service> (a service without code here), chan:<tech>/<name>, rpc:<proto>#<Service>. Paths start with the repo label when several repos are open.
```

`SYSTEM` gains one rule: "When the workspace has several services, say which service you are in and cross the boundary explicitly ('the web app sends this to the users service')." Tools: `query_map` matches service names/ids (`"users service"`, `svc-users`) and returns hosts, env, entry, routes and system links with evidence; `"system"` returns all links. `list_files` lists repo labels at `/` when >1. `describeEdge` gains the new verbs, appends `(users service)` after a name in another service and `via next.config.js:6` for gateway evidence. `search`/`read_file`/`finish_tour` unchanged (prefixed paths are still paths; tour steps may name `svc-int:`/`chan:` ids).

## 9. Ordered task list (each verifiable alone)

1. **Types v2 + `migrate.ts` + `tests/analyzer.helpers.ts`** — `types.ts`, `facts.ts`, `analyzer/migrate.ts` (new), `build.ts` emits `version: 2`, `repos`, `system: {kind: "monolith", links: []}`, `services: [one app]`, `gateways: []`, `service` on nodes, stats; `store.ts` IDB v2 + `Workspace` + `useRepo` wrapper; `api/demo/route.ts` and `scripts/index.ts` pass-through. `tests/monolith.test.ts` snapshots v1 node/edge ids from both fixtures and asserts superset. *Verify:* iReliabee demo loads unchanged, `npm run typecheck` green.
2. **Extractor fixes with no new inputs** — `extract/js.ts` (`urlText` backtick fix, `varName`, `consts`, Express handler span), `extract/py.ts` (`varName`, `consts`), `build.ts:412` file-node rule, `envReads`. `tests/resolve.test.ts`: "env template literal is fromVariable + varName", "named handler keeps its SQL", "binary concat unchanged". Gated: without a resolved service the new facts go through the global search with today's likely note.
3. **Config readers** — `package.json` `yaml`; `analyzer/config/{types,index,compose,dockerfile,envfile}.ts`; `KEEP` in `localFolder.ts` and `scripts/index.ts`; `SECRET_RE` whitelist + `redactValue`; `lang: "config"`; `CodeView` plain-text mode; `FileTree` gear glyph. `tests/config.test.ts` (compose list/map env forms, override merge, Dockerfile, `.env.example` with a key that must be redacted, Helm template that must be skipped).
4. **`services.ts` boundaries + monolith rule** — §4 steps 1-7, `map.services`, `system.kind`, flow order; CLI prints it. `tests/services.test.ts`: compose fixture → 3 app + postgres + kafka, `services`; monolith fixture → 1 app, `monolith`.
5. **Resolution rewrite** — `build.ts` HTTP block per §5 with host/devHost/env tables, per-service candidates, placeholders (`svc-int:`), internal hosts never external; `Inspector` wording for `internal`. Tests: examples A, B; `/health` case; removal test (no compose → placeholder + name heuristic).
6. **Gateways** — `config/gateway.ts` (next rewrites via `parser.ts` `parseJsSnippet`, vite/CRA proxy, nginx, Ingress/HTTPRoute), `map.gateways`, step 3b; example C test.
7. **Tables per db + shared-db links** — `tableId`, `db`, `usedBy`, `defines` per db, `systemLinks()` for reads/writes/depends-on. Re-index the large real system privately and assert no lost edges, zero external nodes named by a bare host.
8. **System view + breadcrumb + level state + EvidenceList** — `MapView.tsx` (`view` prop, `layoutSystem`, `svc` node type, edge colours/legend), `components/Breadcrumb.tsx`, `components/EvidenceList.tsx`, `map/page.tsx` (hash state, header line, edge → Details), `globals.css`.
9. **Service view portals + ResizeObserver + search + trace** — `MapView.tsx` portals, lane retitle, `ResizeObserver`; `components/Palette.tsx`; `store.ts` `trace` depth 8 + service hop + `services`, `serviceOf`; tour level switching in `map/page.tsx`.
10. **Workspaces** — `lib/workspace.ts` `combineRepos`, `page.tsx` repo list, `localFolder.ts` per-repo cap + handle, CLI multi-dir + `--name`, §6.5 cross-repo binding, `FileTree` repo grouping. `tests/workspace.test.ts`.
11. **Channels + gRPC + specs** — `extract/channels.ts`, js/py matchers, `config/proto.ts`, `config/openapi.ts` (+asyncapi), `chan:`/`rpc:` nodes, derived link rule; kafka fixture assertions.
12. **Long tail readers** — `config/k8s.ts` (+Helm skip, kustomize), `config/workspaces.ts` (npm/pnpm/turbo/nx/cargo/go/wrangler), `config/declared.ts`; `group` boxes on the system view.
13. **AI** — `prompts.ts` `mapSummary` v2 (monolith branch unchanged), `SYSTEM` rule, `tools.ts` `query_map`/`list_files`/`describeEdge`; run the 20-question provider set on the compose fixture and hand-check citations into `docker-compose.yml`.
14. **Docs** — `docs/SERVICES.md` (this text), `docs/PLAN.md` (requirement 1 → SERVICES.md, version bump, Status), `docs/MOTION.md` 4.15/task 14 ("layout per SERVICES.md; choreography unchanged"), `README.md` ("open one folder or several", config files read, `.env` never read); re-index `.walkmycode/ireliabee`.

Steps 1-5 make the worked examples resolve; 8-9 make it visible; 10 is the multi-repo requirement; 11-12 are the long tail.

## 10. Test plan

Runner: `npm test` (`tsx --test tests/**/*.test.ts`, node:test + `assert/strict`). `tests/analyzer.helpers.ts` reads a fixture dir into `SourceFile[]` with the CLI's `KEEP` so browser and CLI see the same files; grammars load from `node_modules` as `scripts/index.ts:11` does. A pure `layoutFor(map, view)` is exported from MapView for layout tests.

**Fixture 1 — `tests/fixtures/monolith/`** (Next.js app, one `package.json`, Prisma): `app/page.tsx` (`<button onClick={signIn}>Sign in</button>` → `fetch("/api/login", {method: "POST"})`), `app/api/login/route.ts` (`POST` → `import { verify } from "@/lib/auth"`), `app/api/users/[id]/route.ts` (`GET`), `lib/auth.ts` (`prisma.user.findUnique`, `fetch("https://api.stripe.com/v1/customers")`), `lib/api.ts` (`` `${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}` ``), `prisma/schema.prisma` (`User`, `Session`), `.env.example` (`NEXT_PUBLIC_API_URL=http://localhost:3000`, `DATABASE_URL=postgres://localhost/app`, `STRIPE_SECRET_KEY=sk_test_abcdefghijklmnop`).
Assertions: `system.kind === "monolith"`; `services.length === 1` (kind app, `areas === map.areas`, `entry` from `package.json` start or `app/`); every non-external node `service === services[0].id`; table ids `table:user`, `table:session`; all v1 node and edge ids present (snapshot `monolith.v1.json` generated once from the current build); button → `POST /api/login` certain with `trigger.label "Sign in"`; the env base URL call resolves to `route:app/api/users/[id]/route.ts#GET /api/users/[id]` certain with evidence `[lib/api.ts:N (code), .env.example:1 (config)]`; `svc:stripe` external unchanged; `"sk_test_"` appears nowhere in `map` (JSON.stringify) and the env table value is `"•••"`; `layoutFor(map, {kind: "all"})` positions equal v1's for the same nodes; no portals; `mapSummary` starts with `# Repo:` and contains no "Services" section; no placeholder services; `warnings` has no "matched no route".

**Fixture 2 — `tests/fixtures/compose-shop/`**:
```
docker-compose.yml   web (build ./web, ports 3000:3000, env USERS_URL=http://users:8080, ORDERS_URL=http://orders:8000)
                     users (build ./services/users, ports 8000:8080, env DATABASE_URL=postgres://app:pw@postgres:5432/shop, depends_on [postgres, kafka])
                     orders (build ./services/orders, ports 9000:9000, env USERS_URL=http://users:8080, DATABASE_URL=postgres://app:pw@postgres:5432/shop, KAFKA_BROKERS=kafka:9092, PAYMENTS_URL=http://payments:9000)
                     postgres (image postgres:16), kafka (image redpanda)
web/                 package.json (next, react); next.config.js rewrites [{source:"/api/:path*", destination:"http://users:8080/:path*"}]
                     app/page.tsx  <button onClick={show}>Show me</button> → fetch(`/api/users/${id}`); fetch("/health")
                     src/lib/api.ts  const BASE = process.env.ORDERS_URL; fetch(`${BASE}/orders`, {method:"POST"}); getUser → fetch(`${process.env.USERS_URL}/users/${id}`)
services/users/      package.json (express, pg, kafkajs); Dockerfile (EXPOSE 8080, CMD node src/index.js)
                     src/index.js  app.get("/users/:id", getUser); app.get("/users", listUsers); app.post("/users", createUser); app.get("/health", (req,res)=>…)
                                   function getUser(){ db.query("SELECT * FROM users WHERE id=$1") }  function createUser(){ "INSERT INTO users …" }   // named, non-exported
                     src/consumer.js  consumer.subscribe({ topic: "orders.created" });  migrations/001.sql CREATE TABLE users
services/orders/     requirements.txt (fastapi, requests, confluent-kafka); Dockerfile (EXPOSE 9000, CMD uvicorn app.main:app)
                     app/main.py  @app.post("/orders") → requests.get("http://users:8080/users"); requests.get(f"{os.environ['USERS_URL']}/users/{uid}"); "INSERT INTO orders"; "INSERT INTO users"; producer.produce(topic="orders.created")
                                  @app.get("/health")
                     app/billing.py  requests.post(os.getenv("PAYMENTS_URL") + "/charge")
                     migrations/001.sql CREATE TABLE orders
```
Assertions (`services.test.ts`, `resolve.test.ts`, `layout.test.ts`):
- `system.kind === "services"`; app services in flow order `web, users, orders`, then `postgres` (db), `kafka` (broker), then `payments` (placeholder); `users.areas === ["services/users"]`, `users.hostnames ⊇ ["users", "users:8080"]`, `users.devHosts ⊇ ["localhost:8000"]`, `users.ports` `[{host: 8000, container: 8080}]`, `users.entry.text` contains `node src/index.js`, `users.dependsOn` = postgres, kafka; `users.env.DATABASE_URL.file === "docker-compose.yml"` and value `postgres://app:•••@postgres:5432/shop`; every ServiceDef has ≥1 evidence line.
- **A**: `calls-route:file:web/src/lib/api.ts->route:services/users/src/index.js#GET /users/:id` certain; evidence has the code line and a `docker-compose.yml` line with `role: "config"`; `fromFns ["getUser"]`, `toFns ["getUser"]`; the `BASE` binding case → `route:services/orders/app/main.py#POST /orders` certain.
- **B**: `POST /orders` → users `GET /users` certain and the f-string → `GET /users/:id` certain; neither has the "starts with a variable" note.
- **C**: `web/app/page.tsx` → `GET /users/:id` certain, note contains `next.config.js:`, `trigger.label === "Show me"`.
- `fetch("/health")` from web → exactly one edge, to users `GET /health` through the rewrite (no fan-out); `nodes.filter(kind === "service" && layer === "external" && !internal)` is empty; no node named `users:8080` or `users`.
- `billing.py` → `svc-int:svc-payments` `{internal: true}`, `uses-service` certain, warning naming `billing.py:<line>`; Inspector wording never contains "another company".
- Named Express handlers: `route:…#GET /users/:id` has `reads` → `table:svc-postgres/shop/users`; `createUser` writes it.
- Tables: `table:svc-postgres/shop/users` and `table:svc-postgres/shop/orders` (one shared db); orders' `INSERT INTO users` is a `writes` edge to the *same* users table (certain, same `DATABASE_URL`); `system.links` contains `writes:svc-orders->svc-postgres` and `depends-on:svc-users->svc-postgres`; no `calls-route` between an app and postgres.
- Channel: `chan:kafka/orders.created` with `publishes` from orders (certain) and `consumes` from users (certain); exactly one derived `publishes` link orders→users with `via === "chan:kafka/orders.created"`, likely.
- `stats.crossService` = number of node edges whose ends have different `service`; `stats.likely` = dashed edge count; every edge has ≥1 evidence whose `file` is in `map.files`; `warnings` has no "matched no route".
- Layout: `layoutFor(map, {kind: "service", id: "svc-web"})` contains portals `portal:calls-route:file:web/src/lib/api.ts->route:…GET /users/:id` in the Routes lane; `{kind: "system"}` has 6 service cards, links `web→users`, `web→orders`, `orders→users`, `orders→users@chan`, `orders→payments`, and `depends-on` edges styled declared.
- `mapSummary` contains `# Workspace:`, `## Services` with three app lines, `## Gateways`, "Not in this workspace: payments", and a `## Links between services` line citing both `web/src/lib/api.ts:` and `docker-compose.yml:`.
- **Two-repo variant** (`workspace.test.ts`): same fixture as repos `web` (= `web/`) and `services` (= `services/` + a copy of `docker-compose.yml` with `build: ../web`) through `combineRepos` → identical service set, all paths prefixed, `read_file("web/src/lib/api.ts")` works, `nodeAt(map, "services/users/src/index.js", 14)`… resolves to the route under the prefixed path, node ids identical across two builds.
- **Removal test**: drop `docker-compose.yml` → `users:8080` becomes a placeholder (never external); env-var calls fall to the name heuristic (likely, "matched by the setting's name"); summary lists "1 service I can't see the code for".
- **Hand-checked set** `tests/fixtures/expected-edges.json`: 20 edges from compose-shop + 10 from iReliabee asserted exactly (id, confidence, evidence files), so any resolver change that adds or removes an arrow fails a test.

**Regression on a large real system**: run privately against a checkout (edge count never drops, no edge id lost, guesses never increase); not part of the public repository.

**Manual checks recorded in the PR**: pick compose-shop with both pickers; see the system view; drill into users; click the portal back to web; "Trace it" from "Show me" crosses into users; ask "how does an order reach the users service?" and confirm the answer cites `docker-compose.yml`; resize the map panel (SHELL) and confirm refit.

## 11. Non-regression rules

- One repo, one app service → the map equals v1 except `version`, `repos`, `system`, `services`, `gateways`, `stats.*`, `service` on nodes, plus edges *added* by the two container fixes and the `urlText` fix (always with a service resolution or today's likely note). Ids never change.
- The global route search stays the last resort; it is always `likely` in a multi-service map and unchanged for monoliths.
- Internal hostnames never become outside services: `resolveHost` runs before `build.ts:553`.
- Declared links (`depends-on`, Backstage) never appear in level 2 and never as calls.
- `.env`, `.env.local`, `.env.production` are never read; example variants are, with redaction.

## 12. Touchpoints with SHELL and ACCOUNTS

- **SHELL**: the Map panel is one `MapView` with a `view` state; it must keep the same React element across dock/undock (MOTION 4.14) so view, search and portals survive, and it refits on container resize (§7.8). The Details tab's edge list (§7.2) and `EvidenceList` are panels too.
- **ACCOUNTS**: a saved workspace = `{name, repos: [{label, kind, github?}], mapHash}` per user; maps and files never leave the browser in hosted mode (only the list is stored); `WALKMYCODE_MODE=byok` keeps IndexedDB only.
- **Lite**: `yaml` and `analyzer/config/*` are plain ESM and run in the artifact; the packaging allow-list must admit `.yml/.yaml/.proto/Dockerfile` as text if Lite ever bundles a demo workspace.

---

## 13. Owner's decisions (30 Sep 2026)

1. **Keep the strict rule.** Path-only matches in a multi-service map stay `likely` (dashed, with the reason) unless config proves where the request goes. No arrow is hidden.
2. **"Where does this point?" (after the shell and motion).** When a request's base comes from an env setting with no value anywhere in the workspace (`VITE_API_URL`, `NEXT_PUBLIC_API`, `API_BASE`, …), WalkMyCode asks once, listing the services it found. The answer is saved with the workspace as a user assertion; the arrows it resolves become solid but are labelled **"you told WalkMyCode"** (a third provenance next to code and config: `Evidence.role: "user"`), never shown as proven by code. The answer can be changed or cleared, and re-indexing keeps it.

   **Built (1 Oct 2026).** `build.ts` finds the setting a request's base is built on four ways: read in the URL (`${import.meta.env.VITE_API_URL}/x`), in a function the URL starts with (`${getApiBaseUrl()}/x`, followed up to four calls deep, same file or imported), in an imported constant, or in the helper the request goes through (`fetchApi("/x")`, whose code reads exactly one base-URL setting). A setting with no value in compose, `.env.example`, a Dockerfile `ENV`, Helm values or a code default, and not a secret or another company's (`serviceForEnv`), is listed in `CodeMap.unresolvedBases` (name, every line that reads it, the services whose requests use it, request and arrow counts, the name heuristic's guess, the answer). The map asks in a bar over the graph (`components/PointsAt.tsx`); Details lists every setting with a control to change or clear the answer, and an arrow resting on one says so. Answers live on `Workspace.assertions` (`{setting, service, answeredAt}`; `service` is an app's id, the setting's stand-in id for "a separate backend I don't have here", or `null` for "an outside service / not sure"); `lib/answers.ts` saves one and builds the map again in the worker from `workspace.files` (which now keep the package files too, as the CLI's `.files.json` does; a redraw whose areas or apps differ from the map it replaces is refused with a message). "Map it" again keeps them for the same folders; the CLI takes `--assume VITE_API_URL=backend` and keeps the answers of the map it overwrites (`--forget` drops them). Two rules: where the URL is visibly built on the setting (in the URL, or an imported constant) an answer is as good as config, so a request that finds no door in the named service draws nothing and says so; where WalkMyCode followed a function to the setting, such a request is drawn as before (the helper may rewrite the path, as iReliabee's `apiUrl` strips `/api`). With no answer nothing drawn before changes: iReliabee's 621 nodes and 1,809 edges keep their ids, confidence and evidence (`tests/pointsat.test.ts` checks the fixtures).

   **Requests that match no route.** A helper's base can also come from the request the helper makes itself (`fetch(`${API_URL}${path}`)`, with `API_URL` a constant bound to a setting and a default). A request that matches no route anywhere, built on a base, is settled after every other request is drawn: when the user named an app for its setting, or every other request on the same base lands in one service, it is a door that service doesn't have (`CodeMap.missingRoutes`, by service, method and path with the calling lines; `certain` when config, or an answer about a URL visibly built on the setting, says where it goes; `likely` when the address is itself a guess, or WalkMyCode worked it out from the other requests), shown as "Called but not found in <service>" in that service's Details and told to the AI. Otherwise it gets one dashed `uses-service` arrow: to a stand-in placeholder named after a setting with no value (`ServiceDef.setting`; "a separate backend I don't have here" in the question makes these solid), or to where a value from config or code points when that is outside or a host whose code isn't here. A `uses-service` arrow, not `calls-route`, because a `calls-route` must end on a route (Part A). A literal path that names a file in the caller's `public/` or `static/` folder is a file the app serves (`stats.assets`): no route, no warning; the folder readers list those files by path only, apart from the code files' limit.

3. **"Whose address is this?"** A request can go to a public address that is one of the workspace's own apps, deployed: a web app's `NEXT_PUBLIC_API_URL=https://api.example.com` names the backend in the next folder. WalkMyCode never takes the address for that app by itself: its requests stay guesses by path until the app's own deploy config gives it the address, or the user says whose it is.

   **Built (1 Oct 2026).** Every request whose address, read the way §5 reads its base (a literal URL, a setting's value from compose, `.env.example`, a Dockerfile `ENV`, Helm or a code default, a constant, the function or helper it goes through, a rewrite), is a public dotted host (not a company WalkMyCode knows, not this machine or a private network, not a name config gives a service) is listed in `CodeMap.publicHosts`: the host and its origin, where it is set (`setAt`), the services whose code calls it, request and arrow counts, how many of its requests each app's routes answer (`matches`), and a `guess` when one app answers more than half of the requests that have a path to match and at least twice as many as any other app. With no answer and no deploy config nothing drawn changes; an outside card for a guessed host says "an address on the internet: is it one of yours?". The bar over the map asks "Is https://api.example.com your backend? 519 requests match its routes", the guess first, then the other apps, "Another company's service" and "Not sure" (both `service: null`); Details lists such addresses with a control to change or clear the answer, and an arrow resting on one offers it too. Answers live on `Workspace.assertions` beside the setting answers: `{setting: <host>, host: <host>, service, answeredAt}` (a key with a dot is an address; answers saved before keep loading as setting answers), and the redraw goes through the worker as in 2. The CLI takes `--assume api.example.com=backend` (`=outside` for another company's / not sure) and `--forget` drops these answers too.

   **The service's own deploy config says it, so nothing is asked.** A CI step that health-checks the address after deploying (`curl -sf https://api.example.com/` in `.github/workflows/*.yml` or `.gitlab-ci.yml`; also `environment: url:` and a health-check action's `url:`), a Caddy site, nginx `server_name`, a Traefik `Host()` label on a compose service, an Ingress host or HTTPRoute hostname, `fly.toml` (`<app>.fly.dev`), `render.yaml` / `app.yaml` `domains`, `vercel.json` `alias` or a `CNAME` file gives a service its public address (`ServiceDef.addresses`, and `hostnames`), cited by that line with `role: "config"`. The address is the service's when the config says where it leads (a compose service, a backend, an upstream), else when the step or file is in the service's folder, else when its repo holds one app; an address two services are given is neither's, with a warning. Only config counts: a README, a comment or a docstring never does, nor a workflow line that only passes the address on as a setting. The folder readers (`scripts/readDir.ts`, `lib/localFolder.ts`) let `.github/workflows` through as config files only, and a workflow is kept only when it names an address; `${{ secrets.X }}` stays as written and anything on a CI line that looks like a key is hidden.

   **Resolved, the address is a config-resolved host of that app** (§5 step 0), whichever way the URL is built. Path matches are certain, citing the request, the line that sets the address (compose:10, the Dart default) and the deploy line, or the user's answer (`role: "user"`, "you told WalkMyCode: <host> is <app>", at the line that sets the address). A literal path no route answers draws nothing and is "Called but not found in <app>" (certain) when the URL is visibly built on the address: in the URL, a constant, or a helper whose own request is `${BASE}${path}`; reached through a function that may change the path, it is drawn as if nobody had said. A request whose path is all variable (`fetch(\`${API_URL}${path}\`)`) draws a `uses-service` arrow to `svc-int:<app>`, the app as a whole, drawn in its callers' lanes; the outside card for the address is gone. The user's answer wins over deploy config: "another company's / not sure" draws what no answer draws. The AI's summary says whose each such address is and how WalkMyCode knows.

   Checked on a private three-repo workspace (a web app, a mobile app and their backend): the backend's deploy workflow smoke-checks its public address and that repo holds one app, so with no answer the web app's requests go from 0 solid / 295 dashed to 250 / 45 and the mobile app's from 0 / 207 to 201 / 6, the address's outside card becomes the backend app, and node and edge ids are unchanged. The other fixtures gain nothing. Reading nginx files also learned to drop a Windows line ending before a comment, which had left a CRLF file's first `server` block unnamed.

## Research notes

## WalkMyCode analyzer
# WalkMyCode analyzer & map model — audit for monolith + microservice support

Scope read in full: src/analyzer/{types,parser,facts,build}.ts, src/analyzer/extract/{common,js,py}.ts, src/lib/store.ts, src/components/MapView.tsx, src/app/map/page.tsx, scripts/index.ts, docs/PLAN.md, plus src/lib/localFolder.ts, src/lib/claude/{tools,prompts,client}.ts, src/components/{Inspector,Guide,FileTree,CodeView}.tsx, src/app/page.tsx, src/app/api/{claude,demo}/route.ts, globals.css. Findings marked CONFIRMED were reproduced by running the real `buildMap`/extractors on a two-service fixture (web + services/users + services/orders, each with its own package.json) and by inspecting the indexed iReliabee map (.walkmycode/ireliabee.map.json).

## 1. How areas are detected (build.ts)
- `MANIFESTS` (build.ts:27) = package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, composer.json, Gemfile. `manifestDirs` = directory of every manifest not under `SKIP_DIRS` (build.ts:132-133).
- `areaOf(path)` = the *longest* manifest dir that prefixes the path (build.ts:134-138). Files under no manifest dir get `opts.name` when there is a root manifest (or none at all), else the literal `"root"` (build.ts:137). `map.areas` = sorted set of areas of *parsed* files only (build.ts:369-374, 616).
- Area is used for: `@/`/`~/` alias resolution to `${area}/src | ${area} | ${area}/app` (build.ts:236-244); Python absolute-import roots (build.ts:267-270); `frontendAreas` (any JSX file in the area, or a package.json mentioning react/vue/svelte/next/angular/solid — build.ts:369-381); `layerOfFile` heuristics (build.ts:390-405); display name strips the area prefix (build.ts:384-389); `node.area` (build.ts:413, 419, 429); the ambiguity note when hits span >1 area (build.ts:565, 572). Nothing in route matching, table naming or service naming is area-aware.
- What never reaches the analyzer: the folder readers keep only `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.py/.sql/.prisma` plus package.json/pyproject.toml/requirements.txt/Cargo.toml/go.mod (localFolder.ts:6, scripts/index.ts:13). So composer.json/Gemfile in MANIFESTS never arrive, and docker-compose.yml, Kubernetes/Helm YAML, wrangler.toml, Dockerfile, `.proto`, openapi.json/yaml, `.env.example` are never read; even if passed in, `langOf()` returns null and they are dropped before parsing (build.ts:152). CONFIRMED: the fixture's docker-compose.yml with `users-service`/`orders-service` had no effect.
- iReliabee (indexed): areas = backend, frontend, root, website; "root" holds 4 nodes of loose scripts. Areas are *package* boundaries, not service boundaries: a repo with one root package.json and `services/*` without per-service manifests collapses into one area; a nested `frontend/src-tauri/Cargo.toml` would split one app into two areas.

## 2. Cross-area HTTP calls → routes
Extraction (facts.ts:40-48 `HttpCallFact{url with * per interpolation, method?, fromVariable}`):
- JS (js.ts:344-349): `obj.get/post/put/patch/delete/del/request/fetch(url…)` where url starts with `/`, `http(s)://`, `ws(s)://` or `*`; bare helpers matching `HELPER_RE` (js.ts:8: fetch, *fetch*, api*, request*, http*, call*, hosted*, get/post/put/patch/del/delete, ky, got) at js.ts:352-361; `new WebSocket/EventSource` js.ts:363-370. URL text via `urlText` js.ts:20-44 (template substitutions → `*`, string concatenation handled).
- Python (py.ts:230-237): `requests|httpx|aiohttp|session|client|http|urllib3|_client|self.client` `.get/post/put/patch/delete/request/stream/head`, plus `urlopen/Request` (py.ts:245-248); `urlOf` py.ts:28-58 handles f-strings, concatenation, `.format`.
Matching (build.ts:523-582):
- `callSegments(url)` (build.ts:84-100): pulls `host` = anything after `scheme://` up to `/?#` (lowercased) — *any* host, including `users-service:8080` or `*`; splits the path on `/`, drops the query, any segment containing `*` → `*`.
- `routeSegments(path)` (build.ts:74-78): `{x}`, `[x]`, `:x`, `<x>`, `*x` → `*`.
- `leadingVar = h.fromVariable || !!host` (build.ts:540): every absolute URL is treated as "starts with a variable".
- `matchRoute(callSegs, routeSegs, leadingVar)` (build.ts:102-123): if leadingVar, try dropping 0..min(len,3) leading call segments (suffix alignment); lengths must then be equal; literal==literal +2, `*` on either side +1, mismatch fails; needs score>0; returns score−drop.
- Candidates = **all `routeNodes` in the whole map** (build.ts:543), filtered only by method (build.ts:544; `ANY` routes and method-less calls match everything). Best score wins, ties keep every hit (build.ts:547-551). Then: no hits → §3; `distinctPaths>1 || areasHit>1` → `likely` + note (build.ts:563-577); calls whose segments are all `*` are dropped silently (build.ts:578); one `calls-route` edge per hit (build.ts:579). Edge ids are `${kind}:${from}->${to}` (build.ts:438) so several call sites merge into one edge with appended evidence.
- CONFIRMED fan-out: `fetch("/health")` in web drew two dashed arrows, to users-service `GET /health` *and* orders-service `GET /health` ("More than one route matches this path"). Any shared path (`/health`, `/metrics`, `/api/v1/...`) fans out to every service. iReliabee only looks clean because it has 0 route paths shared across areas (281 cross-area calls-route edges; 143 marked likely for "couldn't tell the HTTP method").
- CONFIRMED misleading note: a literal internal host (`"http://users-service:8080/users/" + id`) matched users-service `GET /users/:id` but only as `likely` with the note "The URL starts with a variable" because `leadingVar` is also true for any host (build.ts:540, 568-571).
- CONFIRMED bug (js.ts:26-32): in `urlText` for template literals the first child is the opening backtick, which sets `first=false` before the substitution is seen, so `` `${process.env.USERS_SERVICE_URL}/users/${id}` `` yields `fromVariable:false`. Then no suffix alignment is tried, `["*","users","*"]` vs `["users","*"]` differ in length, and the call is reported "matched no route". Python f-strings (py.ts:12-26) and JS concatenation are correct. This is the canonical microservice call shape.
- No gateway/rewrite model: `/api/users/1` (client) vs users-service route `/users/:id` can never match without a leading variable (no drop → length mismatch). iReliabee's own client helper strips `/api` (frontend/src/lib/api.ts:75-80); nginx/ingress/Next `rewrites` are invisible.
- Container of a call (`containerAt`, build.ts:454-468): the route whose line span covers the call, else the file node. Express routes span only the `app.get(...)` statement (js.ts:302-309), and a route-only file whose handlers are non-exported named functions gets **no file node** (build.ts:412), so HTTP/SQL facts in `function createOrder(){…}` are dropped with `if (!from) continue` (build.ts:529, 587, 599). CONFIRMED: first fixture run produced zero edges out of the handlers; inline arrow handlers work. FastAPI is unaffected because py.ts:185 spans the whole decorated function — which is why iReliabee looks complete.

## 3. How unknown hosts become service nodes
- Known third parties: `HOST_SERVICES` (common.ts:45-80, `serviceForHost` 154-158), `PACKAGE_SERVICES` via imports (common.ts:82-129; js.ts:116-117, 141-142; py.ts:111-118, 134-135), `ENV_SERVICES` via env reads (common.ts:131-152; js.ts:389-402; py.ts:239-244, 250-256; env-only → `likely` with a note, build.ts:596-603). `hostsIn` (common.ts:174-179) requires a dotted host with a ≥2-letter TLD, so bare container names (`ireliabee-web:8002`, `users-service`) are never seen as hosts in string scanning.
- In the HTTP path: known host → `uses-service` certain and skip route matching (build.ts:532-539). Unknown host → try routes (with leadingVar); if nothing matches and the host is not localhost/127.0.0.1/0.0.0.0 (build.ts:553) → **a new external service node named by the raw host** (`svc:users-service-8080`, name `users-service:8080`, area `""`, build.ts:555-556). CONFIRMED on the fixture. Inspector then calls it "outside service — another company's API" (Inspector.tsx:26), MapView puts it in the Outside services lane, and `mapSummary` lists it under "Outside services" for Claude (prompts.ts:35). localhost calls with no route are only counted as unmatched (build.ts:557-560). Service nodes are global with `area:""` (build.ts:536, 555, 600).
- `USERS_SERVICE_URL`-style env vars produce no fact at all (CONFIRMED `services: []`): `serviceForEnv` only knows the third-party prefixes.

## 4. What CodeMap can and cannot express (types.ts)
- `MapNode` (types.ts:30-46): `layer` ∈ ui|api|logic|data|external (types.ts:4), `kind` ∈ component|module|route|table|service (types.ts:33), one `area: string` (types.ts:37), file/line, route method/path/handler. No `service`, `repo`, `host`, `port`, `env`, no "internal service" kind, no grouping/hierarchy, no system-level node.
- `MapEdge` (types.ts:48-61) kinds imports|calls|calls-route|reads|writes|defines|uses-service (types.ts:12-19). No publishes/consumes (queues, topics), no rpc (gRPC), no proxies/rewrites (gateway), no "same DB" evidence; `Evidence.file` is a bare repo-relative path (types.ts:22, 87).
- `CodeMap` (types.ts:74-84): single `name`, flat `areas: string[]`, `files[]` with `area`; `version: 1`.
- Can express today: a monorepo of packages, and a call from a route/component in area A to a route in area B (the client can infer "cross-area" from `node.area` on both ends).
- Cannot express: which areas are services vs shared libraries; hostnames/ports/env names per service; a service's own database — tables are global `table:${name.toLowerCase()}` (build.ts:424) with `area` = whichever file mentioned it first (build.ts:364-368, 429). CONFIRMED false shared-DB arrow: orders-service's `INSERT INTO users` drew a `writes` edge to users-service's `users` table. Cannot express several repos: `file:${path}` ids (build.ts:383), `nodeAt` (store.ts:87-94), `read_file`/`search` (tools.ts:118-145) and citations (Guide.tsx:29) all key on the bare path, so `src/index.ts` in two repos collides. Route ids `route:${file}#${METHOD} ${path}` (build.ts:418) are per-file, so same paths in different services do *not* collide (good).

## 5. Layout / lanes
- `LANES` fixed at five (MapView.tsx:40-46); constants CARD_W 220, CARD_H 46, GAP_X 260, LANE_GAP 90, PER_COLUMN 40 (MapView.tsx:47-51).
- Per lane (MapView.tsx:112-125): nodes with that layer, sorted by area then name (113); `cols = clamp(ceil(n/40),1,3)` (114); `rows = ceil(n/cols)`; card at `x = laneX + col*260, y = row*56` (122); lane header at y −60 (116); next lane `x += cols*260 − 40 + 90` (124). Pure column stacking: no swimlane per area, no compound/group nodes, no service boundary; `area` shows only in the card subtitle (MapView.tsx:69) and sort order. Edges are smoothstep (135); dashed when `likely` (137).
- Visibility: focus = 2-hop `neighbourhood` (MapView.tsx:96-100, store.ts:97-120); imports hidden unless toggled (104). `trace` (store.ts:123-145) walks by layer order ui0/api1/logic2/data3/external3 with depth ≤4 (store.ts:129) — a UI→gateway→svcA→svcB→module→table chain exceeds it.
- Workspace: `.work` is a fixed CSS grid `minmax(0,1.25fr) minmax(0,1fr) minmax(320px,420px)` (globals.css:118), collapsing to two columns under 1200px with the guide across the bottom at 40vh (globals.css:120). page.tsx hard-codes three `<section>`s (page.tsx:186-246); Guide/Details/Files is a `tab` state (page.tsx:31, 233-245). No resize handles, docking, floating, pop-out or persisted arrangement. MapView refits only on `window` resize (MapView.tsx:146-154), not on container resize — a dockable shell needs a ResizeObserver. `.maptools`/`.legend` are absolutely positioned inside the map panel (globals.css:139, 141).

## 6. Every place that assumes "one repo, one app"
- store.ts:7-11 `Repo = {map, files, source:{kind:"local"|"demo", label}}` — one map, one file dict; single IndexedDB slot `"repo"` (store.ts:52-55, 59-77).
- localFolder.ts:16-28 one directory handle; MAX_FILES 4000 total (line 8); the webkitdirectory fallback strips the first path segment as "the folder" (localFolder.ts:52-55).
- src/app/page.tsx:26-48 `analyse(name, files)` → one `buildMap` → `setRepo`; label = folder name (42); `loadDemo(name)` one indexed repo (59-70); map page header shows one `repo.source.label` and "change repo" replaces rather than adds (map/page.tsx:171, 182).
- scripts/index.ts:33-36 one dir, one name → `.walkmycode/<name>.map.json` + `.files.json` (48-55); api/demo/route.ts:10-19 serves one name.
- build.ts:11-16 `BuildOptions.name` single; fallback area = `opts.name` (137); `map.name` (612-616); `SourceFile.path` repo-relative with no repo prefix (types.ts:86-89); file-based route detection matches `app/**/route.ts`, `pages/api/**`, `functions/**` anywhere (build.ts:201-228), so two Next apps in one monorepo produce identical route paths that fan out; `@/` alias assumes one `src` root per area (236-244).
- prompts.ts:28-30 "# Repo: name / Areas (packages)"; tools.ts:21 example path, 35 `path_prefix`, 52 `list_files` from "/"; Guide.tsx:29 citation regex is path-only.
- MapView.tsx:40-46 five lanes, no system view; Inspector.tsx:19-32 has no wording for an internal service.
- README.md:3,7 and PLAN.md "Connect" (line 20-21) describe one folder/repo. Accounts: none anywhere — api/claude/route.ts:14-18 accepts any POST on the server key; cost.ts is per-tab memory; store.ts per-browser.

## 7. Concrete gaps for microservice codebases (ordered by impact)
1. No service-boundary source: compose/k8s/wrangler/Dockerfile/.proto/openapi files are neither read (localFolder.ts:6, scripts/index.ts:13) nor parsed (build.ts:152). Needs a `ServiceFact {name, dir/area, hostAliases, ports, envVars}` extractor and a `services` section in CodeMap.
2. Internal hosts become "outside services" in the External lane with third-party wording (build.ts:553-556; Inspector.tsx:26; prompts.ts:35). Needs an internal-service kind (or `area` resolution from host alias) and a distinct lane/colour.
3. Env-var base URLs are invisible (js.ts:389-402, py.ts:239-244 only know third-party prefixes) and the template-literal `fromVariable` bug (js.ts:26-32) makes `` `${BASE}/path` `` unmatched. Fix the bug (test `first` before the backtick iteration) and record `*_URL`/`*_HOST`/`*_ENDPOINT` env reads as base-URL facts tied to a service.
4. Route matching has no service affinity (build.ts:543-551): with a known host/env/service, restrict candidates to that service's routes and grade `certain`; only fan out when the target is truly unknown. Also drop the "starts with a variable" note for literal hosts (build.ts:540, 568-571).
5. Tables are global (build.ts:424-431) → false shared-database arrows across services. Scope table ids by area/database (e.g. `table:${area}/${name}`) unless a shared schema/connection string proves sharing; carry the DB identity on the node.
6. Express/Fastify named handlers lose all HTTP/SQL evidence (js.ts:302-309 route span, build.ts:412 no file node, 454-468, 529). Extend a route's span to its handler function (`handler` is already recorded) or always add the file node.
7. Gateway rewrites and prefix stripping (nginx/ingress/Next `rewrites`, client helpers like iReliabee's `apiUrl`) are not modelled in `matchRoute` (build.ts:102-123).
8. No queue/topic/gRPC edge kinds (types.ts:12-19): Kafka/RabbitMQ/SQS/BullMQ producers and consumers and `.proto` services are invisible, so async service links never appear.
9. Multi-repo workspace: ids, file dict, `nodeAt`, citations and tools all key on bare paths; the store holds one repo. Prefix each repo's paths (`<repo>/…`) or add a `repo` field, and make the store a workspace of repos (store.ts:7-11, 52).
10. No system view: MapView is lane-only. A first cut can be derived client-side by aggregating `calls-route`/`uses-service` edges by (from.area → to.area) since `area` is already on every node and the ambiguity note already flags `areasHit>1`; drill-in reuses the current lanes filtered by area. Raise the trace depth (store.ts:129).
11. Area detection from manifests only (build.ts:132-138): `services/*` without per-service manifests merge; nested manifests split. Service definitions from (1) should override/define areas.
12. `Evidence.file` and node ids carry no repo qualifier (types.ts:22, 87) — required before two repos can share a map.

Notes on the other two requirements: docking/resizing touches only page.tsx:186-246 + globals.css:118-120 today (no layout state exists to persist), and MapView.tsx:146-154 must refit on container rather than window resize. Registration has no footprint in the code yet (no accounts, sessions or per-user storage anywhere); iReliabee's email-code flow is the intended reference per PLAN.md:67-70.
Key facts:
- Areas = directories of manifest files (package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, composer.json, Gemfile) — build.ts:27, 132-138; areaOf = longest matching manifest dir, fallback opts.name or "root" (build.ts:137). Areas are package boundaries, never service boundaries.
- The folder readers only keep source files plus 5 manifest names (localFolder.ts:6, scripts/index.ts:13); docker-compose.yml, k8s YAML, wrangler.toml, Dockerfile, .proto and openapi files are never read, and build.ts:152 drops anything langOf() can't classify. CONFIRMED: a docker-compose.yml in the sources had no effect.
- HTTP-call matching (build.ts:523-582): callSegments (84-100) splits scheme://host/path; matchRoute (102-123) requires equal segment counts after dropping up to 3 leading call segments when leadingVar; leadingVar = fromVariable || !!host (540); candidates are ALL route nodes in the map (543) filtered only by method (544).
- CONFIRMED fan-out: fetch("/health") from a web area draws dashed edges to every service's GET /health ("More than one route matches this path", build.ts:572-577). iReliabee looks clean only because none of its 277 routes share a path across areas.
- CONFIRMED bug js.ts:26-32: template literals starting with ${…} report fromVariable:false because the opening backtick child sets first=false; `${process.env.USERS_SERVICE_URL}/users/${id}` therefore matches no route. Python f-strings (py.ts:12-26) and JS string concatenation are handled correctly.
- CONFIRMED: an unknown non-localhost host with no route match becomes an EXTERNAL service node named by the raw host (build.ts:553-556, e.g. svc:users-service-8080), shown in the Outside services lane and described as "another company's API" (Inspector.tsx:26) and listed to Claude under Outside services (prompts.ts:35). Known hosts/packages/env prefixes are only third parties (common.ts:45-152); hostsIn (common.ts:174-179) needs a dotted TLD so container names are never seen in strings; *_SERVICE_URL env vars produce no fact.
- CONFIRMED: tables are global ids `table:<lowercase name>` (build.ts:424-431) with area = first file that mentioned them; orders-service's INSERT INTO users drew a writes edge to users-service's table — a false shared-database arrow.
- CONFIRMED: Express routes span only the app.get(...) statement (js.ts:302-309) and a route-only file with non-exported named handlers gets no file node (build.ts:412), so containerAt (454-468) returns null and every HTTP/SQL fact in those handler bodies is dropped (build.ts:529, 587, 599). FastAPI is unaffected (py.ts:185 spans the whole decorated function).
- A literal internal host still gets the note "The URL starts with a variable" and confidence likely, because leadingVar is true for any absolute URL (build.ts:540, 568-571).
- CodeMap types (types.ts): MapNode has one `area: string`, kinds component|module|route|table|service, layers ui|api|logic|data|external; MapEdge kinds imports|calls|calls-route|reads|writes|defines|uses-service; Evidence.file is a bare repo-relative path; CodeMap has one `name` and flat `areas: string[]`. No service/repo/host/port fields, no internal-service kind, no queue/gRPC/gateway edge kinds, no grouping.
- Route ids `route:<file>#<METHOD> <path>` (build.ts:418) are per-file, so identical paths in different services do not collide — the one piece already safe for microservices. Service node ids `svc:<slug>` (build.ts:432) and table ids are global.
- Layout (MapView.tsx:108-125): five fixed lanes (40-46); per lane nodes sorted by area then name, cols = clamp(ceil(n/40),1,3), x = laneX + col*260, y = row*56, lane x advance = cols*260-40+90. No per-area swimlanes or group nodes; area only appears in the card subtitle (69). Trace depth is capped at 4 hops (store.ts:129).
- Workspace is a fixed CSS grid `minmax(0,1.25fr) minmax(0,1fr) minmax(320px,420px)` (globals.css:118; 2-column fallback at 120) with three hard-coded sections in map/page.tsx:186-246 and a tab state for Guide/Details/Files (page.tsx:31). No resize, dock, float or persisted layout; MapView refits on window resize only (MapView.tsx:146-154).
- One-repo assumptions: store.ts:7-11 Repo{map, files, source} with single IndexedDB key "repo" (52); localFolder.ts:16-28 one directory handle, MAX_FILES 4000 (8); src/app/page.tsx:26-48 analyse(name, files) → one buildMap; scripts/index.ts:33-36 one dir → .walkmycode/<name>.map.json; api/demo/route.ts:10-19 one name; build.ts BuildOptions.name (11-16), map.name (612-616); prompts.ts:28-30 "# Repo"; tools.ts:21,35,52 bare paths; Guide.tsx:29 path-only citations; map/page.tsx:171,182 one source label and "change repo".
- No accounts exist anywhere: api/claude/route.ts:14-18 accepts any POST on the server's ANTHROPIC_API_KEY, cost.ts is per-tab memory, store.ts is per-browser IndexedDB. PLAN.md:67-70 designates iReliabee's email-code sign-in as the reference.
Pitfalls:
- Do not treat `area` as a service: it is the nearest manifest directory. A repo with one root package.json and services/* subfolders is ONE area; a nested src-tauri/Cargo.toml splits one app into two.
- Fixing the js.ts:26-32 template-literal bug alone will make `${BASE}/path` calls start matching — by suffix alignment against EVERY service's routes, so without service affinity it will increase fan-out guesses, not reduce them. Ship the fix together with host/env→service resolution.
- Internal hostnames (docker service names, k8s DNS, env base URLs) currently land in the Outside services lane as 'another company's API'. Any system view must reclassify these before they teach a beginner that their own service is a third party.
- Scoping tables per service will change every table node id (`table:<name>` today); anything that persists node ids (tour node_ids in Claude history, IndexedDB-mirrored maps, .walkmycode/*.map.json) will break unless version is bumped from 1 (types.ts:75) and old maps are re-indexed.
- Express/Fastify services with `router.get('/x', handler)` and separately defined handlers lose all HTTP/SQL evidence today; a microservice test set built only on FastAPI (like iReliabee) will not reveal this. Add a Node/Express service to the hand-checked test set.
- Route matching considers every route in the map regardless of area (build.ts:543). Restricting candidates by service must fall back to the current global search when the target host is unknown, or existing monolith maps will lose edges.
- Merging several repos by concatenating SourceFile lists without prefixing paths will silently collide node ids (`file:src/index.ts`), file contents in `repo.files`, `nodeAt`, `read_file` and citations. Prefix paths or add a repo field before building a multi-repo map.
- Dropping the query string and treating any `*`-containing segment as a wildcard (build.ts:93-98) means `/api/*` catch-all calls score against everything; the all-`*` guard (578) only stops fully variable URLs.
- The dockable shell cannot just wrap the existing sections: MapView refits on window resize only (MapView.tsx:148-149) and .maptools/.legend are absolutely positioned inside the map panel (globals.css:139,141); CodeView rebuilds its editor on path/content change (CodeView.tsx:91-129) so undock/redock must keep the same React element or it loses scroll/selection.
- PLAN.md promises `docs/SERVICES.md`, `docs/SHELL.md` and `docs/ACCOUNTS.md` but the docs folder only holds PLAN.md and PROVIDERS.md — none of the three designs exists yet.
- hostsIn (common.ts:176) only recognises hosts with a dotted TLD, so a future 'internal host' detector must not reuse it; callSegments (build.ts:87) does capture bare hosts and ports and is the right hook.
- Trace depth is capped at 4 hops (store.ts:129); a UI → gateway → service A → service B → module → table path will be cut short in 'Trace it' once cross-service edges exist.

## Service detection research
## Catalogue of service-boundary and inter-service link heuristics for WalkMyCode (researched 30 Sep 2026)

Every heuristic below lists: what file/syntax to read → what it yields → the evidence to attach (file:line on both the code side and the config side where possible) → confidence under WalkMyCode's existing rule (certain = resolved exactly; likely = pattern match, drawn dashed with a note; no evidence = no arrow).

### A. Finding the boundaries (what counts as a "service")

**A1. Docker Compose (`docker-compose.yml`, `compose.yaml`, `compose.yml`, `docker-compose.override.yml`, `docker-compose.*.yml`)** — verified against docs.docker.com.
- `services:` keys → one service node per key. Compose registers each service name in its internal DNS, so *the service name is the hostname* other containers use. Evidence: the `services.<name>:` line. **certain**.
- `build.context` (or `build:` string) → binds the service to a folder (an existing WalkMyCode "area"). Evidence: that line. **certain**. `image:` without `build:` → infrastructure/external node; classify by image name (`postgres|mysql|mariadb|mongo` → database, `redis` → cache/broker, `kafka|redpanda|rabbitmq|nats|activemq` → broker, `nginx|traefik|kong|envoy` → gateway). **certain** for the node, **likely** for the classification of an unknown image.
- `ports: HOST:CONTAINER` → service-to-service traffic uses the CONTAINER port; the HOST port is what `http://localhost:HOST` in front-end dev code means. So `fetch("http://localhost:8000/…")` ↔ service publishing `8000:xxxx` → **likely** (note: "matched by the published port").
- `depends_on` (short list, or long form with `condition: service_started|service_healthy|service_completed_successfully`) → `depends-on` edge. **certain** that the dependency is declared, but it is *startup order*, not proven traffic; draw it thin/grey and never as a "calls" arrow.
- `environment:` / `env_file:` → a **config value table**: `USERS_SERVICE_URL=http://users:8080` links var name → hostname → service. Evidence: the env line in compose + the `process.env.USERS_SERVICE_URL` line in code. **certain** when the value is literal and the host is a known service; `${VAR}` interpolation without a default → unresolved.
- `networks.<n>.aliases`, `links: [svc:alias]`, `hostname:`, `container_name:` → extra hostnames for the same service. **certain**.
- Multiple compose files: merge base + override; profiles may hide services — record but don't drop.

**A2. Kubernetes manifests (`*.yaml` with `apiVersion`/`kind`)** — verified against kubernetes.io.
- `kind: Service` → hostnames `name`, `name.namespace`, `name.namespace.svc.cluster.local` (and any cluster domain); `spec.ports[].port` is the port clients dial (`targetPort` is the pod's). **certain**.
- Kubelet also injects `{SVCNAME}_SERVICE_HOST` / `{SVCNAME}_SERVICE_PORT` (name upper-cased, dashes → underscores). Reading such an env var in code → service by name. **certain** on the name form.
- `kind: Ingress` → `rules[].host` + `http.paths[].path` + `pathType` + `backend.service.name/port` → a **gateway route table**: external path prefix → service. **certain**. (Gateway API `HTTPRoute` is the newer equivalent — same shape, unverified in this pass.)
- `kind: Deployment|StatefulSet|DaemonSet|Job|CronJob` → `spec.template.spec.containers[].image` + `env[]`. Binding a Deployment to a *folder* goes image → Dockerfile/`build` → folder, which is only **likely** unless compose or a CI file names the build context. `env[].value` literal → config table (**certain**); `valueFrom.configMapKeyRef` → follow to `kind: ConfigMap` `data` if present (**certain**), `secretKeyRef` → never read; unknown otherwise.
- Selector → pod labels tells which Service fronts which Deployment. **certain** when labels match exactly.
- **Helm**: `templates/*.yaml` are Go templates (`{{ .Values.x }}`), *not* parseable YAML — do not YAML-parse them. Read `Chart.yaml` (`name`, `dependencies[].name/condition`) and `values.yaml` (keys ending `url|host|baseUrl|endpoint`) → **likely** only, with note "from a Helm values file". Kustomize `kustomization.yaml` `resources:` lists real YAML files → parse those normally.

**A3. Monorepo / workspace tools** (extend the current manifest-dir "areas").
- npm/yarn/bun: root `package.json` `workspaces` globs; **pnpm**: `pnpm-workspace.yaml` `packages:` globs (pnpm ignores the package.json field). Every matched dir with a `package.json` is a package. **certain**.
- Turborepo convention: `apps/*` = deployable apps/services, `packages/*` = libraries; `turbo.json` is task config only. Use the folder convention as a **likely** app-vs-library hint; a package with routes/JSX/`main`+`start` script is an app (**certain** by content).
- Nx: `project.json` per project (or an `nx` key in package.json); `implicitDependencies` (supports globs and `!negation`), `tags`. Nx infers the rest from imports — the same thing WalkMyCode already does. **certain** for declared deps.
- Internal package edges: a dependency `"@acme/users-client": "workspace:*"` (or any version) whose name matches a workspace package `name` → area→area `imports` edge. **certain**.
- Cargo: `[workspace] members = [globs]` (root or virtual manifest), each member `Cargo.toml` `[package].name`; `path = "../x"` deps → certain edges. Go: `go.mod` `module` path per directory; `go.work` `use ./dir` (rarely committed — fall back to scanning for multiple `go.mod`); an import path prefixed by a sibling module's path → **certain** edge.
- Python: `pyproject.toml`/`requirements.txt` per folder (existing); `uv` workspaces (`[tool.uv.workspace] members`) — unverified in this pass.

**A4. Multi-repo workspaces**: when the user connects several folders/repos, each root is one "system"; union the config tables across them so `USERS_SERVICE_URL` in repo A resolves to the compose service in repo B. Unmatched hostnames become "a service I can't see" placeholder nodes (**likely**), never external SaaS.

**A5. Dockerfile**: `EXPOSE <port>`, `ENV K=V`, `CMD`/`ENTRYPOINT` (`uvicorn app.main:app`, `node server.js`) → which folder is a runnable service and its port. **certain** for the port; the entrypoint is a good "start here" pointer for the tour.

**A6. Declared catalogues (human-maintained; treat as labels and cross-checks, not observed edges)**
- Backstage `catalog-info.yaml`: kinds `Domain > System > Component | API | Resource`; Component `spec.type` (service/website/library), `providesApis`, `consumesApis`, `dependsOn`, `system`; API `spec.type` openapi|asyncapi|graphql|grpc with `definition`. Relations are deduced from these fields.
- Atlassian Compass: component types (service, library, application, capability, cloud resource, data pipeline, ML model, UI element, website, dataset, dashboard, data product, other); dependencies are *manually* added ("Depends on" / "Contains") in the UI or config-as-code; no automatic code detection is documented; limits 25 out / 100 in.
- Structurizr DSL `workspace.dsl`: `person`, `softwareSystem { container { component } }`, `a -> b "description" "technology"`; views systemLandscape/systemContext/container/component/dynamic/deployment.
- Recommendation: show declared deps as a third visual state, e.g. **"declared"** (dotted-grey, note "the team wrote this in catalog-info.yaml; I did not see it in code"), or map to `likely` with that note. Use System/Domain names to *group* services on the system view.

### B. Links between services

**B1. HTTP by hostname** — literal `http://users:8080/api/x`, `http://users.default.svc.cluster.local/x`, or an alias from A1/A2 → route the call to *that* service's routes only, then match by path with the existing `matchRoute`. **certain** when host + path resolve; **likely** when only path. Today build.ts:553 turns `users:8080` into an *outside-service* node because `serviceForHost` doesn't know it — this must be intercepted before that fallback. `hostsIn` in common.ts requires a dotted TLD, so compose hostnames are invisible to `serviceFacts` too.

**B2. Env-var base URLs** — collect the var name at the call site (`process.env.X`, `import.meta.env.VITE_X`, `os.environ["X"]`, `os.getenv("X")`, pydantic `settings.X`, `config("X")`), store it in `HttpCallFact` (add `varName`), then resolve through the config table (compose env, k8s env/ConfigMap, Dockerfile ENV, `.env.example`/`.env.sample`/`.env.template` values, `next.config` `env`). Resolved to a known service → **certain** (evidence: code line + config line). Unresolved but the name matches `^(?:NEXT_PUBLIC_|VITE_|REACT_APP_)?([A-Z0-9]+?)_(SERVICE_)?(URL|HOST|BASE_URL|ENDPOINT|API_URL|API)$` and the stem (`USERS`) equals/normalises to a service name (`users`, `users-service`, `user_service`) → **likely** with note "matched by the setting's name". Otherwise: unresolved → warning, no arrow. Twelve-Factor "backing services" confirms this is the dominant convention: services are addressed by a URL/locator in config.

**B3. Gateways and rewrites** — a two-hop resolution: browser calls `/api/users/1` → gateway table → service route.
- Next.js `next.config.*` `rewrites()` (array or `{beforeFiles, afterFiles, fallback}`): `source` (path-to-regexp: `:param`, `:path*`) → `destination` (internal path or external URL, `basePath: false`). External destination host → service. **certain** table; a call through it is **certain** if both hops are literal, else **likely**.
- Vite `server.proxy`, CRA `"proxy"`, Angular `proxy.conf.json`, Nuxt `nitro.devProxy`; nginx `location /x/ { proxy_pass http://upstream_or_host[/uri/]; }` (with-URI form replaces the matched prefix; `upstream name { server host:port; }` blocks resolve names) → same table. Traefik/Kong/Envoy/AWS API Gateway configs are heavier — **likely** at best, out of MVP.
- Only draw one arrow for the beginner: `Button → /api/users → (via gateway) → users: GET /users/:id`; keep the gateway hop as an evidence line, not a box, unless the user opens the system view.

**B4. OpenAPI / Swagger** (`openapi.(json|yaml)`, `swagger.(json|yaml)`, `**/openapi/**`, `api-docs`): `paths` × `get|post|put|patch|delete|options|head|trace`, `{param}` templates, `operationId`, `servers[].url` (may carry `{variables}`). Yields route nodes for a service *without parsing handlers* (file = the spec) — **certain** that the route exists, handler unknown. Reconcile with parsed handlers: handler wins when both exist; spec-only routes get a note "described in openapi.yaml, I did not find the code". Generated clients (openapi-typescript, orval, openapi-generator, @hey-api, Swagger Codegen): a call to `operationId`-named function → route. **likely** (codegen naming varies).

**B5. gRPC** (`*.proto`): `service X { rpc Y (Req) returns (Res); }` (+ `stream` keyword for the four RPC kinds) → rpc-service node with methods. **certain**. Server side: Python `xxx_pb2_grpc.add_XServicer_to_server(...)`, `server.add_insecure_port('[::]:50051')`; Node `server.addService(pkg.X.service, {...})`, `server.bindAsync('0.0.0.0:50051')`; Go `pb.RegisterXServer(s, ...)` → "this service implements X" **certain**. Client side: Python `grpc.insecure_channel('users:50051')` + `XStub(channel)`; Node `new pkg.X('host:port', creds)` after `protoLoader.loadSync('x.proto')`; Go `pb.NewXClient(conn)` with `grpc.Dial(addr)` → `calls-rpc` edge to the implementer. Target = host (B1/B2) when literal; else the single service that implements X (**certain** if exactly one implementer, **likely** otherwise). Skip parsing generated files (`*_pb2.py`, `*_pb2_grpc.py`, `*_pb.js`, `*_grpc_pb.js`, `*.pb.go`) but keep their names as evidence.

**B6. Message brokers — producer/consumer by channel name** (channel = topic/queue/subject/exchange+routingKey). Add node kind `channel` and edge kinds `publishes` / `consumes`; the service→service link is *derived* through the channel (draw it on the system view only when there is exactly one producer and one consumer, as **likely**; otherwise show the channel box).
- Kafka: kafkajs `producer.send({ topic })`, `consumer.subscribe({ topic | topics })`, `new Kafka({ brokers })`; confluent-kafka `Producer(...).produce(topic=…)`, `Consumer(...).subscribe([...])`; aiokafka/kafka-python same names (unverified this pass). Literal topic → **certain**; topic from a variable/env → **likely**.
- RabbitMQ: amqplib `sendToQueue(queue, …)` (produce), `publish(exchange, routingKey, …)` (produce), `consume(queue, fn)` (consume), `bindQueue(queue, exchange, pattern)` (link exchange→queue), `assertQueue/assertExchange` (declare); pika `basic_publish(exchange=, routing_key=)`, `basic_consume(queue=)`. An exchange → bound queue → consumer chain is **certain** only when the binding is literal in the same repo.
- AWS: SQS `SendMessageCommand({ QueueUrl })` / `ReceiveMessageCommand({ QueueUrl })`, boto3 `send_message(QueueUrl=)` / `receive_message`; SNS `PublishCommand({ TopicArn })`. Channel name = last segment of `https://sqs.<region>.amazonaws.com/<account>/<queue>` or of the ARN; a `QueueUrl` from env → B2 rules. Lambda event-source mappings (SAM/serverless.yml `events: sqs:`) also declare consumers — unverified.
- NATS: `nc.publish(subject)`, `nc.subscribe(subject)`, `nc.request(subject)` (request/reply = a call, not just a message); subjects with `*`/`>` wildcards → **likely** matches.
- Redis pub/sub: `publish(channel)`, `subscribe(channel)`, `psubscribe(pattern)`; Streams `xadd(stream)` / `xreadgroup(group, consumer, {stream})`. (Redis docs page returned 404 in this pass — commands are standard but unverified from the primary doc.)
- Job queues: BullMQ `new Queue('cars')` + `queue.add(jobName, data)` (produce), `new Worker('cars', processor)` (consume); the *queue name* is the join key. Celery: `@app.task` definitions, `task.delay()` / `task.apply_async(queue='x')`, `app.send_task('pkg.task_name')` (cross-app calls by task name), `task_routes` config; broker from `Celery(broker=…)` / `broker_url` (`redis://`, `amqp://`); workers pick queues with `-Q`. Task name → the module that defines it (**certain** when found; `send_task` to an undefined name → placeholder, **likely**).
- AsyncAPI files (`asyncapi.(json|yaml)`): `servers.<n>.host/protocol` (kafka, amqp, mqtt, nats…), `channels.<n>.address`, `operations.<n>.action: send|receive` + `channel` ref → declared producers/consumers, same status as OpenAPI (B4).

**B7. Databases as shared boundaries**: two services reading the same table name (existing `SqlFact`) with the same `DATABASE_URL` host → they share a database; draw the table once under the system view with both services attached. **likely** unless the URL host resolves identically.

### C. How the existing tools draw it (for the beginner levels)
- **C4 model** (c4model.com): Person → Software System → Container (apps and data stores) → Component → Code; core diagrams System Context, Container, Component, Code; supplementary System Landscape, Dynamic, Deployment. Structurizr renders these from a DSL where every relationship has a description and technology label ("Calls" "REST").
- **Backstage**: Domain → System → Component/API/Resource graph; relations deduced from `catalog-info.yaml` fields.
- **Compass**: typed components with manual "Depends on/Contains" links.
- **Sourcegraph**: a symbol/reference "code graph" from SCIP indexers for cross-repo navigation — not a service diagram.
- **CodeSee**: had "Service Maps"; acquired by GitKraken (May 2024). Current product status unverified.
- **Research**: Code2DFD (Java, keyword + config-file evidence, precision 93% / recall 85% on 17 apps; full traceability model→code — the closest published analogue of WalkMyCode's evidence rule); ModARO (arXiv Feb 2026, modular per-technology extractors merged into one JSON model, regex-based, polyglot + multi-repo, no accuracy evaluation); MicroGraal (Java/GraalVM, sync + async incl. STOMP/GraphQL). Common finding: pure static analysis misses runtime links through queues, feature flags and cross-repo calls — which is exactly why the config-file heuristics above matter.

### D. Levels that fit a beginner (C4 mapped onto WalkMyCode)
- **Level 0 — "Your system and the outside world"** (C4 System Context): one box for the whole thing, the people (from login/auth UI), and outside services (existing `external` nodes). Optional; merge into level 1 when there are ≤3 services.
- **Level 1 — "The services" (System view)** (C4 Container): one box per deployable service, plus databases, caches, brokers/channels and gateways as boxes with plain labels ("the users service", "the queue that carries orders"). Edge kinds: `calls-route` (HTTP, through a gateway or not), `calls-rpc` (gRPC), `publishes`/`consumes` via a channel box, `proxies` (gateway), `depends-on` (compose, thin grey), and the shared-database link. Same certain/likely rules, dashed for likely, evidence on click. **Monolith rule**: if boundary discovery finds only one app-type service (no compose/k8s with ≥2 app services, no workspace with ≥2 apps), skip this level entirely and say "This is one app" — beginners must not see a one-box diagram.
- **Level 2 — "Inside one service"** (C4 Component ≈ the existing five lanes): the current map filtered to that service's area, with *portals*: inbound routes that other services call get a badge ("called by orders service"), and outbound calls show a stub node at the lane edge ("→ users service: GET /users/:id") that jumps to that service's level 2. Tables shared with another service get a "shared" badge.
- **Level 3 — Code** (existing Code panel + Code room).
- Breadcrumb `System › users service › GET /users/:id`; Trace-it crosses levels (a button in the web app lights up gateway → service route → logic → table). Suggested `CodeMap` v2 additions: `services[]` {id, name, kind: app|db|cache|broker|gateway|placeholder, area?, hostnames[], ports[], evidence[]}, `MapNode.service`, node kinds `channel` and `rpc`, edge kinds `calls-rpc|publishes|consumes|proxies|depends-on`, `HttpCallFact.varName`, and a new `ConfigFacts` family produced from YAML/JSON/Dockerfile/nginx (needs a YAML parser: none is in package.json today, and tree-sitter has no YAML grammar bundled — `yaml` npm is the smallest fit for Lite's bundle).

Sources: https://docs.docker.com/compose/how-tos/networking/ · https://docs.docker.com/reference/compose-file/services/ · https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ · https://kubernetes.io/docs/concepts/services-networking/service/ · https://kubernetes.io/docs/concepts/services-networking/ingress/ · https://helm.sh/docs/topics/charts/ · https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites · https://nginx.org/en/docs/http/ngx_http_proxy_module.html · https://spec.openapis.org/oas/v3.1.0.html · https://www.asyncapi.com/docs/reference/specification/v3.0.0 · https://grpc.io/docs/what-is-grpc/core-concepts/ · https://grpc.io/docs/languages/node/basics/ · https://grpc.io/docs/languages/python/basics/ · https://kafka.js.org/docs/producing · https://docs.confluent.io/kafka-clients/python/current/overview.html · https://amqp-node.github.io/amqplib/channel_api.html · https://docs.bullmq.io/guide/queues · https://docs.celeryq.dev/en/stable/userguide/calling.html · https://docs.nats.io/using-nats/developer/sending · https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/ · https://12factor.net/backing-services · https://nx.dev/docs/reference/project-configuration · https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository · https://pnpm.io/pnpm-workspace_yaml · https://doc.rust-lang.org/stable/cargo/reference/workspaces.html · https://go.dev/ref/mod · https://c4model.com/abstractions · https://docs.structurizr.com/dsl/language · https://backstage.io/docs/features/software-catalog/descriptor-format/ · https://support.atlassian.com/compass/docs/what-are-components/ · https://support.atlassian.com/compass/docs/add-component-dependencies/ · https://arxiv.org/html/2602.08166v1 (ModARO) · https://tore.tuhh.de/handle/11420/15338 (Code2DFD) · https://excel.fit.vutbr.cz/submissions/2025/021/21.pdf (MicroGraal) · https://www.schneider.im/lu/gitkraken-acquired-codesee/ · https://5.3.sourcegraph.com/cody/core-concepts/code-graph
Key facts:
- Compose: every `services:` key is a DNS hostname on the default network; service-to-service uses the CONTAINER port, `localhost:HOST` in dev code maps to the published HOST port (likely match); `depends_on` is startup order (service_started|service_healthy|service_completed_successfully), not proven traffic; `links`, `networks.aliases`, `hostname`, `container_name` add hostnames; `environment`/`env_file` literal values are the primary way to resolve `*_URL` env vars to services.
- Kubernetes: `kind: Service` name resolves as `name`, `name.ns`, `name.ns.svc.cluster.local`; kubelet injects `{SVCNAME}_SERVICE_HOST`/`_SERVICE_PORT` (upper-cased, dashes→underscores); `kind: Ingress` rules (host, path, pathType Prefix|Exact, backend.service.name/port) are a gateway route table; Helm `templates/` are Go templates and must not be YAML-parsed — only Chart.yaml and values.yaml are readable, and only as `likely`.
- Monorepo boundaries: root package.json `workspaces` or `pnpm-workspace.yaml` `packages` globs (pnpm ignores the package.json field), Nx `project.json`/`nx` key with `implicitDependencies` (globs, `!` negation) and `tags`, Turborepo's apps/ vs packages/ convention, Cargo `[workspace] members` globs, Go `go.work use` (rarely committed; fall back to multiple go.mod). A dependency whose name matches a workspace package `name` (e.g. `workspace:*`) is a certain area→area edge.
- gRPC: `.proto` `service X { rpc Y }` gives a certain rpc-service node; server registration is `add_XServicer_to_server` (Python), `server.addService(pkg.X.service)` (Node), `pb.RegisterXServer` (Go); clients are `XStub(grpc.insecure_channel('host:port'))`, `new pkg.X('host:port', creds)` after `protoLoader.loadSync`, `pb.NewXClient(conn)`. Target = host when literal, else the single implementer of X (certain if unique, likely otherwise). Generated files (`*_pb2_grpc.py`, `*_grpc_pb.js`, `*.pb.go`) should be skipped for parsing.
- Brokers link services through a named channel: kafkajs `producer.send({topic})` / `consumer.subscribe({topic|topics})`; confluent-kafka `produce(topic=)` / `subscribe([...])`; amqplib `sendToQueue(queue)`, `publish(exchange, routingKey)`, `consume(queue)`, `bindQueue(queue, exchange, pattern)`; SQS `SendMessageCommand({QueueUrl})` / `ReceiveMessageCommand`, SNS `PublishCommand({TopicArn})` (channel = last URL/ARN segment); NATS `publish/subscribe/request(subject)`; Redis `publish/subscribe(channel)`, streams `xadd/xreadgroup`; BullMQ `new Queue('n').add` vs `new Worker('n')`; Celery `.delay/.apply_async(queue=)`, `send_task('name')`, `task_routes`. Literal channel name = certain publishes/consumes edge; derived service→service edge only when exactly one producer and one consumer (likely).
- Specs without handler parsing: OpenAPI `paths` × methods with `{param}` templates and `servers[].url` give certain route nodes (file = the spec; note 'described in openapi.yaml, code not found' when no handler matches; handler wins when both exist); AsyncAPI 3 `channels.<n>.address` + `operations.<n>.action: send|receive` does the same for messaging.
- Gateways are a two-hop resolution: Next.js `rewrites()` (array or beforeFiles/afterFiles/fallback; path-to-regexp `:path*`; external `destination` URLs; `basePath: false`), Vite `server.proxy`, CRA `proxy`, nginx `location` + `proxy_pass http://upstream[/uri/]` (with-URI form replaces the matched prefix; `upstream` blocks name servers). Certain when both hops are literal, likely otherwise; show the gateway as an evidence line, not a box, below the system view.
- Declared catalogues are labels, not observations: Backstage `catalog-info.yaml` (Domain > System > Component/API/Resource; `providesApis`, `consumesApis`, `dependsOn`; API types openapi|asyncapi|graphql|grpc), Compass (typed components, dependencies added manually in UI or config-as-code, no automatic code detection documented, limits 25/100), Structurizr DSL (`a -> b "desc" "tech"`). Present as a third 'declared' state or as likely with the note 'written by the team, not seen in code'; use System/Domain names to group services.
- C4 levels for WalkMyCode: Level 0 System Context (whole system + people + outside services, optional), Level 1 Container = 'the services' system view (apps, DBs, caches, channels, gateways; edges calls-route, calls-rpc, publishes/consumes, proxies, depends-on, shared-table), Level 2 Component = the existing five lanes filtered to one service with inbound/outbound 'portal' stubs, Level 3 = code. Monolith rule: exactly one app-type service → hide the system view and say 'This is one app'.
- Prior art that validates the evidence approach: Code2DFD (Java, config-file keyword evidence, precision 93% / recall 85% on 17 apps, full model→code traceability); ModARO (arXiv Feb 2026, per-technology extractors merged into one JSON model, polyglot + multi-repo, regex-based, no accuracy evaluation); MicroGraal (Java, sync + async). All note static analysis misses runtime links through queues and cross-repo calls — the config-file heuristics are the mitigation.
- Concrete gaps in the current analyzer: build.ts line 553 turns any unknown host (e.g. `users:8080` from compose) into an outside-service node; `hostsIn` in extract/common.ts requires a dotted TLD so bare compose hostnames are invisible to `serviceFacts`; `SECRET_RE` in build.ts skips all `.env*` including `.env.example`; `HttpCallFact.fromVariable` is a boolean with no variable name; `matchRoute` with a leading variable tries suffix alignment against every route in every area (service resolution should narrow candidates). No YAML parser is in package.json and no tree-sitter YAML grammar is bundled in public/wasm.
- CodeMap v2 shape suggested: `services[]` {id, name, kind app|db|cache|broker|gateway|placeholder, area?, hostnames[], ports[], evidence[]}, `MapNode.service`, node kinds `channel` and `rpc`, edge kinds `calls-rpc|publishes|consumes|proxies|depends-on`, `HttpCallFact.varName`, and a `ConfigFacts` family extracted from compose/k8s/Dockerfile/nginx/next.config/openapi/asyncapi/proto.
Pitfalls:
- Compose service name is not the folder name: bind service→area only via `build.context`/Dockerfile path; an `image:`-only service is infrastructure or a service built elsewhere (multi-repo placeholder), never assume it is local code.
- `depends_on` and Backstage/Compass `dependsOn` are declarations, not observed calls — drawing them as 'calls' arrows teaches a beginner something false; keep them visually distinct (thin grey / 'declared') with a note.
- Helm `templates/*.yaml` contain `{{ }}` and are not valid YAML; a naive YAML parse will throw or, worse, half-parse. Only Chart.yaml and values.yaml are safe, and only as likely evidence.
- Env vars may be unresolvable (set in CI, cloud console, or a real `.env` that the secret guard must never read). Reading `.env.example`/`.env.sample` is safe for hostnames but SECRET_RE currently blocks all `.env*`; whitelist the example variants and still redact values that look like keys.
- Kubernetes env-var names mangle service names (`my-service` → `MY_SERVICE_SERVICE_HOST`); normalise both sides (upper-case, dashes/dots → underscores) before matching, and prefer `*_SERVICE_HOST` over generic `*_HOST` guesses.
- Host port vs container port: `localhost:3000` in front-end code refers to the compose HOST port, while `users:8080` refers to the CONTAINER port — mixing them mismatches services; the localhost→published-port match must stay `likely`.
- A gRPC service defined in one .proto can be implemented by several services (or none in this repo, when the .proto is vendored); only a unique implementer gives a certain edge. Generated stubs must be excluded from parsing but their filenames still identify the service.
- Topic/queue names are often built from prefixes or env (`${env}.orders`), and NATS/RabbitMQ use wildcard patterns (`orders.*`, `>`); pattern-matched channels are likely, never certain, and a channel with many producers/consumers must be shown as its own box rather than N×M derived arrows.
- Celery `send_task('name')` and queue routing via `task_routes` separate the task name from the queue name; BullMQ links only by queue name. Conflating task/job names with queue names produces false links.
- OpenAPI/AsyncAPI files drift from the handlers; when a spec route has no matching handler, say so instead of silently drawing a route that may no longer exist. Backstage/Compass/Structurizr files can be equally stale.
- Next.js rewrites are checked in a specific order (headers, redirects, proxy, beforeFiles, files, afterFiles, dynamic routes, fallback); a fallback rewrite to an external host means 'everything unmatched', which is a likely link at best and must not attach every unmatched call to that host.
- Multiple compose files (override, profiles, `docker-compose.prod.yml`) can define the same service with different env; merge deterministically and record which file each value came from as evidence.
- `go.work` is usually not committed, Turborepo's apps/packages split is convention only, and Nx `implicitDependencies` can negate inferred edges — treat all three as hints, and let file content (routes, JSX, entrypoint) decide app vs library.
- Today build.ts:553 labels any unknown literal host (including compose hostnames) as an outside SaaS service; the service layer must run before that fallback or iReliabee-style repos will show sibling services as 'external'.
- Unverified in this pass: Redis pub/sub and Streams command shapes (redis.io page returned 404), Kubernetes Gateway API `HTTPRoute`, uv workspaces, aiokafka/kafka-python method names, Lambda event-source mappings for SQS, Compass compass.yml field names, the current status of CodeSee Service Maps inside GitKraken, and CodeSee/Sourcegraph drawing conventions (secondary sources only). Everything else above was checked against primary documentation on 30 Sep 2026.