// The map WalkMyCode draws. Everything here comes from parsing; the AI never adds
// an edge. Every edge carries the file:line that proves it.
//
// Version 2 adds services, gateways and the system view (docs/SERVICES.md §2).
// Every v1 field is untouched and every v1 id survives; upgradeMap() in
// migrate.ts fills the new fields on an old map.

export type Layer = "ui" | "api" | "logic" | "data" | "external";

export type Lang =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "py"
  | "dart"
  | "php"
  /** A Twig template (Symfony): read by its tags, no grammar. */
  | "twig"
  | "sql"
  | "prisma"
  /** yaml/json/toml/Dockerfile/nginx/.env.example: kept in files[] and repo.files, read by analyzer/config, never by tree-sitter. */
  | "config"
  | "proto";

/** `certain`: resolved exactly. `likely`: matched by pattern (e.g. a URL built
 * from a variable) — drawn dashed and labelled as a guess. */
export type Confidence = "certain" | "likely";

export type EdgeKind =
  | "imports" // file uses code from another file
  | "calls" // a route handler calls into a module (fn-level)
  | "calls-route" // code sends an HTTP request that a route handles
  | "reads" // code reads a table
  | "writes" // code writes a table
  | "defines" // a schema/migration creates a table
  | "uses-service" // code talks to an outside service
  | "calls-rpc" // code calls a gRPC method another service implements
  | "publishes" // code sends to a channel
  | "consumes" // code receives from a channel
  | "proxies" // system view only: a gateway service forwards a prefix to a service
  | "depends-on"; // system view only: compose/k8s startup dependency (declared, thin grey)

export interface Evidence {
  file: string;
  line: number; // 1-based
  text: string; // the line, trimmed
  /** What the user clicks to set this off, when the parser can see it,
   * e.g. `<button>` "Sign in". */
  trigger?: { element: string; label?: string; line: number };
  /** "config" when the line is in compose/k8s/next.config/nginx/.env.example.
   * "user" when the user told WalkMyCode where a setting points (docs/SERVICES.md §13):
   * the line is where the code reads that setting, the text says what they answered.
   * For an answer about a public address, the line is where the address is set. */
  role?: "code" | "config" | "user";
  /** Role "user": the setting the answer is about, e.g. "VITE_API_URL". */
  setting?: string;
  /** Role "user": the public address the answer is about, e.g. "api.example.com" ("Whose address is this?"). */
  host?: string;
}

/** The user's answer to "Where does this point?": a base-URL setting the code
 * reads, with no value anywhere in the workspace, points at this service. Or,
 * with `host`, to "Whose address is this?": a public address the code sends
 * requests to is one of this workspace's apps (or another company's). */
export interface Assertion {
  /** "VITE_API_URL". For an answer about an address, the address itself ("api.example.com"):
   * the key every answer is kept under; a key with a dot is an address. */
  setting: string;
  /** Set when the answer is about a public address, not a setting: "api.example.com" (lower case,
   * with the port when it has one). Answers saved before addresses were asked about have none. */
  host?: string;
  /** ServiceDef.id ("svc-backend"); the setting's stand-in (UnresolvedBase.placeholder) for
   * "a separate backend I don't have here"; null for "an outside service / not sure"
   * (for an address: "another company's service / not sure"). */
  service: string | null;
  /** ISO time of the answer. */
  answeredAt: string;
}

/** A public address on the internet the code sends requests to ("https://api.example.com"),
 * that no config says is one of this system's services, and that is not a company WalkMyCode
 * knows (Stripe, OpenAI…): "Whose address is this?" (docs/SERVICES.md §13). */
export interface PublicHost {
  /** "api.example.com": lower case, with the port when one is given. */
  host: string;
  /** "https://api.example.com", as the code or config writes it (for the question). */
  origin: string;
  /** Where the address is set: config lines (compose, .env.example, a Dockerfile ENV, Helm values),
   * defaults in the code, URLs written out in the code. */
  setAt: Evidence[];
  /** App services whose code sends requests to it, in map order. */
  services: string[];
  /** Request sites that go to it. */
  calls: number;
  /** Arrows those requests draw on the map. */
  links: number;
  /** App service id → how many of those requests ask for a path that service's routes answer
   * (only services with at least one). */
  matches: Record<string, number>;
  /** The app whose routes answer a clear majority of the requests, when there is one. A guess:
   * it never draws an arrow; it is what the question offers first. */
  guess?: string;
  /** What the repos' own deploy config says: the service it gives this address, and the line
   * (ServiceDef.addresses). Then nothing is asked; an answer still wins. */
  config?: { service: string; evidence: Evidence };
  /** What the user answered, as this map was built with it. */
  answer?: Assertion;
}

/** A setting a request's base URL is built from that nothing in the workspace
 * gives a value (compose, .env.example, a Dockerfile ENV, a code default). */
export interface UnresolvedBase {
  /** "VITE_API_URL" */
  setting: string;
  /** App services whose requests are built on it, in map order. */
  services: string[];
  /** Every line that reads it. */
  reads: Evidence[];
  /** Request sites whose URL starts with it (directly, or through a helper that reads it). */
  calls: number;
  /** Arrows those requests draw on the map. */
  links: number;
  /** The service its name suggests (the name heuristic of §5), when there is one. */
  guess?: string;
  /** The answer that means "a separate backend I don't have here": the id of the setting's own
   * stand-in, where its requests no route here answers are drawn. */
  placeholder: string;
  /** What the user answered, as this map was built with it. */
  answer?: Assertion;
}

/** A door the code knocks on that the service it goes to doesn't have: "Called but not found in backend". */
export interface MissingRoute {
  /** ServiceDef.id of the service the requests go to. */
  service: string;
  /** "POST"; absent when the call doesn't say. */
  method?: string;
  /** The path asked for, `*` for each piece built at run time: "/api/v1/book/*\/review". */
  path: string;
  /** The lines that send it. */
  calls: Evidence[];
  /** certain when config (or the user's answer) says where the requests go; likely when WalkMyCode
   * worked it out from the other requests built on the same setting. */
  confidence: Confidence;
  /** Why WalkMyCode thinks they go to that service. */
  note?: string;
}

/** One column of a table card: "title", "VARCHAR(255)". */
export interface TableColumn {
  name: string;
  type?: string;
}

export interface MapNode {
  id: string;
  layer: Layer;
  kind: "component" | "module" | "route" | "table" | "service" | "channel" | "rpc";
  /** Short name shown on the card. */
  name: string;
  /** Project area (monorepo package), e.g. "frontend", "backend". */
  area: string;
  file?: string;
  line?: number;
  endLine?: number;
  /** Route: HTTP method + path. */
  method?: string;
  path?: string;
  /** Route: name of the handler function. */
  handler?: string;
  /** Owning ServiceDef.id; absent on third-party `service` nodes and on channels owned by no broker. */
  service?: string;
  /** Kind "service": true = placeholder for one of this system's own services whose code is not here. */
  internal?: boolean;
  /** Kind "table": database identity (ServiceDef.id of a db service, or `own:<serviceId>`). */
  db?: string;
  /** Kind "table": service ids that read/write it (for the "shared by" badge). */
  usedBy?: string[];
  /** Kind "table": its columns, in order, as the code that creates it writes them (a migration, CREATE TABLE,
   * a Prisma model, an ORM class); `type` as written there. Absent when nothing says (and on older maps). */
  columns?: TableColumn[];
  /** Kind "table": the line that lists those columns. */
  columnsAt?: { file: string; line: number };
  /** Kind "channel"|"rpc": "kafka topic", "bullmq queue", "gRPC service". */
  tech?: string;
  /** Beginner wording attached at build time, e.g. "described in openapi.yaml; I did not find the code". */
  note?: string;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: Confidence;
  evidence: Evidence[];
  /** Why a `likely` edge is only likely. */
  note?: string;
  /** Function in the source file the edge starts from (for precise tracing). */
  fromFns?: string[];
  /** Functions in the target file this edge calls into. */
  toFns?: string[];
}

/** A deployable unit: an app, a database, a cache, a broker, a gateway, or a
 * placeholder for one whose code is not in the workspace. */
export interface ServiceDef {
  /** "svc-users" — slug of name, stable across re-index. */
  id: string;
  /** "users" */
  name: string;
  kind: "app" | "db" | "cache" | "broker" | "gateway" | "placeholder";
  /** Repo label when the workspace has >1 repo. */
  repo?: string;
  /** Areas whose code runs in this service (app kind); [] for infra/placeholder. */
  areas: string[];
  /** "users", "users:8080", "users.default.svc.cluster.local"; dev aliases live in devHosts. */
  hostnames: string[];
  /** Published host ports: "localhost:8000", "127.0.0.1:8000" (matches are likely). */
  devHosts: string[];
  ports: { container?: number; host?: number }[];
  /** compose/k8s image when not built here. */
  image?: string;
  /** "Start here": CMD/ENTRYPOINT, package.json start, uvicorn.run, app.listen. */
  entry?: Evidence;
  /** "Next.js" | "Express" | "FastAPI" | ... (label only). */
  framework?: string;
  /** Config table, secrets redacted to "•••". */
  env: Record<string, { value: string; file: string; line: number }>;
  /** ServiceDef.ids from compose/k8s depends_on. */
  dependsOn: string[];
  /** The lines that prove the boundary. */
  evidence: Evidence[];
  /** likely when the boundary comes from a folder-name convention only. */
  confidence: Confidence;
  /** Only from catalog-info.yaml / Chart.yaml (label, not observation). */
  declared?: boolean;
  /** Backstage/Compass `system` name for grouping on the system view. */
  group?: string;
  /** Kind "placeholder": stands for wherever this setting points, which nothing in the workspace says. */
  setting?: string;
  /** Public addresses its own repo's deploy config gives it (a CI health check after deploying, a Caddy
   * site, a Traefik rule, nginx server_name, an Ingress host, fly.toml, render.yaml, CNAME), each with
   * the line that says so; they are in `hostnames` too. Absent when there are none. */
  addresses?: { host: string; evidence: Evidence }[];
  counts: { ui: number; api: number; logic: number; data: number };
}

/** A rewrite/proxy rule: a path prefix one service forwards to another. */
export interface GatewayRule {
  /** Segments, "*" = one segment, "**" = rest. */
  source: string[];
  toService?: string;
  toHost?: string;
  /** Segments removed from the front before matching. */
  strip: number;
  /** Destination path prefix, e.g. ["v1"]. */
  prependPath: string[];
  kind: "next-rewrite" | "vite-proxy" | "cra-proxy" | "angular-proxy" | "nginx" | "ingress" | "httproute";
  /** The service whose config declares it (own rules are tried first). */
  ownerService?: string;
  evidence: Evidence;
  confidence: Confidence;
}

/** A service→service link, derived by build.ts from node edges. */
export interface ServiceLink {
  /** `${kind}:${from}->${to}` (+ `@${via}` when via is set). */
  id: string;
  /** ServiceDef.id */
  from: string;
  to: string;
  /** calls-route | calls-rpc | publishes | consumes | proxies | depends-on | reads | writes */
  kind: EdgeKind;
  confidence: Confidence;
  note?: string;
  /** Channel or table node id when the link goes through one. */
  via?: string;
  /** Node edges that prove it (each has file:line evidence). */
  edgeIds: string[];
  count: number;
}

export interface FileEntry {
  path: string;
  lang: Lang;
  lines: number;
  area: string;
  /** Skipped for the map (tests, too big, secrets) and why. */
  skipped?: string;
  /** Top-level functions: name → [startLine, endLine, localCalls[]]. */
  fns?: Record<string, [number, number, string[]]>;
  service?: string;
  configKind?: "compose" | "k8s" | "helm" | "dockerfile" | "envfile" | "gateway" | "openapi" | "asyncapi" | "proto" | "workspace" | "declared" | "wrangler" | "deploy";
}

export interface RepoRef {
  label: string;
  /** "" for one repo; "<label>/" when several repos are open. */
  prefix: string;
  kind: "local" | "demo" | "cli" | "github";
}

export interface CodeMap {
  version: 2;
  name: string;
  generatedAt: string;
  repos: RepoRef[];
  system: { kind: "monolith" | "monorepo" | "services"; links: ServiceLink[] };
  /** App services in flow order, then db/cache/broker/gateway, then placeholders. */
  services: ServiceDef[];
  gateways: GatewayRule[];
  areas: string[];
  files: FileEntry[];
  nodes: MapNode[];
  edges: MapEdge[];
  warnings: string[];
  /** Base-URL settings with no value in the workspace ("Where does this point?"); absent when there are none. */
  unresolvedBases?: UnresolvedBase[];
  /** Public addresses the code sends requests to, that may be one of this system's apps
   * ("Whose address is this?"); absent when there are none. */
  publicHosts?: PublicHost[];
  /** Requests to doors their service doesn't have, by service and path; absent when there are none. */
  missingRoutes?: MissingRoute[];
  stats: {
    files: number;
    parsed: number;
    routes: number;
    tables: number;
    edges: number;
    likely: number;
    ms: number;
    services: number;
    links: number;
    crossService: number;
    /** Requests for a file the app serves itself (public/, static/): no route, no warning. Absent when none. */
    assets?: number;
    /** Code in languages the map doesn't draw yet, files per language ({ Rust: 7 }): readable by the guide,
     * not on the map. Absent when none. */
    otherCode?: Record<string, number>;
  };
}

export interface SourceFile {
  path: string; // repo-relative, forward slashes
  content: string;
}
