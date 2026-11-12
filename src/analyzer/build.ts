// Turns per-file facts into the map: resolves imports, joins routes to the
// code that calls them, tables to the code that touches them, and outside
// services to the code that uses them. Every edge keeps its evidence.
import { grammarFor, parse } from "./parser";
import { extractJs } from "./extract/js";
import { extractPy } from "./extract/py";
import { extractDart, linkDart } from "./extract/dart";
import { extractPhp, extractTwig, linkPhp, phpResolver } from "./extract/php";
import { TECH_LABEL } from "./extract/channels";
import { serviceForEnv, serviceForHost, sqlColumns, sqlInString } from "./extract/common";
import { emptyFacts, type ChannelFact, type FileFacts, type HttpCallFact, type Method, type RouteFact } from "./facts";
import { configKindOf, configLangOf, ENV_EXAMPLE_RE, extractConfig, redactConfigText } from "./config";
import { CI_RE, type DeployAddress } from "./config/deploy";
import { readableLanguage } from "./config/files";
import { extractGateways, gatewayKindOf, matchGateway } from "./config/gateway";
import { serviceId } from "./migrate";
import { detectServices, normalisedName, orderServices, systemLinks } from "./services";
import type { Assertion, CodeMap, Confidence, EdgeKind, Evidence, FileEntry, GatewayRule, Lang, Layer, MapEdge, MapNode, MissingRoute, PublicHost, RepoRef, ServiceDef, SourceFile, UnresolvedBase } from "./types";

export interface BuildOptions {
  name: string;
  onProgress?: (done: number, total: number, file: string) => void;
  /** Files above this many bytes are listed but not parsed. */
  maxBytes?: number;
  /** The repos these sources came from; one repo with prefix "" when omitted. */
  repos?: RepoRef[];
  /** What the user told WalkMyCode about settings with no value ("Where does this point?").
   * `service` may be a ServiceDef id or a service name (the CLI's --assume). */
  assertions?: Assertion[];
}

export interface BuildResult {
  map: CodeMap;
  facts: Record<string, FileFacts>;
  /** App service id → database identity (docs/SERVICES.md §4 step 5), for per-database table ids. */
  dbOf: Record<string, string>;
}

const SKIP_DIRS = /(^|\/)(node_modules|\.[^/]+|dist|build|out|target|__pycache__|venv|env|coverage|vendor|storybook-static|site-packages)(\/|$)/;
const TEST_RE = /(^|\/)(tests?|__tests__|__mocks__|spec|e2e|cypress|playwright|integration_test|test_driver)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py|[^/]*_test\.dart)$/;
const SECRET_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_rsa.*|id_ed25519.*|.*secrets?\.(json|ya?ml|toml))$/i;
// Protobuf output (users_pb2.py, users_pb.js, users_grpc_pb.js, users.pb.go) is generated: its name says which gRPC service it is, the .proto says the rest.
// Dart's build_runner writes booking.g.dart, booking.freezed.dart and the like next to the source.
const GENERATED_RE = /\.(min|bundle|chunk)\.[cm]?js$|\.d\.ts$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock)$|_pb2(_grpc)?\.pyi?$|_(grpc_)?pb\.[cm]?js$|\.pb\.go$|\.(g|freezed|gr|mocks|pb|pbenum|pbgrpc|pbjson|pbserver)\.dart$|(^|\/)generated_plugin_registrant\.dart$/;
/** Manifests the workspace reader needs (package.json workspaces, Cargo [workspace], go.mod). */
const WORKSPACE_MANIFEST = /^(package\.json|Cargo\.toml|go\.mod)$/;
const MANIFESTS = new Set(["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "composer.json", "Gemfile", "pubspec.yaml"]);

function langOf(path: string): Lang | null {
  const m = /\.([a-z]+)$/i.exec(path);
  const ext = m?.[1]?.toLowerCase();
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "jsx":
      return "jsx";
    case "py":
      return "py";
    case "sql":
      return "sql";
    case "prisma":
      return "prisma";
    case "dart":
      return "dart";
    case "php":
      return "php";
    case "twig":
      return "twig";
    default:
      return null;
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}
function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir.split("/") : []).filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Route path → segments with `*` for parameters. */
export function routeSegments(path: string): string[] {
  const clean = path.split("?")[0].replace(/\/+$/, "").replace(/^\/+/, "");
  if (!clean) return [];
  return clean.split("/").map((s) => (/^(\{.*\}|\[.*\]|:.+|<.*>|\*.*)$/.test(s) ? "*" : s));
}
function joinRoute(prefix: string, path: string): string {
  const p = `/${[prefix, path].join("/")}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return p || "/";
}

/** A public address as answers and deploy config key it: lower case, no scheme or path, no default port.
 * "https://API.example.com:443/v1" → "api.example.com". */
export function hostKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:(80|443)$/, "");
}

function callSegments(url: string): { segs: string[]; host: string | null } {
  let u = url;
  let host: string | null = null;
  const m = /^(?:https?|wss?):\/\/([^/?#]+)(.*)$/i.exec(u);
  if (m) {
    host = m[1].toLowerCase();
    u = m[2] || "/";
  }
  // "*" pieces: a leading base URL variable, or a parameter mid-path.
  const segs = u
    .split("?")[0]
    .replace(/\/+$/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => (s.includes("*") ? "*" : s));
  return { segs, host };
}

/** Does a call path match a route pattern? Returns a score (literal segments matched) or -1. */
function matchRoute(callSegs: string[], routeSegs: string[], leadingVar: boolean): number {
  // A leading variable may hide any number of prefix segments: try suffix alignment.
  const tries = leadingVar ? Math.min(callSegs.length, 3) : 0;
  for (let drop = 0; drop <= tries; drop++) {
    const cs = callSegs.slice(drop);
    if (cs.length !== routeSegs.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i] === routeSegs[i]) {
        score += cs[i] === "*" ? 0 : 2;
      } else if (routeSegs[i] === "*" || cs[i] === "*") score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok && score > 0) return score - drop;
  }
  return -1;
}

export async function buildMap(sources: SourceFile[], opts: BuildOptions): Promise<BuildResult> {
  const t0 = Date.now();
  const maxBytes = opts.maxBytes ?? 400_000;
  const warnings: string[] = [];
  // Config files are shown (and cited) with their secrets hidden.
  const byPath = new Map(sources.map((s) => [s.path, configLangOf(s.path, s.content) ? { path: s.path, content: redactConfigText(s.content, s.path) } : s]));
  const isSecret = (p: string) => SECRET_RE.test(p) && !ENV_EXAMPLE_RE.test(p);
  const skipReason = (s: SourceFile, lines: number): string | undefined => {
    // An example env file is a dotfile, not a hidden folder: only its folder is checked; a CI workflow (.github/workflows,
    // .gitlab-ci.yml) is checked from its repo's root up.
    if (SKIP_DIRS.test(ENV_EXAMPLE_RE.test(s.path) ? dirname(s.path) : CI_RE.test(s.path) ? s.path.replace(CI_RE, "") : s.path)) return "dependency or build output";
    if (GENERATED_RE.test(s.path)) return "generated";
    if (TEST_RE.test(s.path)) return "test";
    if (s.content.length > maxBytes) return "too big";
    if (s.content.length > 20_000 && s.content.length / lines > 400) return "minified";
    return undefined;
  };

  // ── config files (compose, Dockerfile, .env.example): read before areas, since a build folder is a package ──
  const configSources = sources.filter((s) => !isSecret(s.path) && (configKindOf(s.path, s.content) || WORKSPACE_MANIFEST.test(basename(s.path))) && !skipReason(s, s.content.split("\n").length));
  const { facts: config, warnings: configWarnings } = extractConfig(configSources);
  warnings.push(...configWarnings);
  // Rewrites and proxies (next.config, vite.config, package.json "proxy", nginx, Ingress): §5 step 3b.
  const gatewaySources = sources.filter((s) => !isSecret(s.path) && gatewayKindOf(s.path) && !skipReason(s, s.content.split("\n").length)).map((s) => byPath.get(s.path)!);
  const gw = await extractGateways(gatewaySources);
  config.gateways.push(...gw.rules);
  config.envValues.push(...gw.envValues);
  config.addresses.push(...(gw.addresses ?? []));
  warnings.push(...gw.warnings);

  // ── areas (packages) ──
  const manifestDirs = new Set<string>();
  for (const s of sources) if (MANIFESTS.has(basename(s.path)) && !SKIP_DIRS.test(s.path)) manifestDirs.add(dirname(s.path));
  // With several repos, each repo's root is a package, so no file ever falls into another repo's area (§6.2).
  const multiRepo = (opts.repos?.filter((r) => r.prefix).length ?? 0) > 1;
  if (multiRepo) for (const r of opts.repos!) if (r.prefix) manifestDirs.add(r.prefix.replace(/\/+$/, ""));
  // A compose build folder, a Dockerfile's folder or a workspace package (Nx project.json) is a package
  // even without a manifest, when it holds code.
  for (const cs of [...config.services, ...config.workspaces]) {
    const d = cs.dir;
    if (d === undefined || manifestDirs.has(d)) continue;
    if (sources.some((s) => langOf(s.path) && (d === "" || s.path.startsWith(d + "/")) && !SKIP_DIRS.test(s.path))) manifestDirs.add(d);
  }
  const areaOf = (p: string): string => {
    let best = "";
    for (const d of manifestDirs) if (d && (p === d || p.startsWith(d + "/")) && d.length > best.length) best = d;
    return best || (manifestDirs.has("") || manifestDirs.size === 0 ? opts.name : "root");
  };

  // ── file entries ──
  const files: FileEntry[] = [];
  const facts: Record<string, FileFacts> = {};
  const parseable: SourceFile[] = [];
  // Code in languages the map doesn't draw (Rust, Go…): counted, so the map can say what it holds.
  const otherCode: Record<string, number> = {};
  for (const s of sources) {
    const code = langOf(s.path);
    const lang = code ?? (isSecret(s.path) ? null : configLangOf(s.path, s.content));
    const entry: FileEntry = { path: s.path, lang: lang ?? ("ts" as Lang), lines: s.content.split("\n").length, area: areaOf(s.path) };
    if (isSecret(s.path)) {
      entry.skipped = "secret";
      files.push(entry);
      continue;
    }
    if (!lang) {
      // Not code the map draws, nor config (manifests, docs, other languages): kept out of the map entirely.
      const other = readableLanguage(s.path);
      if (other) {
        otherCode[other] = (otherCode[other] ?? 0) + 1;
        // Listed (Files, the guide's list_files) and opened like any file, never parsed: no cards from it.
        files.push({ ...entry, skipped: `${other} isn't drawn on the map yet` });
      }
      continue;
    }
    const configKind = configKindOf(s.path, s.content);
    if (configKind) entry.configKind = configKind;
    const skipped = skipReason(s, entry.lines);
    if (skipped) entry.skipped = skipped;
    files.push(entry);
    // Config files stay in files[] (to open and cite) but are never tree-sitter parsed.
    if (!skipped && code) parseable.push(s);
  }

  // ── parse ──
  let done = 0;
  for (const s of parseable) {
    opts.onProgress?.(done++, parseable.length, s.path);
    const lang = langOf(s.path)!;
    try {
      if (lang === "sql") {
        const f = emptyFacts(s.content.split("\n").length);
        const lineOf = (off: number) => 1 + (s.content.slice(0, off).match(/\n/g)?.length ?? 0);
        f.sql = sqlInString(s.content, lineOf);
        f.columns = sqlColumns(s.content, lineOf);
        facts[s.path] = f;
      } else if (lang === "prisma") {
        const f = emptyFacts(s.content.split("\n").length);
        f.columns = [];
        const re = /^[ \t]*model\s+(\w+)\s*\{([^}]*)\}/gm;
        const models = new Set([...s.content.matchAll(/^[ \t]*(?:model|type)\s+(\w+)\s*\{/gm)].map((m) => m[1]));
        for (let m = re.exec(s.content); m; m = re.exec(s.content)) {
          const line = 1 + (s.content.slice(0, m.index).match(/\n/g)?.length ?? 0);
          f.sql.push({ table: m[1], op: "define", line });
          // `title String @db.VarChar(255)`: a field, its type; a field of another model's type is a relation, no column.
          const columns: { name: string; type: string }[] = [];
          for (const fl of m[2].split("\n")) {
            const fm = /^\s*(\w+)\s+(\w+)(\[\]|\?)?/.exec(fl);
            if (fm && !models.has(fm[2])) columns.push({ name: fm[1], type: fm[2] + (fm[3] ?? "") });
          }
          if (columns.length) f.columns.push({ table: m[1], columns, line });
        }
        facts[s.path] = f;
      } else if (lang === "twig") {
        facts[s.path] = extractTwig(s.content);
      } else {
        const g = grammarFor(s.path);
        if (!g) continue;
        const root = await parse(g, s.content);
        facts[s.path] = g === "python" ? extractPy(root, s.content) : g === "dart" ? extractDart(root, s.content) : g === "php" ? extractPhp(root, s.content, s.path) : extractJs(root, s.content);
      }
    } catch (e) {
      warnings.push(`could not parse ${s.path}: ${(e as Error).message}`);
    }
  }
  const parsed = Object.keys(facts);
  const parsedSet = new Set(parsed);

  // ── file-based routes (Next.js, Cloudflare Pages, SvelteKit-ish) ──
  for (const p of parsed) {
    const f = facts[p];
    const fnRange = (name: string) => f.fns.find((x) => x.name === name);
    const pushFileRoute = (method: Method, path: string, handler: string | undefined) => {
      const r = handler ? fnRange(handler) : undefined;
      f.routes.push({ method, path, line: r?.start ?? 1, endLine: r?.end ?? f.lines, handler });
    };
    const next = /(^|\/)app\/(.*\/)?route\.[cm]?[jt]sx?$/.exec(p);
    if (next) {
      const path = "/" + (next[2] ?? "").replace(/\([^/]*\)\//g, "").replace(/\/$/, "");
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"] as Method[]) if (f.exports.includes(m)) pushFileRoute(m, path, m);
      continue;
    }
    const pages = /(^|\/)pages\/api\/(.*)\.[cm]?[jt]sx?$/.exec(p);
    if (pages) {
      const path = "/api/" + pages[2].replace(/\/?index$/, "");
      pushFileRoute("ANY", path, "default");
      continue;
    }
    const cf = /(^|\/)functions\/(.*)\.[cm]?[jt]s$/.exec(p);
    if (cf && !/(^|\/)_/.test(cf[2])) {
      const path = "/" + cf[2].replace(/\/?index$/, "").replace(/\[\[?[^\]]*\]?\]/g, "*");
      let any = false;
      for (const m of ["Get", "Post", "Put", "Patch", "Delete"]) {
        if (f.exports.includes(`onRequest${m}`)) {
          pushFileRoute(m.toUpperCase() as Method, path, `onRequest${m}`);
          any = true;
        }
      }
      if (f.exports.includes("onRequest")) {
        pushFileRoute("ANY", path, "onRequest");
        any = true;
      }
      void any;
    }
  }

  // ── import resolution ──
  const exts = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts"];
  const resolveJs = (from: string, spec: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith(".")) base = joinPath(dirname(from), spec);
    else if (spec.startsWith("@/") || spec.startsWith("~/")) {
      const area = areaOf(from);
      const areaDir = manifestDirs.has(area) ? area : "";
      for (const root of [`${areaDir}/src`, areaDir, `${areaDir}/app`]) {
        const cand = joinPath(root, spec.slice(2));
        const hit = tryFile(cand);
        if (hit) return hit;
      }
      return null;
    } else if (spec.startsWith("/")) base = spec.slice(1);
    else return null;
    return tryFile(base);
  };
  const tryFile = (base: string): string | null => {
    if (parsedSet.has(base)) return base;
    for (const e of exts) if (parsedSet.has(`${base}.${e}`)) return `${base}.${e}`;
    for (const e of exts) if (parsedSet.has(`${base}/index.${e}`)) return `${base}/index.${e}`;
    const stripped = base.replace(/\.[cm]?js$/, "");
    if (stripped !== base) for (const e of exts) if (parsedSet.has(`${stripped}.${e}`)) return `${stripped}.${e}`;
    return null;
  };
  const resolvePy = (from: string, spec: string): { file: string | null; dir: string | null } => {
    const m = /^(\.*)(.*)$/.exec(spec)!;
    const dots = m[1].length;
    const rest = m[2];
    const candidates: string[] = [];
    if (dots > 0) {
      let d = dirname(from);
      for (let i = 1; i < dots; i++) d = dirname(d);
      candidates.push(joinPath(d, rest.replace(/\./g, "/")));
    } else {
      const area = areaOf(from);
      const areaDir = manifestDirs.has(area) ? area : "";
      const r = rest.replace(/\./g, "/");
      candidates.push(joinPath(areaDir, r), joinPath(`${areaDir}/src`, r), joinPath(dirname(from), r), r);
    }
    for (const c of candidates) {
      if (parsedSet.has(`${c}.py`)) return { file: `${c}.py`, dir: null };
      if (parsedSet.has(`${c}/__init__.py`)) return { file: `${c}/__init__.py`, dir: c };
      if (parsed.some((p) => p.startsWith(`${c}/`))) return { file: null, dir: c };
    }
    return { file: null, dir: null };
  };
  // Dart: `package:<name>/x.dart` is `<that package's folder>/lib/x.dart` when the package is in the workspace.
  const dartPackages = new Map<string, string>();
  for (const s of sources) {
    if (basename(s.path) !== "pubspec.yaml" || SKIP_DIRS.test(s.path)) continue;
    const name = /^name:\s*["']?(\w+)/m.exec(s.content)?.[1];
    if (name && !dartPackages.has(name)) dartPackages.set(name, dirname(s.path));
  }
  const resolveDart = (from: string, spec: string): string | null => {
    const pkg = /^package:([^/]+)\/(.+)$/.exec(spec);
    const p = pkg ? (dartPackages.has(pkg[1]) ? joinPath(dartPackages.get(pkg[1])!, `lib/${pkg[2]}`) : null) : /^[a-z]+:/.test(spec) ? null : joinPath(dirname(from), spec);
    return p && parsedSet.has(p) ? p : null;
  };
  // PHP: a class by the file that declares it, else composer.json's PSR-4 map; `view:x` (Blade's @extends) by resources/views,
  // a Twig template's (`{% extends 'base.html.twig' %}`) by templates/.
  const resolvePhp = phpResolver(
    parsed.filter((p) => /\.(php|twig)$/.test(p)),
    (p) => byPath.get(p)?.content,
    facts,
    areaOf,
  );

  /** local binding → file it comes from (and the exported name). */
  const bindings: Record<string, Map<string, { file: string; name: string }>> = {};
  const importEdges: { from: string; to: string; line: number; names: string[] }[] = [];
  for (const p of parsed) {
    const f = facts[p];
    const b = new Map<string, { file: string; name: string }>();
    bindings[p] = b;
    const isPy = p.endsWith(".py");
    for (const imp of f.imports) {
      if (isPy) {
        const r = resolvePy(p, imp.spec);
        for (const n of imp.names) {
          let target: string | null = r.file;
          let name = n.imported;
          if (r.dir && parsedSet.has(`${r.dir}/${n.imported}.py`)) {
            target = `${r.dir}/${n.imported}.py`;
            name = "*";
          }
          if (!target) continue;
          b.set(n.local, { file: target, name });
          importEdges.push({ from: p, to: target, line: imp.line, names: name === "*" ? [] : [name] });
        }
        if (imp.names.length === 0 && r.file) importEdges.push({ from: p, to: r.file, line: imp.line, names: [] });
      } else {
        const target = p.endsWith(".dart") ? resolveDart(p, imp.spec) : /\.(php|twig)$/.test(p) ? resolvePhp(p, imp.spec) : resolveJs(p, imp.spec);
        if (!target) continue;
        for (const n of imp.names) b.set(n.local, { file: target, name: n.imported });
        importEdges.push({ from: p, to: target, line: imp.line, names: imp.names.map((n) => n.imported).filter((n) => n !== "*" && n !== "default") });
      }
    }
  }

  // Dart: a Dio client's base URL, constants from imported files, routed screens (extract/dart.ts).
  const importsFrom = new Map<string, string[]>();
  for (const e of importEdges) importsFrom.set(e.from, [...(importsFrom.get(e.from) ?? []), e.to]);
  const dartScreens = linkDart(facts, areaOf, (p) => importsFrom.get(p) ?? []);
  // PHP: Eloquent models as tables, routes/api.php's prefix, each route's controller method, the views routes return (extract/php.ts).
  const phpLinks = linkPhp(facts, resolvePhp, (p) => byPath.get(p)?.content, areaOf);

  // ── route prefixes from include_router / app.use ──
  const prefixOf = new Map<string, string>(); // `${file}|${owner}` → prefix
  for (const p of parsed) for (const [owner, pre] of Object.entries(facts[p].ownerPrefix)) prefixOf.set(`${p}|${owner}`, pre);
  const includeTargets: { file: string; owner: string; prefix: string; fromFile: string; fromOwner: string }[] = [];
  for (const p of parsed) {
    for (const inc of facts[p].includes) {
      const [head, ...rest] = inc.target.split(".");
      const bnd = bindings[p].get(head);
      let file: string | null = null;
      let owner = rest[rest.length - 1] ?? "router";
      if (bnd) {
        if (bnd.name === "*") {
          file = bnd.file;
        } else {
          // `from .routers import audio` gives a submodule; `import { usersRouter } from "./users"` gives a binding
          file = bnd.file;
          owner = rest.length ? rest[rest.length - 1] : bnd.name;
        }
      } else {
        // Same-file router (app.include_router(router, ...)) or unresolved
        if (facts[p].routes.some((r) => r.owner === head)) {
          file = p;
          owner = head;
        } else {
          warnings.push(`${p}:${inc.line} mounts ${inc.target} but I couldn't find where it's defined`);
          continue;
        }
      }
      includeTargets.push({ file, owner, prefix: inc.prefix, fromFile: p, fromOwner: "app" });
    }
  }
  // Routes owned by a JS router imported as default/named: match by owner name loosely
  const fullPrefix = new Map<string, string>();
  const resolvePrefix = (file: string, owner: string, depth = 0): string => {
    const key = `${file}|${owner}`;
    if (fullPrefix.has(key)) return fullPrefix.get(key)!;
    if (depth > 4) return "";
    const own = prefixOf.get(key) ?? "";
    const inc = includeTargets.find((t) => t.file === file && (t.owner === owner || !facts[file].routes.some((r) => r.owner === t.owner)));
    let outer = "";
    if (inc) {
      const parentOwner = facts[inc.fromFile].routes[0]?.owner ?? "app";
      outer = joinRoute(resolvePrefix(inc.fromFile, parentOwner, depth + 1), inc.prefix);
    }
    const result = joinRoute(outer === "/" ? "" : outer, own);
    fullPrefix.set(key, result === "/" ? "" : result);
    return fullPrefix.get(key)!;
  };

  // ── nodes ──
  const nodes: MapNode[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: MapNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const areaSet = new Set<string>();
  const frontendAreas = new Set<string>();
  const nextLikeAreas = new Set<string>();
  for (const p of parsed) {
    const a = areaOf(p);
    areaSet.add(a);
    if (facts[p].hasJsx) frontendAreas.add(a);
    if (/(^|\/)(app|pages)\/.*\.[jt]sx?$/.test(p) && (facts[p].routes.length || /(^|\/)(page|layout)\.[jt]sx$/.test(p))) nextLikeAreas.add(a);
  }
  for (const [dir] of [...manifestDirs].map((d) => [d] as const)) {
    const pj = byPath.get(dir ? `${dir}/package.json` : "package.json");
    if (pj && /"(react|react-dom|vue|svelte|next|@angular\/core|solid-js)"/.test(pj.content)) frontendAreas.add(areaOf(pj.path));
  }

  const fileNodeId = (p: string) => `file:${p}`;
  const displayName = (p: string) => {
    const a = areaOf(p);
    let rel = manifestDirs.has(a) && p.startsWith(a + "/") ? p.slice(a.length + 1) : p;
    // A Blade view is named as view() names it: resources/views/todos/index.blade.php → resources/views/todos/index.
    if (rel.endsWith(".blade.php")) return rel.slice(0, -".blade.php".length);
    // A Twig template likewise: templates/todo/index.html.twig → templates/todo/index.
    if (rel.endsWith(".twig")) return rel.replace(/(\.html)?\.twig$/, "");
    rel = rel.replace(/^(src|app|lib)\//, "").replace(/\.[^.]+$/, "").replace(/\/index$/, "");
    return rel;
  };
  const layerOfFile = (p: string): Layer => {
    const f = facts[p];
    const lang = langOf(p);
    if (lang === "sql" || lang === "prisma") return "data";
    if (f.routes.length) return "api";
    const a = areaOf(p);
    if (f.hasJsx) return "ui";
    if (lang === "py") return /(^|\/)(migrations?|models|schema)\//.test(p) && f.sql.length ? "data" : "logic";
    // Dart: widgets are the screen; providers, models and API clients are logic.
    if (lang === "dart") return /(^|\/)(db|database|data|schema|migrations?)\//.test(p) && f.sql.length ? "data" : "logic";
    // PHP: Blade views, Twig templates and Livewire components are the screen (hasJsx, above); Eloquent models,
    // migrations, Doctrine entities and repositories are the data; the rest (controllers, services, jobs) is logic,
    // even beside a Vue or React front end in the same package.
    if (lang === "php") return /(^|\/)(models|migrations|entity|repository)\//i.test(p) && f.sql.length ? "data" : "logic";
    if (frontendAreas.has(a)) {
      if (nextLikeAreas.has(a)) return /(^|\/)(app|pages|components|hooks|ui)\//.test(p) ? "ui" : "logic";
      // A front-end package: plain .ts files are front-end helpers unless they clearly live server-side.
      return /(^|\/)(server|backend|functions|api|workers?|scripts?)\//.test(p) ? "logic" : "ui";
    }
    if (/(^|\/)(migrations?|db|database|models|schema|prisma)\//.test(p) && f.sql.length) return "data";
    return "logic";
  };

  /** Line ranges a route owns: the registration/decorator span, plus the body of
   * a named handler defined in the same file (`app.get("/x", getUser)`). */
  const routeNodeOf = new Map<RouteFact, string>();
  const routeSpans = (f: FileFacts): { route: RouteFact; start: number; end: number }[] => {
    const out: { route: RouteFact; start: number; end: number }[] = [];
    for (const r of f.routes) {
      out.push({ route: r, start: r.line, end: r.endLine });
      if (!r.handler) continue;
      const fn = f.fns.find((x) => x.name === r.handler) ?? f.nested.find((x) => x.name === r.handler);
      if (fn && (fn.start < r.line || fn.end > r.endLine)) out.push({ route: r, start: fn.start, end: fn.end });
    }
    return out;
  };
  const inRouteSpan = (f: FileFacts, line: number) => routeSpans(f).some((s) => line >= s.start && line <= s.end);

  for (const p of parsed) {
    const f = facts[p];
    const layer = layerOfFile(p);
    // Router files are represented by their routes; still add the module when others import it,
    // or when it holds a request/SQL/channel/rpc fact outside every route, so the fact has a home.
    const importedByOthers = importEdges.some((e) => e.to === p && e.from !== p);
    const looseFact = [...f.http, ...f.sql, ...f.channels, ...f.rpc].some((x) => !inRouteSpan(f, x.line));
    if (!f.routes.length || importedByOthers || looseFact || f.fns.some((x) => x.exported && !f.routes.some((r) => r.handler === x.name))) {
      addNode({ id: fileNodeId(p), layer, kind: f.hasJsx ? "component" : "module", name: displayName(p), area: areaOf(p), file: p, line: 1, endLine: f.lines });
    }
    for (const r of f.routes) {
      const prefix = r.owner ? resolvePrefix(p, r.owner) : "";
      const full = joinRoute(prefix, r.path);
      const id = `route:${p}#${r.method} ${full}`;
      routeNodeOf.set(r, id);
      addNode({ id, layer: "api", kind: "route", name: `${r.method === "ANY" ? "" : r.method + " "}${full}`, area: areaOf(p), file: p, line: r.line, endLine: r.endLine, method: r.method, path: full, handler: r.handler, ...(r.name ? { note: `named ${r.name}` } : {}) });
    }
  }
  const routeNodes = nodes.filter((n) => n.kind === "route");
  // A screen's card says where the app's router shows it (go_router, MaterialApp routes).
  for (const s of dartScreens) {
    const n = nodes.find((x) => x.id === fileNodeId(s.file));
    if (n) n.note = `screen at ${s.paths.join(", ")} (${basename(s.at.file)}:${s.at.line})`;
  }

  const svcId = (s: string) => `svc:${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // ── edges ──
  const edges = new Map<string, MapEdge>();
  /** One edge per (kind, from, to); more call sites append their evidence. A
   * config line that resolved the call (compose, next.config) is evidence too. */
  const addEdge = (from: string, to: string, kind: EdgeKind, confidence: Confidence, ev: Evidence | Evidence[], note?: string, fromFn?: string, toFn?: string) => {
    if (from === to) return;
    const id = `${kind}:${from}->${to}`;
    let e = edges.get(id);
    if (!e) {
      e = { id, from, to, kind, confidence, evidence: [], note };
      edges.set(id, e);
    }
    if (confidence === "certain" && e.confidence === "likely") {
      e.confidence = "certain";
      e.note = note;
    } else if (confidence === "likely" && e.confidence === "likely" && note && e.note && note.split("; ").length < e.note.split("; ").length) {
      // Two guesses at the same arrow: keep the reason of the call site we are surer of (say, one that names its method).
      e.note = note;
    }
    // The user's answer can sit on the same line as the code that reads the setting: both are kept.
    for (const x of Array.isArray(ev) ? ev : [ev]) if (!e.evidence.some((y) => y.file === x.file && y.line === x.line && (y.role === "user") === (x.role === "user"))) e.evidence.push(x);
    if (fromFn && !(e.fromFns ??= []).includes(fromFn)) e.fromFns.push(fromFn);
    if (toFn && !(e.toFns ??= []).includes(toFn)) e.toFns.push(toFn);
  };
  const lineText = (p: string, line: number) => (byPath.get(p)?.content.split("\n")[line - 1] ?? "").trim().slice(0, 160);
  /** The node that "owns" a line: the route whose registration or named handler
   * spans it (smallest span wins), else the file. */
  const containerAt = (p: string, line: number): string | null => {
    const f = facts[p];
    let best: { id: string; span: number } | null = null;
    for (const s of routeSpans(f)) {
      if (line < s.start || line > s.end) continue;
      const span = s.end - s.start;
      const id = routeNodeOf.get(s.route);
      if (id && (!best || span < best.span)) best = { id, span };
    }
    if (best) return best.id;
    if (nodeIds.has(fileNodeId(p))) return fileNodeId(p);
    return null;
  };
  const fnAt = (p: string, line: number): string | undefined => facts[p].fns.find((x) => line >= x.start && line <= x.end)?.name;
  const triggerFor = (p: string, line: number): Evidence["trigger"] | undefined => {
    const f = facts[p];
    const names = new Set<string>();
    const top = fnAt(p, line);
    if (top) names.add(top);
    for (const n of f.nested) if (line >= n.start && line <= n.end) names.add(n.name);
    for (const t of f.triggers) {
      if (t.range && line >= t.range[0] && line <= t.range[1]) return { element: t.element, label: t.label, line: t.line };
      for (const fn of names) if (t.handler === fn || t.handler.endsWith(`.${fn}`)) return { element: t.element, label: t.label, line: t.line };
    }
    return undefined;
  };

  // ── services (§4): config seeds, app vs library, the monolith rule ──
  const areas = [...areaSet].sort();
  const detected = detectServices({ name: opts.name, config, areas, manifestDirs, areaOf, byPath, facts, nodes, importEdges, nextLikeAreas, lineText, repos: opts.repos });
  // Which repo each service's code (or config) is in, when several are open.
  if (multiRepo) {
    for (const s of detected.services) {
      if (s.kind === "placeholder") continue;
      const at = s.areas[0] !== undefined && manifestDirs.has(s.areas[0]) ? `${s.areas[0]}/` : s.evidence[0]?.file;
      const r = opts.repos!.find((x) => x.prefix && at?.startsWith(x.prefix));
      if (r) s.repo = r.label;
    }
  }
  for (const n of nodes) {
    const svc = n.layer === "external" ? undefined : detected.serviceOfArea.get(n.area);
    if (svc) n.service = svc;
  }

  // ── tables, one node per table per database (§5 Tables) ──
  // A monolith keeps `table:<name>`. In a system of services a table is scoped by
  // its database (`table:svc-postgres/shop/users`) when that database is a real
  // one config names, or when two databases have a table of the same name; a
  // service's own unnamed database keeps the plain id, so maps stay stable.
  const isServices = detected.kind === "services";
  const serviceOfFile = (p: string): string | undefined => detected.serviceOfArea.get(areaOf(p));
  const importersOf = new Map<string, Set<string>>(); // library area → app services that import it
  for (const e of importEdges) {
    const a = areaOf(e.to);
    const s = serviceOfFile(e.from);
    if (!detected.libraries.has(a) || !s || areaOf(e.from) === a) continue;
    importersOf.set(a, (importersOf.get(a) ?? new Set()).add(s));
  }
  /** Databases a SQL fact lands in: its service's; a schema in a library shared by ≥2 apps defines tables in each one's. */
  const dbsOfFact = (p: string, op: string): (string | undefined)[] => {
    const imp = importersOf.get(areaOf(p));
    if (op === "define" && imp && imp.size >= 2) return [...imp].map((s) => detected.dbOf.get(s));
    const s = serviceOfFile(p);
    return [s ? detected.dbOf.get(s) : undefined];
  };
  const tableDbs = new Map<string, Set<string>>();
  for (const p of parsed) for (const q of facts[p].sql) for (const db of dbsOfFact(p, q.op)) if (db) tableDbs.set(q.table.toLowerCase(), (tableDbs.get(q.table.toLowerCase()) ?? new Set()).add(db));
  /** A fact with no service (a loose script) joins the table's one database, if it has only one. */
  const dbFor = (name: string, db: string | undefined): string | undefined => {
    if (db) return db;
    const dbs = tableDbs.get(name.toLowerCase());
    return dbs?.size === 1 ? [...dbs][0] : undefined;
  };
  const tableId = (name: string, db: string | undefined): string => {
    const n = name.toLowerCase();
    if (!isServices || !db) return `table:${n}`;
    if (db.startsWith("own:") && (tableDbs.get(n)?.size ?? 0) <= 1) return `table:${n}`;
    return `table:${db}/${n}`;
  };
  const definedTables = new Set<string>();
  for (const p of parsed) {
    for (const q of facts[p].sql) {
      for (const d of dbsOfFact(p, q.op)) {
        const db = dbFor(q.table, d);
        const id = tableId(q.table, db);
        if (q.op === "define") definedTables.add(id);
        if (nodeIds.has(id)) continue;
        const t: MapNode = { id, layer: "data", kind: "table", name: q.table, area: areaOf(p) };
        const svc = serviceOfFile(p);
        if (svc) t.service = svc;
        if (isServices && db) t.db = db;
        addNode(t);
      }
    }
  }
  // A table's columns, from the code that creates it (CREATE TABLE, a Prisma model, an ORM class, a migration),
  // cited at the first line that lists them; a later migration that adds columns adds them at the end.
  const tableById = new Map(nodes.filter((n) => n.kind === "table").map((n) => [n.id, n]));
  for (const p of parsed) {
    for (const c of facts[p].columns ?? []) {
      for (const d of dbsOfFact(p, "define")) {
        const n = tableById.get(tableId(c.table, dbFor(c.table, d)));
        if (!n) continue;
        const had = (n.columns ??= []);
        for (const col of c.columns) {
          const old = had.find((x) => x.name.toLowerCase() === col.name.toLowerCase());
          if (!old) had.push({ ...col });
          else if (!old.type && col.type) old.type = col.type;
        }
        n.columnsAt ??= { file: p, line: c.line };
      }
    }
  }

  // imports
  for (const e of importEdges) {
    const from = fileNodeId(e.from);
    const to = fileNodeId(e.to);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    const ev: Evidence = { file: e.from, line: e.line, text: lineText(e.from, e.line) };
    addEdge(from, to, "imports", "certain", ev);
    const edge = edges.get(`imports:${from}->${to}`)!;
    for (const n of e.names) if (!(edge.toFns ??= []).includes(n)) edge.toFns.push(n);
  }
  // route handler → module (what the handler actually calls)
  for (const p of parsed) {
    const f = facts[p];
    for (const rn of routeNodes.filter((n) => n.file === p)) {
      const fn = rn.handler ? f.fns.find((x) => x.name === rn.handler) : undefined;
      const calls = fn?.calls ?? [];
      for (const c of calls) {
        const [head, ...rest] = c.split(".");
        const bnd = bindings[p].get(head);
        if (!bnd || !nodeIds.has(fileNodeId(bnd.file))) continue;
        const toFn = bnd.name === "*" ? rest[0] : bnd.name;
        const at = rn.line ?? 1;
        addEdge(rn.id, fileNodeId(bnd.file), "calls", "certain", { file: p, line: at, text: lineText(p, at) }, undefined, rn.handler, toFn);
      }
    }
    // module fn-level annotations on import edges
    for (const fn of f.fns) {
      for (const c of fn.calls) {
        const [head, ...rest] = c.split(".");
        const bnd = bindings[p].get(head);
        if (!bnd) continue;
        const e = edges.get(`imports:${fileNodeId(p)}->${fileNodeId(bnd.file)}`);
        if (!e) continue;
        if (!(e.fromFns ??= []).includes(fn.name)) e.fromFns.push(fn.name);
        const toFn = bnd.name === "*" ? rest[0] : bnd.name;
        if (toFn && !(e.toFns ??= []).includes(toFn)) e.toFns.push(toFn);
      }
    }
  }
  // PHP: a route → its controller method. Both lines are cited: where the route names it, and where it is defined.
  for (const h of phpLinks.handlers) {
    const from = routeNodeOf.get(h.route);
    const to = fileNodeId(h.target);
    if (!from || !nodeIds.has(to)) continue;
    const ev: Evidence[] = [{ file: h.file, line: h.route.line, text: lineText(h.file, h.route.line) }];
    if (h.start !== undefined) ev.push({ file: h.target, line: h.start, text: lineText(h.target, h.start) });
    addEdge(from, to, "calls", h.confidence, ev, h.note, undefined, h.method);
  }
  // PHP: a route → the page it returns (view('todos.index')). A line in a controller method belongs to the
  // routes that name that method; a line in a route's closure to that route; anywhere else to its own card.
  for (const v of phpLinks.views) {
    const to = fileNodeId(v.target);
    if (!nodeIds.has(to)) continue;
    // A Livewire component's view is also drawn from the component's own card (`own`).
    const froms = [...(v.routes.length ? v.routes.map((r) => routeNodeOf.get(r)) : []), ...(!v.routes.length || v.own ? [containerAt(v.file, v.line)] : [])].filter((x): x is string => !!x);
    for (const from of froms) addEdge(from, to, "calls", "certain", { file: v.file, line: v.line, text: lineText(v.file, v.line) }, undefined, fnAt(v.file, v.line));
  }
  // PHP: a Blade form or link → the route it goes to, as a request (what fetch() from a page draws).
  for (const q of phpLinks.requests) {
    const from = containerAt(q.file, q.line);
    if (!from) continue;
    const ev: Evidence = { file: q.file, line: q.line, text: lineText(q.file, q.line), trigger: { element: q.element, ...(q.label ? { label: q.label } : {}), line: q.line } };
    for (const r of q.routes) {
      const to = routeNodeOf.get(r);
      if (to) addEdge(from, to, "calls-route", q.confidence, ev, q.note, undefined, r.handler);
    }
  }
  // Livewire: `wire:click="save"` in a component's view → the component's save(), both lines cited.
  for (const w of phpLinks.wires) {
    const from = fileNodeId(w.file);
    const to = fileNodeId(w.target);
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    const ev: Evidence[] = [
      { file: w.file, line: w.line, text: lineText(w.file, w.line), trigger: { element: `wire:${w.event}`, line: w.line } },
      { file: w.target, line: w.start, text: lineText(w.target, w.start) },
    ];
    addEdge(from, to, "calls", "certain", ev, undefined, undefined, w.method);
  }
  warnings.push(...phpLinks.warnings);

  // ── resolving a request across services (§5) ──
  // Tables built once: hostnames (compose names, folder names), published ports,
  // the env settings each service is given, and the rewrite/proxy rules.
  const allServices = detected.services;
  const svcById = new Map(allServices.map((s) => [s.id, s]));
  interface HostHit {
    service: ServiceDef;
    confidence: Confidence;
    evidence: Evidence[];
    note?: string;
    /** Taken to be the repo's only app because the call is to localhost: on a miss, v1's search runs. */
    onlyApp?: boolean;
    /** A public address (§13 "Whose address is this?"): the service's own deploy config gives it, or the user said whose it is. */
    address?: { host: string; by: "config" | "user" };
  }
  const hostTable = new Map<string, HostHit>();
  const devHostTable = new Map<string, HostHit>();
  const indexHosts = (s: ServiceDef) => {
    const boundary = s.evidence.slice(0, 1).map((e) => ({ file: e.file, line: e.line, text: e.text, ...(e.role ? { role: e.role } : {}) }));
    for (const h of s.hostnames) {
      const k = h.toLowerCase();
      if (hostTable.has(k)) continue;
      const guessed = detected.guessedHosts.has(`${s.id}|${h}`);
      hostTable.set(k, { service: s, confidence: guessed ? "likely" : "certain", evidence: boundary, note: guessed ? `I took ${h} to be the ${s.name} service by its folder name` : undefined });
    }
    for (const d of s.devHosts) {
      const k = d.toLowerCase();
      const at = boundary[0] ? ` (${boundary[0].file}:${boundary[0].line})` : "";
      if (!devHostTable.has(k)) devHostTable.set(k, { service: s, confidence: "likely", evidence: boundary, note: `matched by the port: ${d} is where the ${s.name} service is published${at}` });
    }
  };
  for (const s of allServices) indexHosts(s);
  /** "Whose address is this?": what the user said about public addresses, by host (lower case). */
  const hostAnswers = new Map((opts.assertions ?? []).filter((a) => a.host).map((a) => [hostKey(a.host!), a]));
  /** The app an answer names, by id or by name (the CLI's --assume takes either). */
  const answeredApp = (want: string | null | undefined): ServiceDef | undefined => {
    if (!want) return undefined;
    const s = svcById.get(want) ?? allServices.find((x) => x.name === want || normalisedName(x.name) === normalisedName(want));
    return s?.kind === "app" ? s : undefined;
  };

  type Outcome = { kind: "service"; hit: HostHit } | { kind: "known"; name: string } | { kind: "outside"; host: string } | { kind: "bare"; host: string } | { kind: "local" } | { kind: "unknown" } | { kind: "path" };
  const LOCAL_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:\d+)?$/;
  const PRIVATE_IP = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254)\.\d+\.\d+$/;
  const DYNAMIC_HOST = /[*${}]/;
  /** A host on the internet that no name in config gives a service, and not a company WalkMyCode knows: "Whose
   * address is this?" (§13). The service's own deploy config, or the user, may still say whose it is. */
  const isPublicHost = (hostIn: string): boolean => {
    const host = hostIn.toLowerCase();
    const bare = host.replace(/:\d+$/, "");
    if (DYNAMIC_HOST.test(host) || serviceForHost(host) || LOCAL_RE.test(host) || PRIVATE_IP.test(bare)) return false;
    if (!bare.includes(".") || /\.(local|internal|svc|svc\.cluster\.local)$/.test(bare)) return false;
    const hit = hostTable.get(host) ?? hostTable.get(hostKey(host)) ?? hostTable.get(bare);
    return !hit || !!hit.address;
  };
  /** A host → the service behind it. Internal names never become outside services (§11). */
  const resolveHost = (hostIn: string, S: string | undefined): Outcome => {
    const host = hostIn.toLowerCase();
    if (DYNAMIC_HOST.test(host)) return { kind: "unknown" }; // built at run time
    const known = serviceForHost(host);
    if (known) return { kind: "known", name: known };
    const bare = host.replace(/:\d+$/, "");
    const port = /:(\d+)$/.exec(host)?.[1];
    // What the user said about a public address wins over deploy config; "another company's / not sure" leaves it outside.
    const said = hostAnswers.size ? (hostAnswers.get(hostKey(host)) ?? hostAnswers.get(bare)) : undefined;
    if (said && isPublicHost(host)) {
      const app = answeredApp(said.service);
      if (app) return { kind: "service", hit: { service: app, confidence: "certain", evidence: [], address: { host: hostKey(host), by: "user" } } };
      if (said.service === null) return { kind: "outside", host };
    }
    const hit = hostTable.get(host) ?? hostTable.get(hostKey(host)) ?? hostTable.get(bare);
    if (hit) return { kind: "service", hit };
    if (LOCAL_RE.test(host)) {
      const alias = port ? (devHostTable.get(`localhost:${port}`) ?? devHostTable.get(`127.0.0.1:${port}`)) : undefined;
      if (alias) return { kind: "service", hit: alias };
      const own = S ? svcById.get(S) : undefined;
      if (own && port && own.ports.some((x) => String(x.container) === port || String(x.host) === port)) return { kind: "service", hit: { service: own, confidence: "certain", evidence: [] } };
      const apps = allServices.filter((s) => s.kind === "app");
      if (apps.length === 1) return { kind: "service", hit: { service: apps[0], confidence: "certain", evidence: [], onlyApp: true } };
      return { kind: "local" };
    }
    if (PRIVATE_IP.test(bare)) return { kind: "local" };
    if (!bare.includes(".") || /\.(local|internal|svc|svc\.cluster\.local)$/.test(bare)) {
      // One of this system's own services by its name (payments → the payments-service repo): a guess, never a placeholder.
      const first = bare.split(".")[0];
      const named = allServices.find((s) => s.kind === "app" && normalisedName(s.name) === normalisedName(first));
      if (named) {
        const boundary = named.evidence.slice(0, 1).map((e) => ({ file: e.file, line: e.line, text: e.text, ...(e.role ? { role: e.role } : {}) }));
        return { kind: "service", hit: { service: named, confidence: "likely", evidence: boundary, note: `I took ${bare} to be the ${named.name} service by its name` } };
      }
      return { kind: "bare", host };
    }
    return { kind: "outside", host };
  };

  // ── public addresses a service's own repo gives it in deploy config (§13 "Whose address is this?") ──
  // A CI step that health-checks https://api.example.com after deploying, a Caddy site, a Traefik rule, nginx
  // server_name, an Ingress host, fly.toml, render.yaml, app.yaml, vercel.json or a CNAME file says where a
  // service answers on the internet. The address is that service's when the config says where it leads (a
  // compose service, a backend, an upstream), when it belongs to a service's folder, or when its repo holds
  // one app. It joins the service's hostnames with its line as evidence; two services given one address get neither.
  const isRepoRoot = (dir: string) => dir === "" || (opts.repos ?? []).some((r) => r.prefix && r.prefix === `${dir}/`);
  const appOfDir = (dir: string): ServiceDef | undefined => {
    let best: { s: ServiceDef; len: number } | undefined;
    for (const s of allServices) {
      if (s.kind !== "app") continue;
      for (const d of [detected.serviceDirs.get(s.id), ...s.areas.filter((a) => manifestDirs.has(a))]) {
        if (d === undefined || isRepoRoot(d) || !(dir === d || dir.startsWith(`${d}/`))) continue;
        if (!best || d.length > best.len) best = { s, len: d.length };
      }
    }
    return best?.s;
  };
  const ownerOfAddress = (a: DeployAddress): ServiceDef | undefined => {
    if (a.to) {
      const to = a.to.toLowerCase();
      const hit = hostTable.get(to) ?? hostTable.get(to.replace(/:\d+$/, ""));
      if (hit?.confidence === "certain") return hit.service;
      const named = allServices.find((s) => s.kind !== "placeholder" && normalisedName(s.name) === normalisedName(to.replace(/:\d+$/, "")));
      if (named) return named;
      // A proxy on the same machine (localhost:3000) does not say which app: its folder or its repo does. Anywhere else: not ours to say.
      if (!LOCAL_RE.test(to) && !PRIVATE_IP.test(to.replace(/:\d+$/, ""))) return undefined;
    }
    const byDir = a.dir ? appOfDir(a.dir) : undefined;
    if (byDir) return byDir;
    const repo = multiRepo ? opts.repos!.find((r) => r.prefix && a.file.startsWith(r.prefix)) : undefined;
    const apps = allServices.filter((s) => s.kind === "app" && (!repo || s.repo === repo.label));
    return apps.length === 1 ? apps[0] : undefined;
  };
  const deployed = new Map<string, { service: ServiceDef; evidence: Evidence } | null>();
  for (const a of config.addresses) {
    const host = hostKey(a.host);
    const owner = deployed.get(host) === null ? undefined : ownerOfAddress(a);
    if (!owner) continue;
    const prev = deployed.get(host);
    if (prev && prev.service !== owner) {
      deployed.set(host, null);
      warnings.push(`${host} is given to both the ${prev.service.name} service (${prev.evidence.file}:${prev.evidence.line}) and the ${owner.name} service (${a.file}:${a.line}), so I don't know whose it is`);
    } else if (!prev) deployed.set(host, { service: owner, evidence: { file: a.file, line: a.line, text: lineText(a.file, a.line), role: "config" } });
  }
  for (const [host, d] of deployed) {
    if (!d || hostTable.has(host)) continue; // a name config already gives a service keeps it
    if (!d.service.hostnames.includes(host)) d.service.hostnames.push(host);
    (d.service.addresses ??= []).push({ host, evidence: d.evidence });
    hostTable.set(host, { service: d.service, confidence: "certain", evidence: [d.evidence], address: { host, by: "config" } });
  }

  interface Base {
    outcome: Outcome;
    /** Path segments the base URL carries ("http://users:8080/v1" → ["v1"]). */
    basePath: string[];
    evidence: Evidence[];
    notes: string[];
    /** Matched by the setting's name only: the path still starts with an unknown prefix. */
    heuristic?: boolean;
    /** The base is added by a helper the request is sent through, so a leading `*` is still part of the path. */
    keepLeading?: boolean;
    /** The value it was read from ("https://api.example.com/v1"), and that value's host, when it came from one. */
    value?: string;
    host?: string;
  }
  /** A base URL value from config or code: "http://users:8080", "users:8080", "/api". */
  const baseFromValue = (value: string, evidence: Evidence[], S: string | undefined): Base | null => {
    const v = value.trim();
    if (v.startsWith("/")) return { outcome: { kind: "path" }, basePath: callSegments(v).segs, evidence, notes: [] };
    const url = /^(?:https?|wss?):\/\//i.test(v) ? v : /^[\w.-]+(:\d+)?(\/|$)/.test(v) ? `http://${v}` : null;
    if (!url) return null;
    const { segs, host } = callSegments(url);
    if (!host) return null;
    return { outcome: resolveHost(host, S), basePath: segs, evidence, notes: [], value: v, host };
  };
  /** The value a service is given for an env setting: its own table first, then any file's, then any service's. */
  const envLookup = (name: string, S: string | undefined): { value: string; evidence: Evidence; likely?: string } | undefined => {
    const own = S ? svcById.get(S)?.env[name] : undefined;
    const cfg = config.envValues.find((v) => v.name === name && !v.scope && !v.likely) ?? config.envValues.find((v) => v.name === name && !v.likely) ?? config.envValues.find((v) => v.name === name);
    const pick = own ?? (cfg ? { value: cfg.value, file: cfg.file, line: cfg.line } : undefined) ?? allServices.map((s) => s.env[name]).find(Boolean);
    if (!pick) return undefined;
    const ev: Evidence = { file: pick.file, line: pick.line, text: lineText(pick.file, pick.line) };
    if (configKindOf(pick.file, byPath.get(pick.file)?.content ?? "") || !langOf(pick.file)) ev.role = "config";
    const likely = !own && cfg && pick.file === cfg.file && pick.line === cfg.line ? cfg.likely : undefined;
    return { value: pick.value, evidence: ev, ...(likely ? { likely } : {}) };
  };
  const URL_SETTING = /^(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)?([A-Z0-9]+?)_(?:SERVICE_|SVC_)?(?:URL|HOST|BASE_URL|BASEURL|ENDPOINT|API_URL|API|ADDR)$/;
  /** Kubernetes' own `<NAME>_SERVICE_HOST`: the service by that name. */
  const k8sService = (name: string): ServiceDef | undefined => {
    const k8s = /^(.+)_SERVICE_HOST$/.exec(name);
    if (!k8s) return undefined;
    const want = normalisedName(k8s[1].toLowerCase().replace(/_/g, "-"));
    return allServices.find((x) => normalisedName(x.name) === want);
  };
  /** The service a setting's name suggests (USERS_URL → users), as a guess. */
  const namedService = (name: string): ServiceDef | undefined => {
    const m = URL_SETTING.exec(name);
    if (!m) return undefined;
    const stem = normalisedName(m[1].toLowerCase());
    return allServices.find((x) => (x.kind === "app" || x.kind === "placeholder") && normalisedName(x.name) === stem);
  };
  const resolveEnv = (name: string, S: string | undefined, told?: Told): Base | null => {
    const s = k8sService(name);
    if (s) return { outcome: { kind: "service", hit: { service: s, confidence: "certain", evidence: s.evidence.slice(0, 1) } }, basePath: [], evidence: [], notes: [] };
    const hit = envLookup(name, S);
    if (hit) {
      const b = baseFromValue(hit.value, [hit.evidence], S);
      if (b && hit.likely && b.outcome.kind === "service") {
        // A value from a Helm values file: the template that turns it into this setting is not read.
        b.outcome = { kind: "service", hit: { ...b.outcome.hit, confidence: "likely", note: `${name} is ${hit.value} ${hit.likely} (${hit.evidence.file}:${hit.evidence.line})` } };
      }
      if (b && b.outcome.kind !== "unknown") return b;
    }
    // What the user told WalkMyCode stands in for a value from config (§5, after config, before the name).
    if (told) return toldBase(told);
    const named = namedService(name);
    if (named) return { outcome: { kind: "service", hit: { service: named, confidence: "likely", evidence: [] } }, basePath: [], evidence: [], notes: [`matched by the setting's name ${name} (I found no value for it in your config)`], heuristic: true };
    return null;
  };

  // ── "Where does this point?" (docs/SERVICES.md §13) ──
  // A request's base URL can come from a setting: read in the URL itself, in a function the
  // URL starts with (`${getApiBaseUrl()}/x`), in an imported constant, or in the helper the
  // request is sent through (`fetchApi("/x")`, whose own code reads the setting or makes the
  // request on it). A setting nothing in the workspace gives a value is listed on the map, and
  // the user's answer about it stands in for config. A request on such a base that no route
  // here answers is drawn, as a guess, to a stand-in for wherever the setting points.
  /** A name a base URL is kept in: VITE_API_URL, API_BASE, NEXT_PUBLIC_API, USERS_HOST. */
  const BASE_NAME = /(?:^|_)(?:URL|URI|HOST|HOSTNAME|BASE|BASEURL|ENDPOINT|ORIGIN|ADDR|ADDRESS|API|SERVER)$/;
  /** Never asked about: secrets, and another company's settings (STRIPE_API_BASE). */
  const askable = (name: string) => !/SECRET|TOKEN|KEY|PASSWORD|PASS|PWD|PRIVATE/.test(name) && !serviceForEnv(name);
  /** Where a request's base comes from: a setting, a code default, or both, and the line that holds it.
   * `exact`: found in a request whose URL is just the base and one more piece (`${API_URL}${path}`). */
  type Ref = { name?: string; literal?: string; file: string; line: number; exact?: boolean };
  interface BaseRef {
    name?: string;
    literal?: string;
    /** The line that reads the setting (or holds the default) for this request. */
    at: { file: string; line: number };
    via: "direct" | "call" | "const" | "helper";
    /** Via a helper whose own request is just the base and the path it is given: the URL is visibly built on the base. */
    exact?: boolean;
  }
  interface Told {
    unset: BaseRef & { name: string };
    service: ServiceDef;
  }
  const answers = new Map((opts.assertions ?? []).filter((a) => !a.host).map((a) => [a.setting, a]));
  /** "A separate backend I don't have here": the answer that names a setting's own stand-in. */
  const elsewhereId = (setting: string) => serviceId(setting);
  /** The stand-in for wherever a setting with no value points: one of this system's own services, code not here. */
  const settingPlaceholder = (setting: string, at: { file: string; line: number }): ServiceDef => {
    const existing = allServices.find((x) => x.kind === "placeholder" && x.setting === setting);
    if (existing) return existing;
    let id = elsewhereId(setting);
    for (let i = 2; svcById.has(id); i++) id = `${elsewhereId(setting)}-${i}`;
    const s: ServiceDef = {
      id,
      name: setting,
      kind: "placeholder",
      areas: [],
      hostnames: [],
      devHosts: [],
      ports: [],
      env: {},
      dependsOn: [],
      evidence: [{ file: at.file, line: at.line, text: lineText(at.file, at.line) }],
      confidence: "likely",
      counts: { ui: 0, api: 0, logic: 0, data: 0 },
      setting,
    };
    allServices.push(s);
    svcById.set(id, s);
    return s;
  };
  /** The service an answer names, by id or by name: an app, or the setting's own stand-in. */
  const answeredService = (setting: string, at?: { file: string; line: number }): ServiceDef | undefined => {
    const want = answers.get(setting)?.service;
    if (!want) return undefined;
    const s = svcById.get(want) ?? allServices.find((x) => x.name === want || normalisedName(x.name) === normalisedName(want));
    if (s?.kind === "app") return s;
    if (want === elsewhereId(setting) && at) return settingPlaceholder(setting, at);
    return undefined;
  };
  const toldBase = (t: Told): Base => ({
    outcome: { kind: "service", hit: { service: t.service, confidence: "certain", evidence: [] } },
    basePath: [],
    evidence: [{ file: t.unset.at.file, line: t.unset.at.line, text: `you told WalkMyCode: ${t.unset.name} → ${t.service.setting === t.unset.name ? "a separate backend whose code isn't here" : t.service.name}`, role: "user", setting: t.unset.name }],
    notes: [],
  });
  /** A call inside a file → the function it runs: one in the same file, or one imported. */
  const fnTarget = (file: string, call: string): { file: string; name: string } | null => {
    const [head, ...rest] = call.split(".");
    if (!rest.length && facts[file]?.fns.some((x) => x.name === head)) return { file, name: head };
    const bnd = bindings[file]?.get(head);
    if (!bnd) return null;
    const name = bnd.name === "*" ? rest[0] : rest.length ? undefined : bnd.name;
    return name && facts[bnd.file]?.fns.some((x) => x.name === name) ? { file: bnd.file, name } : null;
  };
  /** An imported constant bound to a setting or a default (`export const API = process.env.API_URL`). */
  const importedConst = (p: string, ident: string): Ref | undefined => {
    const bnd = bindings[p]?.get(ident);
    const c = bnd && bnd.name !== "*" && bnd.name !== "default" ? facts[bnd.file]?.consts[bnd.name] : undefined;
    if (!c || !(c.envVar ? askable(c.envVar) : c.literal !== undefined)) return undefined;
    return { ...(c.envVar ? { name: c.envVar } : {}), ...(c.literal !== undefined ? { literal: c.literal } : {}), file: bnd!.file, line: c.line };
  };
  /** The base of a request a function makes itself: `fetch(`${API_URL}${path}`)`. */
  const requestBase = (file: string, h: HttpCallFact, depth: number, seen: Set<string>): Ref[] => {
    if (!h.fromVariable || h.binding || callSegments(h.url).host) return [];
    const consts = Object.values(facts[file].consts);
    const exact = h.url === "**" ? { exact: true } : {};
    if (h.varName) {
      if (!askable(h.varName)) return [];
      const line = consts.find((c) => c.envVar === h.varName)?.line ?? h.line;
      return [{ name: h.varName, ...(h.literalBase !== undefined ? { literal: h.literalBase } : {}), file, line, ...exact }];
    }
    if (h.literalBase !== undefined) return [{ literal: h.literalBase, file, line: consts.find((c) => c.literal === h.literalBase)?.line ?? h.line, ...exact }];
    if (h.baseCall) {
      const t = fnTarget(file, h.baseCall);
      return t ? fnBases(t.file, t.name, depth + 1, seen).map((r) => ({ ...r, exact: false })) : [];
    }
    const c = h.baseIdent ? importedConst(file, h.baseIdent) : undefined;
    return c ? [{ ...c, ...exact }] : [];
  };
  /** The bases a function puts in front of a URL: a base-URL setting its body reads, else the base of a
   * request it makes itself, else what the functions it calls put there (four calls deep). */
  const fnBases = (file: string, fnName: string, depth = 0, seen = new Set<string>()): Ref[] => {
    const key = `${file}#${fnName}`;
    if (depth > 4 || seen.has(key)) return [];
    seen.add(key);
    const f = facts[file];
    const fn = f.fns.find((x) => x.name === fnName)!;
    const inside = (line: number) => line >= fn.start && line <= fn.end;
    let out: Ref[] = f.envReads.filter((r) => inside(r.line) && BASE_NAME.test(r.name) && askable(r.name)).map((r) => ({ name: r.name, file, line: r.line }));
    if (!out.length) for (const h of f.http) if (inside(h.line)) out = out.concat(requestBase(file, h, depth, seen));
    if (!out.length) {
      for (const c of fn.calls) {
        const t = fnTarget(file, c);
        // Through another function the path may change on the way: not exact.
        if (t) out = out.concat(fnBases(t.file, t.name, depth + 1, seen).map((r) => ({ ...r, exact: false })));
      }
    }
    const first = new Map<string, Ref>();
    for (const r of out) if (!first.has(r.name ?? `=${r.literal}`)) first.set(r.name ?? `=${r.literal}`, r);
    return [...first.values()];
  };
  const basesMemo = new Map<string, Ref | null>();
  /** The one base a function stands for, or null (none, or several to choose from). */
  const oneBase = (t: { file: string; name: string } | null): Ref | null => {
    if (!t) return null;
    const key = `${t.file}#${t.name}`;
    if (!basesMemo.has(key)) {
      const rs = fnBases(t.file, t.name);
      basesMemo.set(key, rs.length === 1 ? rs[0] : null);
    }
    return basesMemo.get(key)!;
  };
  const refOf = (r: Ref, via: BaseRef["via"]): BaseRef => ({ ...(r.name ? { name: r.name } : {}), ...(r.literal !== undefined ? { literal: r.literal } : {}), at: { file: r.file, line: r.line }, via, ...(via === "helper" && r.exact ? { exact: true } : {}) });
  /** What a request's base URL is built on, when no host or binding in the call says where it goes. */
  const baseSettingOf = (p: string, h: HttpCallFact): BaseRef | undefined => {
    if (h.binding || callSegments(h.url).host) return undefined;
    if (h.varName) return askable(h.varName) ? { name: h.varName, ...(h.literalBase !== undefined ? { literal: h.literalBase } : {}), at: { file: p, line: h.line }, via: "direct" } : undefined;
    if (h.literalBase !== undefined) return undefined; // a constant in this file: resolved as it always was
    if (h.baseCall) {
      const r = oneBase(fnTarget(p, h.baseCall));
      return r ? refOf(r, "call") : undefined;
    }
    if (h.baseIdent) {
      const c = importedConst(p, h.baseIdent);
      return c ? refOf(c, "const") : undefined;
    }
    // A helper the request goes through: fetchApi("/config"), whose own code puts the base in front.
    const r = /^[A-Za-z_$][\w$]*$/.test(h.callee) ? oneBase(fnTarget(p, h.callee)) : null;
    return r ? refOf(r, "helper") : undefined;
  };
  /** Settings with no value that requests are built on: who reads them, and which calls. */
  const unsetBases = new Map<string, { services: Set<string>; calls: Set<string> }>();

  // Placeholders: one of this system's own services whose code is not here (§4 step 8).
  const placeholderFor = (host: string, evidence: Evidence[]): ServiceDef => {
    const name = host.replace(/:\d+$/, "");
    const existing = allServices.find((x) => x.kind === "placeholder" && normalisedName(x.name) === normalisedName(name));
    if (existing) return existing;
    let id = serviceId(name);
    for (let i = 2; svcById.has(id); i++) id = `${serviceId(name)}-${i}`;
    const port = /:(\d+)$/.exec(host)?.[1];
    const s: ServiceDef = {
      id,
      name,
      kind: "placeholder",
      areas: [],
      hostnames: host === name ? [name] : [name, host],
      devHosts: [],
      ports: port ? [{ container: parseInt(port, 10) }] : [],
      env: {},
      dependsOn: [],
      evidence: evidence.map((e) => ({ file: e.file, line: e.line, text: e.text, ...(e.role ? { role: e.role } : {}) })),
      confidence: "likely",
      counts: { ui: 0, api: 0, logic: 0, data: 0 },
    };
    allServices.push(s);
    svcById.set(id, s);
    indexHosts(s);
    return s;
  };
  /** The card for a service of this system reached without a route: a placeholder, a database, a broker. */
  const internalNode = (s: ServiceDef): string => {
    const id = `svc-int:${s.id}`;
    addNode({ id, layer: "external", kind: "service", name: s.name, area: "", internal: true, service: s.id, ...(s.setting ? { note: `wherever ${s.setting} points: a backend whose code isn't here` } : {}) });
    return id;
  };

  // Rewrite/proxy rules: whose config declares each one, and where it sends.
  const serviceDirs = [...detected.serviceDirs].filter(([, d]) => d !== "").sort((a, b) => b[1].length - a[1].length);
  const ownerOfFile = (p: string) => serviceDirs.find(([, d]) => p.startsWith(d + "/"))?.[0] ?? serviceOfFile(p);
  const rules: GatewayRule[] = config.gateways.map((r) => {
    const out: GatewayRule = { ...r };
    const owner = ownerOfFile(r.evidence.file);
    if (owner) out.ownerService = owner;
    if (!r.toHost && owner) out.toService = owner; // a relative destination stays in the same app
    else if (r.toHost) {
      const o = resolveHost(r.toHost, owner);
      if (o.kind === "service") out.toService = o.hit.service.id;
    }
    return out;
  });
  const literalCount = (r: GatewayRule) => r.source.filter((s) => s !== "*" && s !== "**").length;
  rules.sort((a, b) => literalCount(b) - literalCount(a));
  /** Rules that apply to a path-only request from S: its own first; then a gateway's or an
   * Ingress's (never another app's dev proxy), and only those with a literal prefix. */
  const rulesFor = (S: string | undefined): GatewayRule[] => {
    const own = S ? rules.filter((r) => r.ownerService === S) : [];
    const shared = rules.filter((r) => (S === undefined || r.ownerService !== S) && (!r.ownerService || svcById.get(r.ownerService)?.kind !== "app") && literalCount(r) > 0);
    return [...own, ...shared];
  };
  const GATEWAY_WORD: Record<GatewayRule["kind"], string> = { "next-rewrite": "rewrite", "vite-proxy": "dev-server proxy", "cra-proxy": "dev-server proxy", "angular-proxy": "dev-server proxy", nginx: "nginx proxy", ingress: "Ingress rule", httproute: "HTTPRoute rule" };
  /** The first rule that sends these segments somewhere we can name. */
  const throughGateway = (list: GatewayRule[], segs: string[], S: string | undefined): { rule: GatewayRule; segs: string[]; outcome: Outcome } | null => {
    for (const rule of list) {
      const next = matchGateway(rule, segs);
      if (!next) continue;
      const to = rule.toService ? svcById.get(rule.toService) : undefined;
      const outcome: Outcome = to ? { kind: "service", hit: { service: to, confidence: "certain", evidence: [] } } : rule.toHost ? resolveHost(rule.toHost, rule.ownerService) : { kind: "unknown" };
      if (outcome.kind === "local" || outcome.kind === "unknown" || outcome.kind === "path") continue;
      // A rule that sends a service's path back to itself unchanged says nothing new.
      if (outcome.kind === "service" && outcome.hit.service.id === S && next.join("/") === segs.join("/")) continue;
      return { rule, segs: next, outcome };
    }
    return null;
  };
  const gatewayNote = (r: GatewayRule) => {
    const prefix = r.source.filter((s) => s !== "**");
    return `goes through the ${prefix.length ? `/${prefix.join("/")} ` : ""}${GATEWAY_WORD[r.kind]} in ${r.evidence.file}:${r.evidence.line}`;
  };

  // ── doors described in OpenAPI files (§3): a parsed handler wins; a door only described is kept, with a note ──
  const sameDoor = (code: string[], spec: string[]) => {
    for (let drop = 0; drop <= Math.min(2, spec.length); drop++) {
      const s = spec.slice(drop);
      if (s.length === code.length && s.every((x, i) => x === code[i] || (x === "*" && code[i] === "*"))) return true;
    }
    return false;
  };
  for (const r of config.routes) {
    let owner = serviceOfFile(r.file);
    const host = r.serverUrl ? callSegments(r.serverUrl).host : null;
    if (host) {
      const o = resolveHost(host, owner);
      if (o.kind === "service") owner = o.hit.service.id;
    }
    if (!owner) {
      const apps = allServices.filter((s) => s.kind === "app");
      if (apps.length === 1) owner = apps[0].id;
    }
    const segs = routeSegments(r.path);
    if (routeNodes.some((rn) => (!owner || rn.service === owner) && (rn.method === r.method || rn.method === "ANY") && sameDoor(routeSegments(rn.path!), segs))) continue;
    const id = `route:${r.file}#${r.method} ${r.path}`;
    if (nodeIds.has(id)) continue;
    const ownerDef = owner ? svcById.get(owner) : undefined;
    const n: MapNode = {
      id,
      layer: "api",
      kind: "route",
      name: `${r.method} ${r.path}`,
      area: ownerDef?.areas[0] ?? areaOf(r.file),
      file: r.file,
      line: r.line,
      endLine: r.line,
      method: r.method,
      path: r.path,
      note: `described in ${basename(r.file)}${r.operationId ? ` (${r.operationId})` : ""}; I did not find the code`,
    };
    if (owner) n.service = owner;
    addNode(n);
    routeNodes.push(n);
  }

  const routesByService = new Map<string, MapNode[]>();
  for (const rn of routeNodes) if (rn.service) routesByService.set(rn.service, [...(routesByService.get(rn.service) ?? []), rn]);
  const appsWithRoutes = [...routesByService.keys()].filter((id) => svcById.get(id)?.kind === "app");
  const bestHits = (segs: string[], cands: MapNode[], method: Method | undefined, leadingVar: boolean): MapNode[] => {
    let best = -1;
    let hits: MapNode[] = [];
    for (const rn of cands) {
      if (method && rn.method !== "ANY" && rn.method !== method) continue;
      const score = matchRoute(segs, routeSegments(rn.path!), leadingVar);
      if (score < 0) continue;
      if (score > best) {
        best = score;
        hits = [rn];
      } else if (score === best) hits.push(rn);
    }
    return hits;
  };
  const VAR_NOTE = "The URL starts with a variable, so this is matched by the path only.";
  const METHOD_NOTE = "I couldn't tell the HTTP method from this call, so every route with this path is shown.";
  const MORE_NOTE = "More than one route matches this path.";
  /** Note fragments → one sentence: "Goes through the /api rewrite in x:4; more than one route matches this path." */
  const sentence = (parts: string[]): string | undefined => {
    const clean = parts.map((x) => x.replace(/\.$/, "")).filter(Boolean);
    if (!clean.length) return undefined;
    const s = clean.map((x, i) => (i === 0 ? x[0].toUpperCase() + x.slice(1) : /^(I|URL)\b/.test(x) ? x : x[0].toLowerCase() + x.slice(1))).join("; ");
    return `${s}.`;
  };
  const worse = (a: Confidence, b: Confidence): Confidence => (a === "likely" || b === "likely" ? "likely" : "certain");

  /** `env.USERS.fetch()`: the Worker a wrangler `[[services]]` binding names (its own config first). */
  const bindingBase = (binding: string, S: string | undefined): Base | null => {
    const mine = S ? svcById.get(S)?.name : undefined;
    const b = config.bindings.find((x) => x.binding === binding && (!mine || !x.scope || normalisedName(x.scope) === normalisedName(mine))) ?? config.bindings.find((x) => x.binding === binding);
    if (!b) return null;
    const ev: Evidence = { file: b.file, line: b.line, text: lineText(b.file, b.line), role: "config" };
    const to = allServices.find((s) => s.kind === "app" && normalisedName(s.name) === normalisedName(b.service));
    return { outcome: to ? { kind: "service", hit: { service: to, confidence: "certain", evidence: [] } } : { kind: "bare", host: b.service }, basePath: [], evidence: [ev], notes: [] };
  };

  // HTTP calls → routes: a known host, then the host/env setting/base constant, then the
  // caller's own routes, its rewrites, the only service with routes, and last the search by path.
  let unmatched = 0;
  const unmatchedSamples: string[] = [];
  const unseen = new Set<string>();
  let toldMisses = 0;
  const toldMissSamples: string[] = [];
  /** The services each request's arrows land in, by `file:line`, to tell where a base setting points. */
  const hitsOf = new Map<string, Set<string>>();
  // Doors a request knocks on that the service it goes to doesn't have: by service, method and path.
  const missing = new Map<string, MissingRoute>();
  const addMissing = (service: string, method: string | undefined, segs: string[], code: Evidence, confidence: Confidence, note?: string) => {
    const m = method && method !== "ANY" ? method : undefined;
    const path = `/${segs.join("/")}`;
    const key = `${service}|${m ?? ""}|${path}`;
    const r: MissingRoute = missing.get(key) ?? { service, ...(m ? { method: m } : {}), path, calls: [], confidence, ...(note ? { note } : {}) };
    if (!r.calls.some((c) => c.file === code.file && c.line === code.line)) r.calls.push({ file: code.file, line: code.line, text: code.text });
    if (confidence === "certain" && r.confidence === "likely") {
      r.confidence = "certain";
      delete r.note;
    }
    missing.set(key, r);
  };
  // Files an app serves as they are (Next.js and Vite `public/`, SvelteKit `static/`): the readers list
  // their paths. A request for one is not an API call: no route, no warning, no stand-in.
  const assetPaths = sources.filter((s) => /(^|\/)(public|static)\/[^/]/.test(s.path)).map((s) => s.path);
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const staticFile = (p: string, h: HttpCallFact): boolean => {
    if (!assetPaths.length || h.fromVariable || h.binding || !h.url.startsWith("/") || (h.method && h.method !== "GET")) return false;
    const path = h.url.split(/[?#]/)[0].replace(/^\/+/, "");
    if (!/\.[A-Za-z0-9]+$/.test(path)) return false; // a file name, not a directory or an endpoint
    const area = areaOf(p);
    const dir = area && manifestDirs.has(area) ? `${area}/` : "";
    const re = new RegExp(`^${escapeRe(dir)}(public|static)/${path.split("*").map(escapeRe).join("[^/]*")}$`);
    return assetPaths.some((a) => re.test(a));
  };

  /** The base of a URL that starts with a setting or a module constant (`${process.env.X}/y`, `${BASE}/y`):
   * the setting's value from config or a code default, what the user told WalkMyCode, the setting's name, else the constant's literal. */
  const varBase = (p: string, h: HttpCallFact, S: string | undefined, told?: Told): Base | null => {
    let base = h.varName ? resolveEnv(h.varName, S, told) : null;
    if (!base && h.literalBase) {
      const c = Object.values(facts[p].consts).find((x) => x.literal === h.literalBase);
      base = baseFromValue(h.literalBase, c ? [{ file: p, line: c.line, text: lineText(p, c.line) }] : [], S);
      if (base?.outcome.kind === "unknown") base = null;
    }
    return base;
  };

  // ── "Whose address is this?" (§13): requests to a public address ──
  // A request whose address is a public host (not a company WalkMyCode knows, not this machine, not a name
  // config gives a service) may still go to one of the workspace's apps, deployed: a web app calling
  // https://api.example.com, the backend in the next folder. Each such host is listed with where it is set,
  // who calls it, and how many of its requests each app's routes answer. WalkMyCode never guesses solid: the
  // host is resolved only when the service's own deploy config gives it the address, or the user says whose it is.
  interface Address {
    /** hostKey: "api.example.com" */
    host: string;
    /** "https://api.example.com", for the question. */
    origin: string;
    /** Where the address is set: the config line or code default its value comes from, else the request's own line. */
    at: Evidence;
    /** The path asked of the host: its base path, then the request's own. */
    segs: string[];
    /** The URL is visibly built on the address (in the URL, a constant, or a helper that only puts it in front):
     * a path no route answers is a door the service doesn't have. Else (through a function) it is drawn as before. */
    visible: boolean;
    /** A rewrite the request goes through to reach the address. */
    rule?: GatewayRule;
  }
  /** Whose a public address is: the user's answer naming an app, else the service's own deploy config. */
  interface Owned extends Address {
    service: ServiceDef;
    by: "user" | "config";
    /** The deploy line that gives the service the address, when there is one. */
    config?: Evidence;
  }
  const schemeIn = (host: string, ...texts: (string | undefined)[]): string => {
    for (const t of texts) {
      const m = t ? new RegExp(`\\b(https?|wss?)://${escapeRe(host)}`, "i").exec(t) : null;
      if (m) return `${m[1].toLowerCase()}://${host}`;
    }
    return host;
  };
  /** The public address a request goes to, read as drawCall reads its base; null for any other request. */
  const addressOf = (p: string, h: HttpCallFact, S: string | undefined, ref: BaseRef | undefined): Address | null => {
    if (h.binding) return null;
    const code: Evidence = { file: p, line: h.line, text: lineText(p, h.line) };
    const { host, segs } = callSegments(h.url);
    const rest = segs[0] === "*" ? segs.slice(1) : segs;
    const of = (b: Base | null, path: string[], visible: boolean): Address | null => {
      if (!b?.host || b.heuristic || !isPublicHost(b.host)) return null;
      const k = hostKey(b.host);
      return { host: k, origin: schemeIn(k, b.value), at: b.evidence[0] ?? code, segs: [...b.basePath, ...path], visible };
    };
    if (host) return isPublicHost(host) ? { host: hostKey(host), origin: schemeIn(hostKey(host), h.url), at: code, segs, visible: true } : null;
    if (h.fromVariable && (h.varName || h.literalBase)) return of(varBase(p, h, S), rest, true);
    if (ref) {
      // Through a function, an imported constant or a helper: the setting's value, else the default in the code.
      const v = ref.name ? envLookup(ref.name, S) : undefined;
      const value = v?.value ?? ref.literal;
      if (value === undefined) return null;
      const b = baseFromValue(value, [v?.evidence ?? { file: ref.at.file, line: ref.at.line, text: lineText(ref.at.file, ref.at.line) }], S);
      // A helper puts the address in front of the path it is given: a leading `*` there is part of the path.
      return of(b, ref.via === "helper" ? segs : rest, ref.via === "const" || !!ref.exact);
    }
    if (h.fromVariable) return null;
    // A path with no host: the caller's own routes first, then a rewrite that sends it to a public address.
    const own = S ? (routesByService.get(S) ?? []) : [];
    if (own.length && bestHits(segs, own, h.method, false).length) return null;
    const g = throughGateway(rulesFor(S), segs, S);
    if (!g?.rule.toHost || !isPublicHost(g.rule.toHost)) return null;
    const k = hostKey(g.rule.toHost);
    return { host: k, origin: schemeIn(k, g.rule.evidence.text), at: g.rule.evidence, segs: g.segs, visible: true, rule: g.rule };
  };
  /** Who says whose a public address is: the user's answer (an app), else what deploy config says. Undefined
   * when nobody says, or when the user said another company's / not sure. */
  const ownerOfHost = (host: string): Pick<Owned, "service" | "by" | "config"> | undefined => {
    const said = hostAnswers.get(host);
    const cfg = hostTable.get(host);
    const config = cfg?.address?.by === "config" ? cfg : undefined;
    if (said?.service === null) return undefined;
    const app = said ? answeredApp(said.service) : undefined;
    if (app) return { service: app, by: "user", ...(config?.service === app ? { config: config.evidence[0] } : {}) };
    return config ? { service: config.service, by: "config", config: config.evidence[0] } : undefined;
  };
  interface AddressUse {
    origin: string;
    setAt: Evidence[];
    services: Set<string>;
    calls: Set<string>;
    /** Requests with something literal in their path, and per app the ones its routes answer. */
    matchable: Set<string>;
    matches: Map<string, Set<string>>;
  }
  const addressUses = new Map<string, AddressUse>();
  const appRoutes = [...routesByService].filter(([id]) => svcById.get(id)?.kind === "app");
  const noteAddress = (a: Address, p: string, h: HttpCallFact, S: string | undefined) => {
    const u = addressUses.get(a.host) ?? { origin: a.origin, setAt: [], services: new Set<string>(), calls: new Set<string>(), matchable: new Set<string>(), matches: new Map<string, Set<string>>() };
    addressUses.set(a.host, u);
    if (!u.origin.includes("://") && a.origin.includes("://")) u.origin = a.origin;
    if (u.setAt.length < 20 && !u.setAt.some((x) => x.file === a.at.file && x.line === a.at.line)) u.setAt.push({ file: a.at.file, line: a.at.line, text: a.at.text, ...(a.at.role ? { role: a.at.role } : {}) });
    if (S) u.services.add(S);
    const key = `${p}:${h.line}`;
    u.calls.add(key);
    if (!a.segs.some((s) => s !== "*")) return;
    u.matchable.add(key);
    for (const [id, routes] of appRoutes) if (bestHits(a.segs, routes, h.method, false).length) u.matches.set(id, (u.matches.get(id) ?? new Set<string>()).add(key));
  };

  /** One request's arrows. Told where a setting points that WalkMyCode reached through a function
   * (`${getApiBaseUrl()}/x`, `fetchApi("/x")`), a request that finds no door in that service draws
   * nothing and returns "missed"; it is then drawn as if never answered. A request no route answers
   * at all returns "unmatched" (the caller may draw it to a stand-in, or count it). `owned`: a public
   * address the user, or the service's own deploy config, says is one of this system's apps. */
  const drawCall = (p: string, h: HttpCallFact, from: string, S: string | undefined, told?: Told, owned?: Owned): "drawn" | "missed" | "unmatched" => {
    const fn = fnAt(p, h.line);
    const code: Evidence = { file: p, line: h.line, text: lineText(p, h.line), trigger: triggerFor(p, h.line) };
    const { host } = callSegments(h.url);
    let { segs } = callSegments(h.url);
    const ev: Evidence[] = [code];
    const notes: string[] = [];
    let target: ServiceDef | undefined;
    let conf: Confidence = "certain";
    let leadingVar = h.fromVariable || !!host;
    let onlyApp = false;
    let mode: "target" | "path" | "global" | "outside-search" = h.fromVariable ? "global" : "path";
    let outsideHost: string | undefined;

    // 1-2. a literal host, or a base URL from an env setting or a module constant
    let base: Base | null = null;
    const bound = h.binding ? bindingBase(h.binding, S) : null;
    if (owned) {
      // A public address whose owner is known resolves as a name compose gives the service would. The chain is
      // cited: the request, where its address is set, the deploy line that gives the service the address, or the answer.
      const said: Evidence[] = owned.by === "user" ? [{ file: owned.at.file, line: owned.at.line, text: `you told WalkMyCode: ${owned.host} is ${owned.service.name}`, role: "user", host: owned.host }] : [];
      base = { outcome: { kind: "service", hit: { service: owned.service, confidence: "certain", evidence: [] } }, basePath: [], evidence: [owned.at, ...(owned.config ? [owned.config] : []), ...said], notes: owned.rule ? [gatewayNote(owned.rule)] : [] };
      segs = owned.segs;
    } else if (bound) {
      base = bound;
      leadingVar = false;
    } else if (host) base = { outcome: resolveHost(host, S), basePath: [], evidence: [], notes: [] };
    else if (h.fromVariable && (h.varName || h.literalBase)) {
      base = varBase(p, h, S, told);
      if (base && !base.heuristic) {
        // The leading "*" stood for the base URL, which is now known.
        if (segs[0] === "*") segs = segs.slice(1);
        segs = [...base.basePath, ...segs];
        leadingVar = false;
      }
    } else if (told) {
      // 2b. the setting is read in a function the URL starts with, an imported constant, or the
      // helper the request goes through: the user's answer says where it points.
      base = toldBase(told);
      if (told.unset.via === "helper") base.keepLeading = true;
      else if (segs[0] === "*") segs = segs.slice(1);
    }

    if (base) {
      const o = base.outcome;
      ev.push(...base.evidence);
      notes.push(...base.notes);
      if (o.kind === "known") {
        addNode({ id: svcId(o.name), layer: "external", kind: "service", name: o.name, area: "" });
        addEdge(from, svcId(o.name), "uses-service", "certain", ev, undefined, fn);
        return "drawn";
      }
      if (o.kind === "bare") {
        const s = placeholderFor(o.host, [code, ...base.evidence]);
        addEdge(from, internalNode(s), "uses-service", "certain", ev, undefined, fn);
        const w = `I can't see the code of ${o.host} (called from ${p}:${h.line}); add its folder to the workspace`;
        if (!unseen.has(w)) {
          unseen.add(w);
          warnings.push(w);
        }
        return "drawn";
      }
      if (o.kind === "outside") {
        // As in v1: a request to a named host may still be to one of the repo's own routes.
        mode = "outside-search";
        outsideHost = o.host;
        leadingVar = true;
      } else if (o.kind === "local" || o.kind === "unknown") {
        mode = "path";
        leadingVar = true;
      } else if (o.kind === "path") {
        mode = "path";
      } else if (o.kind === "service") {
        target = o.hit.service;
        conf = worse(conf, o.hit.confidence);
        // A public address deploy config gives the service is cited even after the line that sets the base.
        if (!base.evidence.length || o.hit.address) ev.push(...o.hit.evidence);
        if (o.hit.note) notes.push(o.hit.note);
        onlyApp = !!o.hit.onlyApp;
        if (!base.heuristic && !base.keepLeading) leadingVar = false;
        mode = "target";
      }
    }

    // 3. a path with no host: the caller's own routes, its rewrites, the only service with routes
    if (mode === "path") {
      const own = S ? (routesByService.get(S) ?? []) : [];
      if (own.length && bestHits(segs, own, h.method, leadingVar).length) {
        target = svcById.get(S!);
        mode = "target";
      } else {
        const g = throughGateway(rulesFor(S), segs, S);
        if (g) {
          ev.push(g.rule.evidence);
          notes.push(gatewayNote(g.rule));
          conf = worse(conf, g.rule.confidence);
          segs = g.segs;
          leadingVar = false;
          const o = g.outcome;
          if (o.kind === "known" || o.kind === "outside") {
            const name = o.kind === "known" ? o.name : o.host;
            addNode({ id: svcId(name), layer: "external", kind: "service", name, area: "" });
            addEdge(from, svcId(name), "uses-service", conf, ev, conf === "likely" ? sentence(notes) : undefined, fn);
            return "drawn";
          }
          if (o.kind === "bare") {
            const s = placeholderFor(o.host, [code, g.rule.evidence]);
            addEdge(from, internalNode(s), "uses-service", conf, ev, conf === "likely" ? sentence(notes) : undefined, fn);
            return "drawn";
          }
          if (o.kind === "service") {
            target = o.hit.service;
            conf = worse(conf, o.hit.confidence);
            if (o.hit.note) notes.push(o.hit.note);
            mode = "target";
          }
        } else if (isServices && !own.length && appsWithRoutes.length === 1 && appsWithRoutes[0] !== S) {
          target = svcById.get(appsWithRoutes[0]);
          conf = "likely";
          notes.push(`only the ${target!.name} service has routes that could answer this`);
          mode = "target";
        } else mode = "global";
      }
    }

    // A service reached with no routes of its own: a gateway passes the request on; anything else is a box.
    if (mode === "target" && target?.kind === "gateway") {
      const g = throughGateway(
        rules.filter((r) => r.ownerService === target!.id),
        segs,
        undefined,
      );
      if (g?.outcome.kind === "service") {
        ev.push(g.rule.evidence);
        notes.push(gatewayNote(g.rule));
        segs = g.segs;
        target = g.outcome.hit.service;
        conf = worse(conf, worse(g.rule.confidence, g.outcome.hit.confidence));
      }
    }
    if (mode === "target" && target && target.kind !== "app") {
      addEdge(from, internalNode(target), "uses-service", conf, ev, conf === "likely" ? sentence(notes) : undefined, fn);
      return "drawn";
    }

    // Where the URL is visibly built on the setting, the answer is as good as config: a miss is said
    // and draws nothing. Where WalkMyCode only followed a function to the setting, a miss draws as before.
    const inferred = told?.unset.via === "call" || told?.unset.via === "helper" || (!!owned && !owned.visible);
    if (inferred && segs.every((s) => s === "*")) return "drawn"; // `${apiBase()}${path}`: nothing literal, answered or not
    if (owned && target && segs.every((s) => s === "*")) {
      // `fetch(`${API_URL}${path}`)` on an address whose owner is known: nothing literal to match, so the arrow goes to the service as a whole.
      addEdge(from, internalNode(target), "uses-service", "certain", ev, undefined, fn);
      return "drawn";
    }

    // 4. candidates: the target's routes, else every route (the last resort)
    const usedGlobal = !(mode === "target" && target);
    let hits = bestHits(segs, usedGlobal ? routeNodes : (routesByService.get(target!.id) ?? []), h.method, leadingVar);
    if (!hits.length && onlyApp) {
      // localhost taken to be the only app: on a miss, do exactly what v1 did.
      leadingVar = true;
      hits = bestHits(segs, routeNodes, h.method, true);
    }

    // 6. nothing answers
    if (!hits.length) {
      if (inferred) return "missed";
      if (!usedGlobal && target && !onlyApp) {
        const method = h.method && h.method !== "ANY" ? `${h.method} ` : "";
        warnings.push(`the ${target.name} service has no ${method}/${segs.join("/")} that I can see (called from ${p}:${h.line})`);
        addMissing(target.id, h.method, segs, code, conf, notes.length ? sentence(notes) : undefined);
      } else if (outsideHost) {
        // A real request to a host we don't know: still an outside service.
        addNode({ id: svcId(outsideHost), layer: "external", kind: "service", name: outsideHost, area: "" });
        addEdge(from, svcId(outsideHost), "uses-service", "certain", ev, undefined, fn);
      } else return "unmatched";
      return "drawn";
    }
    if (segs.every((s) => s === "*")) return "drawn"; // nothing literal to match on, answered or not

    // 5, 7. how sure: certain only for one path in one service, reached with nothing guessed
    const distinctPaths = new Set(hits.map((r) => `${r.method} ${r.path}`));
    const areasHit = new Set(hits.map((r) => r.area));
    const servicesHit = new Set(hits.map((r) => r.service ?? r.area));
    const acrossServices = isServices && (usedGlobal || outsideHost !== undefined);
    const ambiguous = distinctPaths.size > 1 || areasHit.size > 1;
    let confidence: Confidence = conf;
    let note: string | undefined;
    if (!isServices && !notes.length) {
      // One app: exactly v1's rule and wording.
      if (leadingVar) {
        confidence = "likely";
        note = VAR_NOTE;
      }
      if (ambiguous) {
        confidence = "likely";
        note = !h.method ? METHOD_NOTE : MORE_NOTE;
      }
    } else {
      const parts = [...notes];
      if (leadingVar) parts.push(VAR_NOTE);
      // "More than one service has this path" already says what "more than one route" would.
      if (ambiguous && (!h.method || !(acrossServices && servicesHit.size > 1 && distinctPaths.size === 1))) parts.push(!h.method ? METHOD_NOTE : MORE_NOTE);
      if (acrossServices) parts.push(servicesHit.size > 1 ? "more than one service has this path; a base-URL setting or a rewrite would let me tell them apart" : "matched by the path only, across services");
      if (leadingVar || ambiguous || acrossServices) confidence = "likely";
      note = sentence(parts);
    }
    for (const rn of hits) addEdge(from, rn.id, "calls-route", confidence, ev, note, fn, rn.handler);
    const landed = hitsOf.get(`${p}:${h.line}`) ?? new Set<string>();
    for (const rn of hits) landed.add(rn.service ?? "");
    hitsOf.set(`${p}:${h.line}`, landed);
    return "drawn";
  };
  /** A request no route here answers, built on a setting or a default: one dashed arrow to where that
   * base points. A setting with no value goes to its stand-in, a backend whose code isn't here; a value
   * from config or code goes where it says, when that is outside or a host whose code isn't here. */
  const standIn = (p: string, h: HttpCallFact, from: string, S: string | undefined, base: BaseRef, unset: boolean): boolean => {
    const code: Evidence = { file: p, line: h.line, text: lineText(p, h.line), trigger: triggerFor(p, h.line) };
    const ev: Evidence[] = [code];
    if (base.at.file !== p || base.at.line !== h.line) ev.push({ file: base.at.file, line: base.at.line, text: lineText(base.at.file, base.at.line) });
    const named = base.name ?? "its address";
    const how = base.via === "helper" ? [`it goes through ${h.callee}, which puts ${named} in front`] : base.via === "call" ? [`its address comes from ${h.baseCall}(), which reads ${named}`] : [];
    const fn = fnAt(p, h.line);
    if (unset) {
      const s = settingPlaceholder(base.name!, base.at);
      const why = `nothing in the repo gives ${base.name} a value and no route here answers it, so it goes to a backend whose code isn't here: add that backend's folder to the workspace, or say where ${base.name} points`;
      addEdge(from, internalNode(s), "uses-service", "likely", ev, sentence([...how, why]), fn);
      return true;
    }
    const v = base.name ? envLookup(base.name, S) : undefined;
    const value = v?.value ?? base.literal;
    const b = value === undefined ? null : baseFromValue(value, v ? [v.evidence] : [], S);
    if (!b) return false;
    const o = b.outcome;
    const where = `${base.name ? `the address in ${base.name}` : "its address"} is ${value}${v ? ` (${v.evidence.file}:${v.evidence.line})` : " (the default in the code)"}`;
    const note = sentence([...how, where]);
    if (o.kind === "known" || o.kind === "outside") {
      const name = o.kind === "known" ? o.name : o.host;
      addNode({ id: svcId(name), layer: "external", kind: "service", name, area: "" });
      addEdge(from, svcId(name), "uses-service", "likely", [...ev, ...b.evidence], note, fn);
      return true;
    }
    if (o.kind === "bare") {
      const s = placeholderFor(o.host, [code, ...b.evidence]);
      addEdge(from, internalNode(s), "uses-service", "likely", [...ev, ...b.evidence], note, fn);
      return true;
    }
    return false;
  };
  const countUnmatched = (p: string, h: HttpCallFact) => {
    unmatched++;
    if (unmatchedSamples.length < 25) unmatchedSamples.push(`${p}:${h.line} ${h.method ?? "?"} ${h.url}`);
  };
  /** Where a request's base comes from, as one key: the setting, else the default in the code. */
  const baseKey = (b: BaseRef) => b.name ?? `=${b.literal}`;
  const baseCalls = new Map<string, string[]>(); // base → `file:line` of every request built on it
  // Requests no route here answers, whose base is known: settled once every request has been drawn.
  const pending: { p: string; h: HttpCallFact; from: string; S: string | undefined; base: BaseRef; unset: boolean; told?: ServiceDef }[] = [];
  let assets = 0;
  for (const p of parsed) {
    for (const h of facts[p].http) {
      const from = containerAt(p, h.line);
      if (!from) continue;
      const S = serviceOfFile(p);
      const base = baseSettingOf(p, h);
      if (base) baseCalls.set(baseKey(base), [...(baseCalls.get(baseKey(base)) ?? []), `${p}:${h.line}`]);
      // A public address: listed for "Whose address is this?", and drawn to the app it is when the service's own
      // deploy config, or the user, says. Reached through a function that may change the path, a request no
      // route answers is then drawn as if nobody had said.
      const addr = addressOf(p, h, S, base);
      if (addr) {
        noteAddress(addr, p, h, S);
        const owner = ownerOfHost(addr.host);
        if (owner && drawCall(p, h, from, S, undefined, { ...addr, ...owner }) === "drawn") continue;
      }
      // A base setting with no value anywhere: listed for "Where does this point?", and drawn with the answer if there is one.
      const unset = base?.name !== undefined && base.literal === undefined && !k8sService(base.name) && !envLookup(base.name, S) ? (base as Told["unset"]) : undefined;
      let told: ServiceDef | undefined;
      if (unset) {
        const u = unsetBases.get(unset.name) ?? { services: new Set<string>(), calls: new Set<string>() };
        if (S) u.services.add(S);
        u.calls.add(`${p}:${h.line}`);
        unsetBases.set(unset.name, u);
        const service = answeredService(unset.name, unset.at);
        if (service) {
          if (service.kind === "app") told = service;
          if (drawCall(p, h, from, S, { unset, service }) === "drawn") continue;
          toldMisses++;
          if (toldMissSamples.length < 8) toldMissSamples.push(`${p}:${h.line} ${h.method ?? "?"} ${h.url} (${unset.name} → ${service.name})`);
        }
      }
      if (drawCall(p, h, from, S) !== "unmatched") continue;
      // A file the app serves itself (public/locales/ak.json): not an API call at all.
      if (staticFile(p, h)) {
        assets++;
        continue;
      }
      if (base) pending.push({ p, h, from, S, base, unset: !!unset, ...(told ? { told } : {}) });
      else countUnmatched(p, h);
    }
  }
  // A request no route here answers, built on a base: when the user named a service for it, or every
  // other request on the same base lands in one service, it asks that service for a door it doesn't
  // have ("Called but not found"). Otherwise one dashed arrow goes to where the base points.
  const landsIn = (key: string): ServiceDef | undefined => {
    const where = new Set<string>();
    for (const c of baseCalls.get(key) ?? []) for (const s of hitsOf.get(c) ?? []) where.add(s);
    const only = where.size === 1 ? svcById.get([...where][0]) : undefined;
    return only?.kind === "app" ? only : undefined;
  };
  let inferredMissing = 0;
  for (const c of pending) {
    const { segs } = callSegments(c.h.url);
    const asked = c.base.via === "helper" || segs[0] !== "*" ? segs : segs.slice(1);
    const named = c.base.name ?? "its address";
    const code: Evidence = { file: c.p, line: c.h.line, text: lineText(c.p, c.h.line) };
    const to = c.told ?? landsIn(baseKey(c.base));
    if (to && asked.some((s) => s !== "*")) {
      const why = c.told ? `you told WalkMyCode ${named} points at the ${to.name} service` : `the other requests built on ${named} land in the ${to.name} service`;
      addMissing(to.id, c.h.method, asked, code, "likely", `${why[0].toUpperCase()}${why.slice(1)}.`);
      inferredMissing++;
      continue;
    }
    if (!c.told && standIn(c.p, c.h, c.from, c.S, c.base, c.unset)) continue;
    countUnmatched(c.p, c.h);
  }
  if (unmatched) warnings.push(`${unmatched} HTTP calls matched no route (first few: ${unmatchedSamples.slice(0, 8).join("; ")})`);
  if (inferredMissing) {
    const lines = [...missing.values()].filter((m) => m.confidence === "likely").flatMap((m) => m.calls.map((c) => `${m.method ?? "?"} ${m.path} (${c.file}:${c.line})`));
    const where = [...new Set([...missing.values()].filter((m) => m.confidence === "likely").map((m) => svcById.get(m.service)?.name ?? m.service))];
    warnings.push(`${inferredMissing} ${inferredMissing === 1 ? "request asks" : "requests ask"} the ${where.join(" and ")} service${where.length > 1 ? "s" : ""} for doors I can't find there (first few: ${lines.slice(0, 8).join("; ")})`);
  }
  if (toldMisses) {
    const one = toldMisses === 1;
    warnings.push(`${toldMisses} ${one ? "request that reaches" : "requests that reach"} a setting you told WalkMyCode about through a function found no route in the service you named, so ${one ? "it is" : "they are"} drawn as before (first few: ${toldMissSamples.join("; ")})`);
  }

  // tables
  for (const p of parsed) {
    for (const q of facts[p].sql) {
      const from = containerAt(p, q.line);
      if (!from) continue;
      const kind: EdgeKind = q.op === "define" ? "defines" : q.op === "read" ? "reads" : "writes";
      for (const d of dbsOfFact(p, q.op)) {
        const id = tableId(q.table, dbFor(q.table, d));
        const defined = definedTables.has(id);
        addEdge(from, id, kind, defined || kind === "defines" ? "certain" : "likely", { file: p, line: q.line, text: lineText(p, q.line) }, defined || kind === "defines" ? undefined : `I found no CREATE TABLE for "${q.table}", so it may be created elsewhere (or not be a table).`, fnAt(p, q.line));
      }
    }
  }
  // services
  for (const p of parsed) {
    const strong = new Set(facts[p].services.filter((s) => s.via !== "env").map((s) => s.service));
    for (const s of facts[p].services) {
      const from = containerAt(p, s.line);
      if (!from) continue;
      addNode({ id: svcId(s.service), layer: "external", kind: "service", name: s.service, area: "" });
      const isEnvOnly = s.via === "env" && !strong.has(s.service);
      addEdge(from, svcId(s.service), "uses-service", isEnvOnly ? "likely" : "certain", { file: p, line: s.line, text: lineText(p, s.line) }, isEnvOnly ? `Only the ${s.text} setting is read here; I didn't see a request to ${s.service}.` : undefined, fnAt(p, s.line));
    }
  }

  // ── queues and topics (§3 Channels, §5): one node per channel name, owned by the broker config names ──
  const BROKER_IMAGE: Partial<Record<ChannelFact["tech"], RegExp>> = { kafka: /kafka|redpanda/, rabbitmq: /rabbitmq/, nats: /nats/, redis: /redis|keydb|valkey|dragonfly/, bullmq: /redis|keydb|valkey|dragonfly/, celery: /rabbitmq|redis/ };
  const brokerOf = (tech: ChannelFact["tech"]) => {
    const re = BROKER_IMAGE[tech];
    return re ? allServices.find((s) => (s.kind === "broker" || s.kind === "cache") && re.test(`${s.image ?? ""} ${s.name}`.toLowerCase())) : undefined;
  };
  const chanNode = (tech: ChannelFact["tech"], name: string): string => {
    const id = `chan:${tech}/${name}`;
    if (!nodeIds.has(id)) {
      const n: MapNode = { id, layer: "external", kind: "channel", name, area: "", tech: TECH_LABEL[tech] };
      const b = brokerOf(tech);
      if (b) n.service = b.id;
      addNode(n);
    }
    return id;
  };
  // Celery: task name → the queue its worker listens on.
  const celeryTasks = new Map<string, string>();
  for (const p of parsed) for (const c of facts[p].channels) if (c.tech === "celery" && c.op === "consume" && c.task) celeryTasks.set(c.task, c.channel);
  for (const p of parsed) {
    const S = serviceOfFile(p);
    for (const c of facts[p].channels) {
      const from = containerAt(p, c.line);
      if (!from) continue;
      const ev: Evidence[] = [{ file: p, line: c.line, text: lineText(p, c.line) }];
      const notes: string[] = [];
      let name = c.channel;
      let sure = c.literal && !c.varName;
      if (c.tech === "celery" && c.op === "publish" && c.task) {
        const queue = celeryTasks.get(c.task) ?? celeryTasks.get(c.task.split(".").pop()!);
        if (queue === undefined && !c.sendTask) continue; // .delay() on something that is not a task I can see
        if (queue === undefined) {
          sure = false;
          notes.push(`I found no task named ${c.task}, so I can't tell which code picks this up`);
        } else if (name === "celery") name = queue; // no queue given: the task's own
      }
      if (c.varName) {
        const hit = envLookup(c.varName, S);
        if (hit) {
          const v = hit.value.trim();
          name = c.tech === "sqs" ? v.replace(/\/+$/, "").split("/").pop()! : c.tech === "sns" ? v.split(":").pop()! : v;
          ev.push(hit.evidence);
          notes.push(`the name comes from the setting ${c.varName} (${hit.evidence.file}:${hit.evidence.line})`);
        } else notes.push(`the name is read from the setting ${c.varName} at run time, and I found no value for it`);
      } else if (!sure && !notes.length) notes.push(/[*>#?]/.test(name) ? "it listens to a pattern of names, so which ones it gets is decided at run time" : "the name is built at run time");
      addEdge(from, chanNode(c.tech, name), c.op === "publish" ? "publishes" : "consumes", sure ? "certain" : "likely", ev, sure ? undefined : sentence(notes), fnAt(p, c.line));
    }
  }
  // AsyncAPI: a channel the team described. It becomes a card only when no code names it.
  const PROTOCOL: Record<string, ChannelFact["tech"]> = { kafka: "kafka", "kafka-secure": "kafka", amqp: "rabbitmq", amqps: "rabbitmq", nats: "nats", redis: "redis", sqs: "sqs", sns: "sns" };
  // With no `servers.protocol`, the one kind of broker the config runs (a kafka container, say) decides.
  const brokerTechs = (["kafka", "rabbitmq", "nats"] as const).filter((t) => allServices.some((s) => s.kind === "broker" && BROKER_IMAGE[t]!.test(`${s.image ?? ""} ${s.name}`.toLowerCase())));
  for (const c of config.channels) {
    const tech = c.tech ? PROTOCOL[c.tech] : brokerTechs.length === 1 ? brokerTechs[0] : undefined;
    if (nodes.some((n) => n.kind === "channel" && n.name === c.name && (!tech || n.id.startsWith(`chan:${tech}/`)))) continue;
    if (!tech) {
      warnings.push(`${c.file}:${c.line} describes ${c.name}, but names no protocol I know, so I can't tell which kind of queue it is`);
      continue;
    }
    const id = chanNode(tech, c.name);
    const n = nodes.find((x) => x.id === id)!;
    n.note = `described in ${basename(c.file)}:${c.line}; I did not find the code`;
  }

  // ── gRPC (§5 Other link kinds): one node per gRPC service, owned by the service that implements it ──
  const implementers = new Map<string, { file: string; line: number }[]>();
  const rpcCalls: { p: string; service: string; host?: string; line: number }[] = [];
  for (const p of parsed) {
    for (const r of facts[p].rpc) {
      if (r.role === "implements") implementers.set(r.service, [...(implementers.get(r.service) ?? []), { file: p, line: r.line }]);
      else rpcCalls.push({ p, service: r.service, host: r.host, line: r.line });
    }
  }
  const protoDefs = new Map<string, typeof config.rpcServices>();
  for (const d of config.rpcServices) protoDefs.set(d.name, [...(protoDefs.get(d.name) ?? []), d]);
  const rpcNodeOf = new Map<string, MapNode>();
  for (const name of [...new Set([...protoDefs.keys(), ...implementers.keys()])].sort()) {
    const impl = implementers.get(name) ?? [];
    const implSvc = impl.map((i) => serviceOfFile(i.file)).find(Boolean);
    const defs = [...(protoDefs.get(name) ?? [])].sort((a, b) => a.file.localeCompare(b.file));
    // The implementer's own copy of the .proto names the node; with no .proto at all, the implementing file does.
    const def = defs.find((d) => implSvc && serviceOfFile(d.file) === implSvc) ?? defs[0];
    const file = def?.file ?? impl[0].file;
    const line = def?.line ?? impl[0].line;
    let service = implSvc;
    let note: string;
    if (impl.length) note = `implemented in ${impl.map((i) => `${i.file}:${i.line}`).join(", ")}`;
    else {
      // A vendored .proto with no implementer: one of this system's services whose code is not here.
      const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      const named = allServices.find((s) => (s.kind === "app" || s.kind === "placeholder") && normalisedName(s.name) === normalisedName(kebab));
      service = named?.id ?? placeholderFor(normalisedName(kebab), [{ file, line, text: lineText(file, line), role: "config" }]).id;
      note = `described in ${basename(file)}; I did not find the code that implements it`;
    }
    const n: MapNode = { id: `rpc:${file}#${name}`, layer: "api", kind: "rpc", name, area: (service && svcById.get(service)?.areas[0]) ?? areaOf(file), file, line, tech: "gRPC service", note };
    if (service) n.service = service;
    addNode(n);
    rpcNodeOf.set(name, n);
  }
  for (const c of rpcCalls) {
    const from = containerAt(c.p, c.line);
    const node = rpcNodeOf.get(c.service);
    if (!from) continue;
    if (!node) {
      warnings.push(`${c.p}:${c.line} calls the gRPC service ${c.service}, but I found neither its .proto nor the code that implements it`);
      continue;
    }
    const ev: Evidence[] = [{ file: c.p, line: c.line, text: lineText(c.p, c.line) }];
    const notes: string[] = [];
    const implCount = implementers.get(c.service)?.length ?? 0;
    let conf: Confidence = "likely";
    if (c.host) {
      const o = resolveHost(c.host, serviceOfFile(c.p));
      if (o.kind === "service") {
        ev.push(...o.hit.evidence);
        if (o.hit.service.id === node.service) conf = o.hit.confidence;
        else notes.push(`${c.host} is the ${o.hit.service.name} service, but ${c.service} is implemented in ${svcById.get(node.service ?? "")?.name ?? "another"} service`);
        if (o.hit.note) notes.push(o.hit.note);
      }
    }
    if (conf === "likely" && !notes.length && implCount === 1) conf = "certain";
    if (conf === "likely" && !notes.length) notes.push(implCount > 1 ? `${implCount} places implement ${c.service}; its address would tell me which one this is` : `I can't see the code that implements ${c.service}`);
    addEdge(from, node.id, "calls-rpc", conf, ev, conf === "likely" ? sentence(notes) : undefined, fnAt(c.p, c.line));
  }

  const edgeList = [...edges.values()];

  // ── who uses each table (the "shared by" badge), and which service it belongs to ──
  if (isServices) {
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const users = new Map<string, string[]>();
    const definer = new Map<string, MapNode>();
    for (const e of edgeList) {
      if (e.kind !== "reads" && e.kind !== "writes" && e.kind !== "defines") continue;
      const fromNode = nodeById.get(e.from);
      const s = fromNode?.service;
      if (!s) continue;
      const u = users.get(e.to) ?? [];
      if (!u.includes(s)) users.set(e.to, [...u, s]);
      if (e.kind === "defines" && !definer.has(e.to)) definer.set(e.to, fromNode);
    }
    const byName = new Map<string, MapNode[]>();
    for (const n of nodes) if (n.kind === "table") byName.set(n.name.toLowerCase(), [...(byName.get(n.name.toLowerCase()) ?? []), n]);
    for (const n of nodes) {
      if (n.kind !== "table") continue;
      const u = users.get(n.id) ?? [];
      if (u.length) n.usedBy = u;
      // The service whose schema creates it owns it (and it sits in that folder); else its first user.
      const def = definer.get(n.id);
      if (def?.service) {
        n.service = def.service;
        n.area = def.area;
      } else if (u[0]) n.service = u[0];
      // Same name, different databases: two nodes, never an arrow between them.
      const twins = (byName.get(n.name.toLowerCase()) ?? []).filter((x) => x !== n);
      if (twins.length) {
        const who = [...new Set(twins.flatMap((x) => users.get(x.id) ?? []))].map((id) => svcById.get(id)?.name ?? id);
        const subject = who.length ? `The ${who.join(" and ")} service${who.length > 1 ? "s" : ""}` : "Another service";
        n.note = `${subject} also ha${who.length > 1 ? "ve" : "s"} a ${n.name} table; I can't tell if it's the same database.`;
      }
    }
  }

  // ── services in flow order (§4 step 7), now that the edges are known, and the links between them ──
  const services = orderServices(allServices, nodes, edgeList);
  const system: CodeMap["system"] = { kind: detected.kind, links: isServices ? systemLinks(services, nodes, edgeList, rules, detected.declaredLinks) : [] };
  const serviceOfNode = new Map(nodes.map((n) => [n.id, n.service]));

  // ── settings with no value that requests are built on, for "Where does this point?" ──
  const order = new Map(services.map((s, i) => [s.id, i]));
  const unresolvedBases: UnresolvedBase[] = [...unsetBases]
    .map(([setting, u]): UnresolvedBase => {
      const links = edgeList.filter((e) => (e.kind === "calls-route" || e.kind === "uses-service") && e.evidence.some((v) => !v.role && u.calls.has(`${v.file}:${v.line}`))).length;
      const reads: Evidence[] = [];
      for (const p of parsed) {
        for (const r of facts[p].envReads) {
          if (r.name === setting && reads.length < 20 && !reads.some((x) => x.file === p && x.line === r.line)) reads.push({ file: p, line: r.line, text: lineText(p, r.line) });
        }
      }
      const out: UnresolvedBase = { setting, services: [...u.services].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), reads, calls: u.calls.size, links, placeholder: elsewhereId(setting) };
      const guess = namedService(setting);
      if (guess) out.guess = guess.id;
      const a = answers.get(setting);
      if (a) out.answer = { setting, service: a.service ? (answeredService(setting)?.id ?? a.service) : null, answeredAt: a.answeredAt };
      return out;
    })
    .sort((a, b) => b.calls - a.calls || a.setting.localeCompare(b.setting));
  // ── public addresses requests go to, for "Whose address is this?" ──
  const publicHosts: PublicHost[] = [...addressUses]
    .map(([host, u]): PublicHost => {
      const links = edgeList.filter((e) => (e.kind === "calls-route" || e.kind === "uses-service") && e.evidence.some((v) => !v.role && u.calls.has(`${v.file}:${v.line}`))).length;
      const ranked = [...u.matches].map(([id, s]) => ({ id, n: s.size })).sort((a, b) => b.n - a.n || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const out: PublicHost = {
        host,
        origin: u.origin,
        setAt: u.setAt,
        services: [...u.services].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
        calls: u.calls.size,
        links,
        matches: Object.fromEntries(ranked.map((r) => [r.id, r.n])),
      };
      // A clear majority: more than half the requests with a path to match, and at least twice any other app's.
      const [top, next] = ranked;
      if (top && top.n * 2 > u.matchable.size && (!next || top.n >= 2 * next.n)) out.guess = top.id;
      const cfg = hostTable.get(host);
      if (cfg?.address?.by === "config") out.config = { service: cfg.service.id, evidence: cfg.evidence[0] };
      const a = hostAnswers.get(host);
      if (a) out.answer = { setting: host, host, service: a.service ? (answeredApp(a.service)?.id ?? a.service) : null, answeredAt: a.answeredAt };
      return out;
    })
    .sort((a, b) => b.calls - a.calls || a.host.localeCompare(b.host));
  const missingRoutes = [...missing.values()].sort((a, b) => (order.get(a.service) ?? 0) - (order.get(b.service) ?? 0) || a.path.localeCompare(b.path) || (a.method ?? "").localeCompare(b.method ?? ""));

  // ── done ──
  for (const fe of files) {
    const f = facts[fe.path];
    if (f) fe.fns = Object.fromEntries(f.fns.map((x) => [x.name, [x.start, x.end, x.calls] as [number, number, string[]]]));
    const svc = detected.serviceOfArea.get(fe.area);
    if (!fe.skipped && svc) fe.service = svc;
  }
  const map: CodeMap = {
    version: 2,
    name: opts.name,
    generatedAt: new Date().toISOString(),
    repos: opts.repos?.length ? opts.repos : [{ label: opts.name, prefix: "", kind: "local" }],
    system,
    services,
    gateways: rules,
    areas,
    files,
    nodes,
    edges: edgeList,
    warnings,
    ...(unresolvedBases.length ? { unresolvedBases } : {}),
    ...(publicHosts.length ? { publicHosts } : {}),
    ...(missingRoutes.length ? { missingRoutes } : {}),
    stats: {
      files: files.length,
      parsed: parsed.length,
      routes: routeNodes.length,
      tables: nodes.filter((n) => n.kind === "table").length,
      edges: edgeList.length,
      likely: edgeList.filter((e) => e.confidence === "likely").length,
      ms: Date.now() - t0,
      services: services.length,
      links: system.links.length,
      crossService: edgeList.filter((e) => {
        const a = serviceOfNode.get(e.from);
        const b = serviceOfNode.get(e.to);
        return !!a && !!b && a !== b;
      }).length,
      ...(assets ? { assets } : {}),
      ...(Object.keys(otherCode).length ? { otherCode } : {}),
    },
  };
  return { map, facts, dbOf: Object.fromEntries(detected.dbOf) };
}
