// From config facts and code to services (docs/SERVICES.md §4): which parts of
// the repo are deployable units, which are shared libraries, and whether the
// whole thing is a monolith, a monorepo or a system of services. Config
// proves a boundary first; code (routes, a start command) second.
import type { ConfigFacts, ConfigService } from "./config/types";
import { kindOfImage } from "./config/compose";
import type { FileFacts } from "./facts";
import { monolithService, serviceId } from "./migrate";
import type { CodeMap, Confidence, EdgeKind, Evidence, GatewayRule, MapEdge, MapNode, RepoRef, ServiceDef, ServiceLink, SourceFile } from "./types";

export interface ServiceInput {
  name: string;
  config: ConfigFacts;
  /** Areas of parsed files, sorted. */
  areas: string[];
  manifestDirs: Set<string>;
  areaOf: (p: string) => string;
  /** Sources by path, config files already redacted. */
  byPath: Map<string, SourceFile>;
  facts: Record<string, FileFacts>;
  nodes: MapNode[];
  importEdges: { from: string; to: string }[];
  /** Areas where the Next.js app/ or pages/ convention holds. */
  nextLikeAreas: Set<string>;
  lineText: (p: string, line: number) => string;
  /** The repos of the workspace; with several, each root is a folder a service can be bound to (§6.5). */
  repos?: RepoRef[];
}

/** A line the team wrote about how services depend on each other (compose aside): drawn thin and grey. */
export interface DeclaredLink {
  from: string;
  to: string;
  note: string;
}

export interface ServicesResult {
  services: ServiceDef[];
  kind: CodeMap["system"]["kind"];
  /** area → owning service id (app areas and the libraries they import). */
  serviceOfArea: Map<string, string>;
  /** Library areas → the service drawn as their owner. */
  libraries: Map<string, string>;
  /** App service id → database identity (§4 step 5): `svc-postgres/shop`, `svc-postgres`, or `own:<id>`. */
  dbOf: Map<string, string>;
  /** `${serviceId}|${hostname}` for hostnames taken from a folder name (§4 step 4): a match on one is a guess. */
  guessedHosts: Set<string>;
  /** Service id → the folder its config says it is built from (gateways and other infra included). */
  serviceDirs: Map<string, string>;
  /** Dependencies from catalog-info.yaml, Chart.yaml, workspace.dsl: never calls. */
  declaredLinks: DeclaredLink[];
}

/** "Users-Service" → "users": how services from different sources are matched. */
export function normalisedName(n: string): string {
  return n
    .toLowerCase()
    .replace(/[-_. ]+/g, "-")
    .replace(/-(service|svc|api|app)$/, "");
}

const PRIORITY: Record<ConfigService["source"], number> = { compose: 0, k8s: 1, dockerfile: 2, wrangler: 3, workspace: 4, folder: 5 };
/** pubspec.yaml's `flutter: sdk: flutter` dependency. */
const FLUTTER_SDK = /^\s+sdk:\s*flutter\s*$/m;
const INFRA_ORDER: Record<ServiceDef["kind"], number> = { app: 0, db: 1, cache: 2, broker: 3, gateway: 4, placeholder: 5 };

export const FRAMEWORKS: [RegExp, string][] = [
  [/"next"\s*:/, "Next.js"],
  [/"nuxt"\s*:/, "Nuxt"],
  [/"@angular\/core"\s*:/, "Angular"],
  [/"svelte"\s*:|"@sveltejs\/kit"\s*:/, "Svelte"],
  [/"express"\s*:/, "Express"],
  [/"fastify"\s*:/, "Fastify"],
  [/"koa"\s*:/, "Koa"],
  [/"hono"\s*:/, "Hono"],
  [/"vite"\s*:/, "Vite"],
  [/"react-scripts"\s*:/, "Create React App"],
  [/"react"\s*:/, "React"],
  [/^\s*fastapi\b/im, "FastAPI"],
  [/^\s*flask\b/im, "Flask"],
  [/^\s*django\b/im, "Django"],
  [FLUTTER_SDK, "Flutter"],
  // composer.json's "require"
  [/"laravel\/framework"\s*:/, "Laravel"],
  [/"symfony\/framework-bundle"\s*:/, "Symfony"],
  [/"slim\/slim"\s*:/, "Slim"],
];

const SERVER_DEPS = /"(express|fastify|koa|hono|@nestjs\/core|@hapi\/hapi|restify|polka)"\s*:/;
const SERVER_IMPORTS = /^(express|fastify|koa|hono|@nestjs\/core|@hapi\/hapi|restify|polka|http|node:http)$/;
const UI_DEPS = /"(next|vite|react-scripts|@angular\/core|svelte|@sveltejs\/kit|nuxt)"\s*:/;
// composer.json first: a Laravel app's package.json only builds its assets (Vite), the framework is PHP's.
const MANIFEST_NAMES = ["composer.json", "package.json", "requirements.txt", "pyproject.toml", "pubspec.yaml"];

interface Seed {
  key: string;
  name: string;
  kind: ServiceDef["kind"];
  dir?: string;
  image?: string;
  hostnames: string[];
  ports: { host?: number; container?: number }[];
  env: ServiceDef["env"];
  dependsOn: string[];
  entry?: Evidence;
  framework?: string;
  evidence: Evidence[];
  confidence: ServiceDef["confidence"];
  cfg: ConfigService[];
}

/** "Start here" for the one app of a monolith: the `"start"` script of the root
 * package.json (or the first area's), else the first route. Also a framework
 * label from the manifests. */
export function entryOf(sources: SourceFile[] | Map<string, SourceFile>, manifestDirs: Set<string>, nodes: MapNode[]): { entry?: Evidence; framework?: string; evidence: Evidence[] } {
  const byPath = sources instanceof Map ? sources : new Map(sources.map((s) => [s.path, s]));
  const dirs = ["", ...[...manifestDirs].sort((a, b) => a.length - b.length)];
  let framework: string | undefined;
  let entry: Evidence | undefined;
  for (const d of dirs) {
    for (const m of MANIFEST_NAMES) {
      const s = byPath.get(d ? `${d}/${m}` : m);
      if (!s) continue;
      if (!framework) framework = FRAMEWORKS.find(([re]) => re.test(s.content))?.[1];
      if (!entry && m === "package.json") entry = startScript(s);
    }
  }
  if (!entry) for (const d of dirs) if ((entry = flutterMain(d, byPath))) break;
  if (!entry) {
    const r = nodes.find((n) => n.kind === "route" && n.file);
    if (r?.file) entry = { file: r.file, line: r.line ?? 1, text: r.name, role: "code" };
  }
  return { entry, framework, evidence: entry ? [entry] : [] };
}

/** "Start here" for a Flutter app: the main() of the lib/ file that calls runApp(), when
 * pubspec.yaml names the Flutter SDK. A Flutter package with no runApp() is a library. */
function flutterMain(dir: string, byPath: Map<string, SourceFile>): Evidence | undefined {
  const pub = byPath.get(dir ? `${dir}/pubspec.yaml` : "pubspec.yaml");
  if (!pub || !FLUTTER_SDK.test(pub.content)) return undefined;
  const lib = dir ? `${dir}/lib/` : "lib/";
  const isMain = (p: string) => (/\/main\.dart$/.test(p) ? 0 : 1);
  const files = [...byPath.keys()].filter((p) => p.startsWith(lib) && p.endsWith(".dart")).sort((a, b) => isMain(a) - isMain(b) || a.localeCompare(b));
  for (const p of files) {
    const lines = byPath.get(p)!.content.split("\n");
    if (!lines.some((l) => /\brunApp\s*\(/.test(l))) continue;
    const i = lines.findIndex((l) => /^\s*(?:Future<void>\s+|void\s+)?main\s*\(/.test(l));
    const at = i >= 0 ? i : lines.findIndex((l) => /\brunApp\s*\(/.test(l));
    return { file: p, line: at + 1, text: lines[at].trim().slice(0, 160), role: "code" };
  }
  return undefined;
}

function startScript(s: SourceFile): Evidence | undefined {
  const lines = s.content.split("\n");
  const i = lines.findIndex((l) => /^\s*"start"\s*:/.test(l));
  return i >= 0 ? { file: s.path, line: i + 1, text: lines[i].trim().slice(0, 160), role: "config" } : undefined;
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Steps 1-6: seeds from config, area binding, app vs library, hostnames, db identity, system kind. */
export function detectServices(inp: ServiceInput): ServicesResult {
  const { config, areas, manifestDirs, areaOf, byPath, facts, nodes, lineText } = inp;
  /** An area is named after its package folder; the root area's folder is "". */
  const dirOfArea = (a: string) => (a !== "" && manifestDirs.has(a) ? a : "");
  const filesOfArea = new Map<string, string[]>();
  for (const p of Object.keys(facts)) filesOfArea.set(areaOf(p), [...(filesOfArea.get(areaOf(p)) ?? []), p]);
  const cfgEv = (file: string, line: number): Evidence => ({ file, line, text: lineText(file, line), role: "config" });

  // ── 1. seeds, merged by folder, then by normalised name ──
  const seeds: Seed[] = [];
  // Workspace packages that look like apps (apps/*, services/*, Nx projectType) are seeds too, as guesses.
  const workspaceSeeds: ConfigService[] = config.workspaces
    .filter((w) => w.isApp)
    .map((w) => ({ name: (w.name ?? w.dir).split("/").pop() || inp.name, kind: "app", dir: w.dir, hostnames: [], ports: [], env: {}, envFiles: [], dependsOn: [], file: w.file, line: w.line, confidence: "likely", source: "workspace" }));
  const sorted = [...config.services, ...workspaceSeeds].sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source]);
  for (const cs of sorted) {
    const name = cs.name || inp.name;
    const key = normalisedName(name);
    const owner =
      seeds.find((s) => s.cfg.some((c) => c.dockerfile === cs.file)) ??
      (cs.dir !== undefined ? seeds.find((s) => s.dir === cs.dir && s.kind !== "placeholder") : undefined) ??
      seeds.find((s) => s.key === key && (s.dir === undefined || cs.dir === undefined || s.dir === cs.dir)) ??
      // An image-only service a Dockerfile LABEL names (LABEL service=users): its code is in this folder.
      (cs.dir !== undefined && cs.labels?.length ? seeds.find((s) => s.kind === "placeholder" && s.dir === undefined && cs.labels!.some((l) => aliasKeys(s).includes(normalisedName(l.value)))) : undefined);
    const ev = [cfgEv(cs.file, cs.line), ...(cs.also ?? []).map((a) => cfgEv(a.file, a.line))];
    const env: ServiceDef["env"] = {};
    for (const [k, v] of Object.entries(cs.env)) env[k] = { value: v.value, file: v.file ?? cs.file, line: v.line };
    const entry = cs.entry && cs.entryLine ? { file: cs.entryFile ?? cs.file, line: cs.entryLine, text: cs.entry.slice(0, 160), role: "config" as const } : undefined;
    if (!owner) {
      seeds.push({ key, name, kind: cs.kind, dir: cs.dir, image: cs.image, hostnames: [...cs.hostnames], ports: [...cs.ports], env, dependsOn: [...cs.dependsOn], entry, framework: cs.framework, evidence: ev, confidence: cs.confidence ?? (cs.kind === "placeholder" ? "likely" : "certain"), cfg: [cs] });
      continue;
    }
    // Merged by a Dockerfile LABEL that names the service: that line is evidence too.
    for (const l of cs.labels ?? []) if (aliasKeys(owner).includes(normalisedName(l.value))) ev.push(cfgEv(cs.file, l.line));
    // The higher-priority source (already there) keeps name/kind/areas/confidence; this one adds.
    owner.cfg.push(cs);
    for (const e of ev) if (!owner.evidence.some((x) => x.file === e.file && x.line === e.line)) owner.evidence.push(e);
    if (owner.kind === "placeholder" && cs.dir !== undefined) {
      // An image-only compose service whose code is here after all: bound by name only, so a guess.
      owner.kind = "app";
      owner.dir = cs.dir;
      owner.confidence = "likely";
    }
    for (const h of cs.hostnames) if (!owner.hostnames.includes(h)) owner.hostnames.push(h);
    for (const p of cs.ports) if (!owner.ports.some((x) => x.container === p.container)) owner.ports.push(p);
    for (const [k, v] of Object.entries(env)) if (!(k in owner.env)) owner.env[k] = v;
    for (const d of cs.dependsOn) if (!owner.dependsOn.includes(d)) owner.dependsOn.push(d);
    owner.entry ??= entry;
    owner.framework ??= cs.framework;
    owner.image ??= cs.image;
  }
  // ── 1b. an image-only service whose code is here after all (§6.5): a repo whose label, or a
  // package whose manifest name, is the service's name or its image's; bound by name, so a guess ──
  const aliases = dirAliases(inp);
  for (const s of seeds) {
    if (s.kind !== "placeholder" || s.dir !== undefined) continue;
    const hit = aliasKeys(s)
      .flatMap((k) => aliases.get(k) ?? [])
      .sort((a, b) => a.rank - b.rank || a.dir.localeCompare(b.dir))[0];
    if (!hit) continue;
    s.kind = "app";
    s.dir = hit.dir;
    s.confidence = "likely";
    if (!s.evidence.some((e) => e.file === hit.evidence.file && e.line === hit.evidence.line)) s.evidence.push(hit.evidence);
    // A seed already built from that folder (its Dockerfile) is the same service.
    for (const other of seeds.filter((x) => x !== s && x.dir === hit.dir)) {
      for (const e of other.evidence) if (!s.evidence.some((x) => x.file === e.file && x.line === e.line)) s.evidence.push(e);
      for (const p of other.ports) if (!s.ports.some((x) => x.container === p.container)) s.ports.push(p);
      for (const [k, v] of Object.entries(other.env)) if (!(k in s.env)) s.env[k] = v;
      s.entry ??= other.entry;
      s.framework ??= other.framework;
      s.cfg.push(...other.cfg);
      seeds.splice(seeds.indexOf(other), 1);
    }
  }

  // Folder convention (apps/*, services/*) only when no config file names a service.
  if (!seeds.length && !config.workspaces.length) {
    for (const a of areas) {
      if (!/(^|\/)(apps|services)\/[^/]+$/.test(a)) continue;
      const file = MANIFEST_NAMES.map((m) => `${a}/${m}`).find((p) => byPath.has(p)) ?? filesOfArea.get(a)?.[0];
      if (!file) continue;
      seeds.push({ key: normalisedName(basename(a)), name: basename(a), kind: "app", dir: a, hostnames: [], ports: [], env: {}, dependsOn: [], evidence: [{ file, line: 1, text: `${lineText(file, 1)}`.slice(0, 160) || file, role: "code" }], confidence: "likely", cfg: [] });
    }
  }

  // ── 2. area binding: each area goes to the seed with the longest folder at or above it ──
  const areasOfSeed = new Map<Seed, string[]>();
  const seedOfArea = new Map<string, Seed>();
  for (const a of areas) {
    const d = dirOfArea(a);
    let best: Seed | undefined;
    for (const s of seeds) {
      if (s.dir === undefined || s.kind !== "app") continue;
      if (s.dir === d || s.dir === "" || d.startsWith(s.dir + "/")) if (!best || s.dir!.length > best.dir!.length) best = s;
    }
    if (!best) continue;
    seedOfArea.set(a, best);
    areasOfSeed.set(best, [...(areasOfSeed.get(best) ?? []), a]);
  }
  // A seed built from a folder with no code of its own (an nginx image, say) is infra, when its image says so.
  for (const s of seeds) {
    if (s.kind !== "app" || areasOfSeed.has(s)) continue;
    const k = kindOfImage(s.image ?? s.name);
    if (k) s.kind = k;
  }

  // ── 3. app vs library for areas no seed claims ──
  const appAreas: { area: string; evidence: Evidence; confidence: "likely" }[] = [];
  const libraryAreas: string[] = [];
  for (const a of areas) {
    if (seedOfArea.has(a)) continue;
    const why = entrypointOf(a, dirOfArea(a), inp, filesOfArea.get(a) ?? []);
    if (why) appAreas.push({ area: a, evidence: why, confidence: "likely" });
    else libraryAreas.push(a);
  }

  const services: ServiceDef[] = [];
  const serviceOfArea = new Map<string, string>();
  const libraries = new Map<string, string>();
  const seedApps = seeds.filter((s) => s.kind === "app").length;
  const appCount = seedApps + appAreas.length;

  const idOfComposeName = (n: string) => serviceId(seeds.find((x) => x.cfg.some((c) => c.name === n))?.name ?? n);
  if ((!seeds.length && appCount <= 1) || appCount === 0) {
    // The monolith rule: one app is the whole repo, named after it, as in v1. Also when
    // config names only infrastructure (a compose file that starts just postgres).
    const { entry, framework, evidence } = entryOf(byPath, manifestDirs, nodes);
    let ev = appAreas[0] ? dedupe([...evidence, appAreas[0].evidence]) : evidence;
    if (!ev.length) ev = firstLineEvidence(areas, manifestDirs, filesOfArea, byPath, lineText);
    const app = monolithService(inp.name, areas, nodes, { entry, framework, evidence: ev });
    for (const a of areas) serviceOfArea.set(a, app.id);
    services.push(app);
    for (const s of seeds) services.push(toServiceDef(s, [], inp, idOfComposeName));
  } else {
    for (const s of seeds) {
      const bound = areasOfSeed.get(s) ?? [];
      const def = toServiceDef(s, bound, inp, idOfComposeName);
      services.push(def);
      for (const a of bound) serviceOfArea.set(a, def.id);
    }
    for (const x of appAreas) {
      const name = dirOfArea(x.area) === "" ? inp.name : basename(x.area);
      let id = serviceId(name);
      while (services.some((s) => s.id === id)) id = `${id}-2`;
      const dir = dirOfArea(x.area);
      const def: ServiceDef = {
        id,
        name,
        kind: "app",
        areas: [x.area],
        hostnames: [],
        devHosts: [],
        ports: [],
        entry: packageStart(dir, byPath) ?? x.evidence,
        framework: frameworkOf([dir], byPath),
        env: {},
        dependsOn: [],
        evidence: [x.evidence],
        confidence: "likely",
        counts: { ui: 0, api: 0, logic: 0, data: 0 },
      };
      services.push(def);
      serviceOfArea.set(x.area, def.id);
    }
    // Libraries: the app service that imports them most (transitively through other libraries);
    // a workspace dependency on a sibling package counts as one import.
    const areaOfFile = (p: string) => areaOf(p);
    const wsDir = new Map(config.workspaces.filter((w) => w.name).map((w) => [w.name!, w.dir]));
    const workspaceLinks = config.workspaces.flatMap((w) =>
      w.deps.filter((d) => wsDir.has(d) && wsDir.get(d) !== w.dir).map((d) => ({ from: `${w.dir ? `${w.dir}/` : ""}package.json`, to: `${wsDir.get(d) ? `${wsDir.get(d)}/` : ""}package.json` })),
    );
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (const lib of libraryAreas) {
        if (libraries.has(lib)) continue;
        const counts = new Map<string, number>();
        for (const e of [...inp.importEdges, ...workspaceLinks]) {
          if (areaOfFile(e.to) !== lib) continue;
          const from = serviceOfArea.get(areaOfFile(e.from));
          if (from && areaOfFile(e.from) !== lib) counts.set(from, (counts.get(from) ?? 0) + 1);
        }
        if (!counts.size) continue;
        const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || services.findIndex((s) => s.id === x[0]) - services.findIndex((s) => s.id === y[0]))[0][0];
        libraries.set(lib, best);
        serviceOfArea.set(lib, best);
        changed = true;
      }
      if (!changed) break;
    }
    // Nobody imports it: with exactly one app, it is that app's; otherwise it belongs to no service.
    const apps = services.filter((s) => s.kind === "app");
    if (apps.length === 1) for (const lib of libraryAreas) if (!serviceOfArea.has(lib)) serviceOfArea.set(lib, apps[0].id);
  }

  // ── 4. hostnames and dev hosts for apps with no config ──
  const guessedHosts = new Set<string>();
  for (const s of services) {
    if (s.kind !== "app" || s.hostnames.length) continue;
    for (const a of s.areas) {
      const h = basename(a).toLowerCase();
      if (h && !s.hostnames.includes(h)) s.hostnames.push(h);
      if (h) guessedHosts.add(`${s.id}|${h}`);
      const port = listenPortOf(filesOfArea.get(a) ?? [], byPath);
      if (port) {
        for (const d of [`localhost:${port.port}`, `127.0.0.1:${port.port}`]) if (!s.devHosts.includes(d)) s.devHosts.push(d);
        if (!s.ports.some((p) => p.container === port.port)) s.ports.push({ container: port.port });
        if (!s.evidence.some((e) => e.file === port.file && e.line === port.line)) s.evidence.push({ file: port.file, line: port.line, text: lineText(port.file, port.line), role: "code" });
      }
    }
  }

  // ── env table: compose > k8s > Dockerfile (already in, by priority) > .env.example > code default ──
  for (const s of services) {
    const own = new Set(s.areas);
    for (const v of config.envValues) {
      if (v.scope || v.name in s.env) continue;
      if (!own.has(areaOf(v.file))) continue;
      s.env[v.name] = { value: v.value, file: v.file, line: v.line };
    }
    for (const a of s.areas) {
      for (const p of filesOfArea.get(a) ?? []) {
        for (const c of Object.values(facts[p].consts)) {
          if (c.envVar && c.literal && !(c.envVar in s.env)) s.env[c.envVar] = { value: c.literal, file: p, line: c.line };
        }
      }
    }
  }

  // ── 5. database identity per app service ──
  const dbOf = new Map<string, string>();
  const hostTable = new Map<string, ServiceDef>();
  for (const s of services) if (s.kind === "db" || s.kind === "cache") for (const h of s.hostnames) hostTable.set(h.toLowerCase(), s);
  for (const s of services) {
    if (s.kind !== "app") continue;
    let id = `own:${s.id}`;
    for (const k of ["DATABASE_URL", "DB_URL", "POSTGRES_URL", "MYSQL_URL", "MONGO_URL", "REDIS_URL", "DB_HOST", "POSTGRES_HOST"]) {
      const v = s.env[k]?.value;
      if (!v) continue;
      const u = /^[a-z][\w+.-]*:\/\/(?:[^@/]*@)?([^/:?#,]+)(?::(\d+))?(?:\/([^/?#]*))?/i.exec(v);
      const bare = u ? null : /^([^/:?#\s]+)(?::(\d+))?$/.exec(v);
      const host = (u?.[1] ?? bare?.[1] ?? "").toLowerCase();
      const port = u?.[2] ?? bare?.[2];
      const hit = (port ? hostTable.get(`${host}:${port}`) : undefined) ?? hostTable.get(host);
      if (hit) id = u?.[3] ? `${hit.id}/${u[3]}` : hit.id;
      break;
    }
    dbOf.set(s.id, id);
  }

  // ── 6. what kind of system this is ──
  const kind: CodeMap["system"]["kind"] = appCount >= 2 ? "services" : appCount === 1 && libraryAreas.length > 0 ? "monorepo" : "monolith";

  const serviceDirs = new Map<string, string>();
  for (const s of seeds) if (s.dir !== undefined && !serviceDirs.has(serviceId(s.name))) serviceDirs.set(serviceId(s.name), s.dir);

  // ── 9. what the team wrote down: groups for the services it names, cards for the ones it
  // names that nothing else shows (system view only), and declared dependencies ──
  const declaredLinks = declared(config, services, kind, lineText);

  return { services, kind, serviceOfArea, libraries, dbOf, guessedHosts, serviceDirs, declaredLinks };
}

/** The names a seed may go by elsewhere: its own and its image's ("ghcr.io/acme/users:2" → "users"). */
function aliasKeys(s: { key: string; image?: string }): string[] {
  const out = [s.key];
  if (s.image) {
    const repo = s.image.split("@")[0].replace(/:[^/:]*$/, "").split("/").pop();
    if (repo && !out.includes(normalisedName(repo))) out.push(normalisedName(repo));
  }
  return out;
}

/** The manifest name of a package folder: package.json "name" (scope dropped), pyproject/Cargo `name =`, pubspec `name:`. */
function manifestName(dir: string, byPath: Map<string, SourceFile>): { name: string; file: string; line: number } | undefined {
  for (const m of ["package.json", "pyproject.toml", "Cargo.toml", "pubspec.yaml"]) {
    const file = dir ? `${dir}/${m}` : m;
    const s = byPath.get(file);
    if (!s) continue;
    const lines = s.content.split("\n");
    const i = lines.findIndex((l) => (m === "package.json" ? /^\s*"name"\s*:\s*"[^"]+"/ : m === "pubspec.yaml" ? /^name:\s*\S/ : /^\s*name\s*=\s*["'][^"']+["']/).test(l));
    if (i < 0) continue;
    const raw = /"name"\s*:\s*"([^"]+)"|name\s*=\s*["']([^"']+)["']|^name:\s*["']?([\w-]+)/.exec(lines[i]);
    const name = (raw?.[1] ?? raw?.[2] ?? raw?.[3] ?? "").replace(/^@[^/]+\//, "");
    if (name) return { name, file, line: i + 1 };
  }
  return undefined;
}

/** Folders an image-only service can be bound to, by name: repo roots by label (rank 0), then
 * package folders by manifest name (rank 1). */
function dirAliases(inp: ServiceInput): Map<string, { dir: string; rank: number; evidence: Evidence }[]> {
  const out = new Map<string, { dir: string; rank: number; evidence: Evidence }[]>();
  const add = (key: string, dir: string, rank: number, evidence: Evidence) => {
    const list = out.get(key) ?? [];
    if (!list.some((x) => x.dir === dir)) list.push({ dir, rank, evidence });
    out.set(key, list);
  };
  const repoRoots = (inp.repos ?? []).filter((r) => r.prefix);
  for (const r of repoRoots) {
    const dir = r.prefix.replace(/\/+$/, "");
    const m = manifestName(dir, inp.byPath);
    const first = m ? undefined : [...inp.byPath.keys()].sort().find((p) => p.startsWith(`${dir}/`));
    const evidence: Evidence | undefined = m ? { file: m.file, line: m.line, text: inp.lineText(m.file, m.line), role: "config" } : first ? { file: first, line: 1, text: inp.lineText(first, 1), role: "code" } : undefined;
    if (evidence) add(normalisedName(r.label), dir, 0, evidence);
  }
  for (const d of [...inp.manifestDirs].sort()) {
    const m = manifestName(d, inp.byPath);
    if (m) add(normalisedName(m.name), d, 1, { file: m.file, line: m.line, text: inp.lineText(m.file, m.line), role: "config" });
  }
  return out;
}

/** Step 9: catalog-info.yaml / compass.yml / workspace.dsl / Chart.yaml. A name that matches a service
 * gives it its `group`; in a system of services, a name that matches none is a declared-only card. */
function declared(config: ConfigFacts, services: ServiceDef[], kind: CodeMap["system"]["kind"], lineText: (p: string, line: number) => string): DeclaredLink[] {
  const links: DeclaredLink[] = [];
  if (!config.declared.length) return links;
  const find = (name: string) => services.find((s) => normalisedName(s.name) === normalisedName(name));
  const NOT_CARDS = /^(system|api|group|user|domain|location|template)(:|$)|:library$|:(documentation|website-docs)$|^helm chart$|^compass:(library|other)$/;
  const idOf = new Map<string, string>();
  for (const d of config.declared) {
    const hit = find(d.name);
    if (hit) {
      if (d.system) hit.group ??= d.system;
      idOf.set(d.name, hit.id);
      continue;
    }
    if (kind !== "services" || NOT_CARDS.test(d.kind)) continue;
    let id = serviceId(d.name);
    while (services.some((s) => s.id === id)) id = `${id}-2`;
    services.push({
      id,
      name: d.name,
      kind: /^resource:(database|db)/.test(d.kind) ? "db" : "placeholder",
      areas: [],
      hostnames: [],
      devHosts: [],
      ports: [],
      env: {},
      dependsOn: [],
      evidence: [{ file: d.file, line: d.line, text: lineText(d.file, d.line), role: "config" }],
      confidence: "likely",
      declared: true,
      ...(d.system ? { group: d.system } : {}),
      counts: { ui: 0, api: 0, logic: 0, data: 0 },
    });
    idOf.set(d.name, id);
  }
  if (kind !== "services") return links;
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const provider = new Map<string, string>();
  for (const d of config.declared) for (const api of d.provides) if (idOf.has(d.name)) provider.set(normalisedName(api), idOf.get(d.name)!);
  for (const d of config.declared) {
    const from = idOf.get(d.name);
    if (!from) continue;
    const note = `the team wrote this in ${base(d.file)}:${d.line}; I did not see it in code`;
    const targets = [...d.dependsOn.map((n) => find(n)?.id ?? idOf.get(n)), ...d.consumes.map((api) => provider.get(normalisedName(api)))];
    for (const to of targets) if (to && to !== from && !links.some((l) => l.from === from && l.to === to)) links.push({ from, to, note });
  }
  return links;
}

/** Last resort so the one app still has a line to point at: its first manifest, else its first file. */
function firstLineEvidence(areas: string[], manifestDirs: Set<string>, filesOfArea: Map<string, string[]>, byPath: Map<string, SourceFile>, lineText: (p: string, line: number) => string): Evidence[] {
  const dirs = ["", ...[...manifestDirs].sort((a, b) => a.length - b.length)];
  const file =
    dirs.flatMap((d) => MANIFEST_NAMES.map((m) => (d ? `${d}/${m}` : m))).find((p) => byPath.has(p)) ??
    areas.map((a) => filesOfArea.get(a)?.[0]).find(Boolean);
  return file ? [{ file, line: 1, text: lineText(file, 1), role: MANIFEST_NAMES.includes(basename(file)) ? "config" : "code" }] : [];
}

function dedupe(ev: Evidence[]): Evidence[] {
  return ev.filter((e, i) => ev.findIndex((x) => x.file === e.file && x.line === e.line) === i);
}

function packageStart(dir: string, byPath: Map<string, SourceFile>): Evidence | undefined {
  const s = byPath.get(dir ? `${dir}/package.json` : "package.json");
  return s ? startScript(s) : undefined;
}

function frameworkOf(dirs: string[], byPath: Map<string, SourceFile>): string | undefined {
  for (const d of dirs) {
    for (const m of MANIFEST_NAMES) {
      const s = byPath.get(d ? `${d}/${m}` : m);
      const f = s && FRAMEWORKS.find(([re]) => re.test(s.content))?.[1];
      if (f) return f;
    }
  }
  return undefined;
}

function toServiceDef(s: Seed, areas: string[], inp: ServiceInput, idOf: (composeName: string) => string): ServiceDef {
  const containerPorts = s.ports.map((p) => p.container).filter((p): p is number => !!p);
  const hostnames = [...s.hostnames];
  if (s.kind !== "placeholder") for (const h of s.hostnames) for (const p of containerPorts) if (!hostnames.includes(`${h}:${p}`)) hostnames.push(`${h}:${p}`);
  const devHosts: string[] = [];
  for (const p of s.ports) if (p.host) for (const d of [`localhost:${p.host}`, `127.0.0.1:${p.host}`]) if (!devHosts.includes(d)) devHosts.push(d);
  const dirs = areas.map((a) => (inp.manifestDirs.has(a) ? a : ""));
  return {
    id: serviceId(s.name),
    name: s.name,
    kind: s.kind,
    areas: s.kind === "app" ? areas : [],
    hostnames,
    devHosts,
    ports: s.ports.map((p) => (p.host ? { host: p.host, container: p.container } : { container: p.container })),
    image: s.image,
    entry: s.entry ?? (s.kind === "app" ? dirs.map((d) => packageStart(d, inp.byPath)).find(Boolean) : undefined),
    framework: (s.kind === "app" ? frameworkOf(dirs, inp.byPath) : undefined) ?? s.framework,
    env: s.env,
    dependsOn: s.dependsOn.map(idOf),
    evidence: s.evidence,
    confidence: s.confidence,
    counts: { ui: 0, api: 0, logic: 0, data: 0 },
  };
}

/** Why an area with no config is an app, or undefined for a library (§4 step 3). */
function entrypointOf(area: string, dir: string, inp: ServiceInput, files: string[]): Evidence | undefined {
  const { facts, byPath, nodes, lineText } = inp;
  const route = nodes.find((n) => n.kind === "route" && n.area === area && n.file);
  if (route?.file) return { file: route.file, line: route.line ?? 1, text: lineText(route.file, route.line ?? 1), role: "code" };
  const pj = byPath.get(dir ? `${dir}/package.json` : "package.json");
  if (pj) {
    const start = startScript(pj);
    const lineOf = (re: RegExp): Evidence | undefined => {
      const i = pj.content.split("\n").findIndex((l) => re.test(l));
      return i < 0 ? undefined : { file: pj.path, line: i + 1, text: lineText(pj.path, i + 1), role: "config" };
    };
    const main = lineOf(/^\s*"main"\s*:/);
    const server = SERVER_DEPS.test(pj.content) || files.some((p) => facts[p].imports.some((i) => SERVER_IMPORTS.test(i.spec)));
    if ((start || main) && server) return start ?? main;
    // A front end: JSX plus a UI framework in the manifest; the dependency line is the proof.
    if (UI_DEPS.test(pj.content) && files.some((p) => facts[p].hasJsx)) return start ?? lineOf(UI_DEPS);
  }
  if (inp.nextLikeAreas.has(area)) {
    const page = files.find((p) => /(^|\/)(app|pages)\//.test(p)) ?? files[0];
    if (page) return { file: page, line: 1, text: lineText(page, 1), role: "code" };
  }
  // A Flutter app: the SDK in pubspec.yaml and a main() that calls runApp().
  const flutter = flutterMain(dir, byPath);
  if (flutter) return flutter;
  // A server started from Python. A bare `if __name__ == "__main__":` counts only in a real
  // package: loose scripts outside every package (the "root" area) are tools, not services.
  const isPackage = inp.manifestDirs.has(dir);
  for (const p of files) {
    if (!p.endsWith(".py")) continue;
    const lines = byPath.get(p)?.content.split("\n") ?? [];
    const i = lines.findIndex((l) => /\b(uvicorn|gunicorn)\.run\(|\bapp\.run\(/.test(l) || (isPackage && /^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(l)));
    if (i >= 0) return { file: p, line: i + 1, text: lineText(p, i + 1), role: "code" };
  }
  return undefined;
}

/** A port the code listens on: app.listen(3000), uvicorn.run(port=8000), PORT default. */
function listenPortOf(files: string[], byPath: Map<string, SourceFile>): { port: number; file: string; line: number } | undefined {
  const res = [/\.listen\(\s*(\d{2,5})\b/, /\b(?:uvicorn|gunicorn)\.run\([^)]*\bport\s*=\s*(\d{2,5})/, /\bapp\.run\([^)]*\bport\s*=\s*(\d{2,5})/, /process\.env\.PORT\s*(?:\|\||\?\?)\s*["']?(\d{2,5})/, /(?:getenv|environ\.get)\(\s*["']PORT["']\s*,\s*["']?(\d{2,5})/];
  for (const p of files) {
    const lines = byPath.get(p)?.content.split("\n") ?? [];
    for (let i = 0; i < lines.length; i++) {
      for (const re of res) {
        const m = re.exec(lines[i]);
        if (m) return { port: parseInt(m[1], 10), file: p, line: i + 1 };
      }
    }
  }
  return undefined;
}

/** Step 7: app services in flow order (who calls whom, front doors first), then
 * infrastructure by kind, then placeholders. Also fills `counts`. */
export function orderServices(services: ServiceDef[], nodes: MapNode[], edges: MapEdge[]): ServiceDef[] {
  const svcOf = new Map(nodes.map((n) => [n.id, n.service]));
  for (const s of services) s.counts = { ui: 0, api: 0, logic: 0, data: 0 };
  const byId = new Map(services.map((s) => [s.id, s]));
  for (const n of nodes) {
    const s = n.service ? byId.get(n.service) : undefined;
    if (s && n.layer in s.counts) s.counts[n.layer as keyof ServiceDef["counts"]]++;
  }
  const apps = services.filter((s) => s.kind === "app");
  const appIds = new Set(apps.map((s) => s.id));
  const out = new Map<string, Set<string>>(apps.map((s) => [s.id, new Set()]));
  const link = (a?: string, b?: string) => {
    if (a && b && a !== b && appIds.has(a) && appIds.has(b)) out.get(a)!.add(b);
  };
  const publishers = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind === "calls-route" || e.kind === "calls-rpc") link(svcOf.get(e.from), svcOf.get(e.to));
    if (e.kind !== "publishes" && e.kind !== "consumes") continue;
    // The channel end is the chan: node, whichever way the edge is drawn.
    const [chan, code] = e.from.startsWith("chan:") ? [e.from, e.to] : [e.to, e.from];
    const svc = svcOf.get(code);
    const m = e.kind === "publishes" ? publishers : consumers;
    if (svc) m.set(chan, (m.get(chan) ?? new Set()).add(svc));
  }
  for (const [chan, pubs] of publishers) for (const p of pubs) for (const c of consumers.get(chan) ?? []) link(p, c);

  // Kahn's algorithm; ties: services with UI first, then by name; a cycle is broken by name.
  const indeg = new Map(apps.map((s) => [s.id, 0]));
  for (const tos of out.values()) for (const t of tos) indeg.set(t, indeg.get(t)! + 1);
  const rank = (a: ServiceDef, b: ServiceDef) => (b.counts.ui > 0 ? 1 : 0) - (a.counts.ui > 0 ? 1 : 0) || a.name.localeCompare(b.name);
  const done = new Set<string>();
  const ordered: ServiceDef[] = [];
  while (ordered.length < apps.length) {
    const left = apps.filter((s) => !done.has(s.id));
    const ready = left.filter((s) => indeg.get(s.id) === 0).sort(rank);
    const next = ready[0] ?? [...left].sort((a, b) => a.name.localeCompare(b.name))[0];
    done.add(next.id);
    ordered.push(next);
    for (const t of out.get(next.id)!) if (!done.has(t)) indeg.set(t, indeg.get(t)! - 1);
  }
  const rest = services.filter((s) => s.kind !== "app").sort((a, b) => INFRA_ORDER[a.kind] - INFRA_ORDER[b.kind] || a.name.localeCompare(b.name));
  return [...ordered, ...rest];
}

/** Service → service links for the system view, each one backed by node edges
 * (§2 ServiceLink): requests and gRPC calls between apps, requests to a service
 * whose code is not here, reads and writes into another service's database,
 * messages through a channel with one producer and one consumer, and, drawn
 * apart as declarations, compose depends_on and a gateway's forwarding rules. */
export function systemLinks(services: ServiceDef[], nodes: MapNode[], edges: MapEdge[], gateways: GatewayRule[] = [], declaredLinks: DeclaredLink[] = []): ServiceLink[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const links = new Map<string, ServiceLink>();
  const add = (kind: EdgeKind, from: string | undefined, to: string | undefined, e: MapEdge | null, extra: { via?: string; note?: string; confidence?: Confidence } = {}) => {
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) return;
    const id = `${kind}:${from}->${to}${extra.via ? `@${extra.via}` : ""}`;
    let l = links.get(id);
    if (!l) {
      l = { id, from, to, kind, confidence: e?.confidence ?? extra.confidence ?? "certain", edgeIds: [], count: 0 };
      if (extra.via) l.via = extra.via;
      if (extra.note) l.note = extra.note;
      links.set(id, l);
    }
    if (!e) return;
    if (!l.edgeIds.includes(e.id)) {
      l.edgeIds.push(e.id);
      l.count++;
    }
    if (e.confidence === "certain") l.confidence = "certain";
  };
  const svcOf = (id: string) => nodeOf.get(id)?.service;
  const publishers = new Map<string, Map<string, MapEdge[]>>();
  const consumers = new Map<string, Map<string, MapEdge[]>>();
  for (const e of edges) {
    if (e.kind === "calls-route" || e.kind === "calls-rpc") add(e.kind, svcOf(e.from), svcOf(e.to), e);
    else if (e.kind === "uses-service" && nodeOf.get(e.to)?.internal) add("uses-service", svcOf(e.from), svcOf(e.to), e);
    else if (e.kind === "reads" || e.kind === "writes") {
      // Into a database config names (a db service), not a service's own unnamed one.
      const db = nodeOf.get(e.to)?.db;
      const dbSvc = db && !db.startsWith("own:") ? db.split("/")[0] : undefined;
      if (dbSvc && byId.get(dbSvc)?.kind !== "app") add(e.kind, svcOf(e.from), dbSvc, e);
    } else if (e.kind === "publishes" || e.kind === "consumes") {
      const [chan, code] = e.from.startsWith("chan:") ? [e.from, e.to] : [e.to, e.from];
      const s = svcOf(code);
      if (!s) continue;
      const m = e.kind === "publishes" ? publishers : consumers;
      const per = m.get(chan) ?? new Map<string, MapEdge[]>();
      per.set(s, [...(per.get(s) ?? []), e]);
      m.set(chan, per);
    }
  }
  // A channel joins services only when there is one producer and one consumer, and even then it is a guess.
  for (const [chan, pubs] of publishers) {
    const cons = consumers.get(chan);
    if (pubs.size !== 1 || cons?.size !== 1) continue;
    const [[p, pe]] = [...pubs];
    const [[c, ce]] = [...cons];
    if (p === c) continue;
    const note = "one service puts messages on this channel and one picks them up; the name is the only link";
    for (const e of [...pe, ...ce]) add("publishes", p, c, { ...e, confidence: "likely" }, { via: chan, confidence: "likely", note });
  }
  // Declarations, not calls: compose depends_on, and a gateway service's forwarding rules.
  for (const s of services) {
    const at = s.evidence.find((e) => e.role === "config")?.file;
    for (const d of s.dependsOn) add("depends-on", s.id, d, null, { note: `declared in ${at ?? "the config"}, not seen in code` });
  }
  // What the team wrote in catalog-info.yaml / workspace.dsl / Chart.yaml: declared, a guess, never a call.
  for (const d of declaredLinks) add("depends-on", d.from, d.to, null, { note: d.note, confidence: "likely" });
  for (const g of gateways) {
    if (!g.ownerService || !g.toService || byId.get(g.ownerService)?.kind !== "gateway") continue;
    const prefix = g.source.filter((x) => x !== "**").join("/");
    add("proxies", g.ownerService, g.toService, null, { confidence: g.confidence, note: `forwards /${prefix}${prefix ? "/" : ""}* (${g.evidence.file}:${g.evidence.line})` });
  }
  for (const l of links.values()) {
    if (l.confidence === "likely" && !l.note && l.edgeIds.length) l.note = `all ${l.count} of the links behind this are guesses`;
  }
  return [...links.values()];
}
