// docker-compose*.yml / compose*.yml: one service per `services.<name>`, with
// the folder it is built from, the names other containers reach it by, its
// ports, its environment and what it starts after. Read with `yaml` so every
// value keeps its line. Override files are merged in by mergeCompose().
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, type Node, type Pair, type YAMLMap } from "yaml";
import { ENV_EXAMPLE_RE, joinPath, redactValue } from "./files";
import type { ConfigService } from "./types";

type Kind = ConfigService["kind"];

/** What an image-only service is, by its image name. */
const IMAGE_KINDS: [RegExp, Kind][] = [
  [/postgres|mysql|mariadb|mongo|cockroach|sqlite/, "db"],
  [/redis|memcached|keydb/, "cache"],
  [/kafka|redpanda|rabbitmq|nats|activemq|mosquitto|pulsar/, "broker"],
  [/nginx|traefik|kong|envoy|caddy|haproxy/, "gateway"],
];

export function kindOfImage(image: string): Kind | null {
  // The repository name only: "ghcr.io/acme/postgres-tools:1" is judged by "postgres-tools".
  const repo = image.split("@")[0].replace(/:[^/:]*$/, "").split("/").pop()!.toLowerCase();
  return IMAGE_KINDS.find(([re]) => re.test(repo))?.[1] ?? null;
}

export interface ComposeRead {
  services: ConfigService[];
  warnings: string[];
}

/** `${VAR:-default}` and `${VAR-default}` → default; `$$` → `$`. Plain `${VAR}` stays as written. */
function interp(v: string): string {
  return v.replace(/\$\{(\w+):?-([^}]*)\}/g, (_, __, d: string) => d).replace(/\$\$/g, "$");
}

function scalarText(n: unknown): string | undefined {
  if (isScalar(n)) return n.value === null || n.value === undefined ? undefined : String(n.value);
  return undefined;
}

function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((p) => isPair(p) && isScalar(p.key) && String(p.key.value) === key) as Pair | undefined;
}

function valueOf(map: YAMLMap, key: string): unknown {
  return pairOf(map, key)?.value;
}

function portsOf(n: unknown): { host?: number; container: number }[] {
  const out: { host?: number; container: number }[] = [];
  if (!isSeq(n)) return out;
  for (const item of n.items) {
    if (isMap(item)) {
      const target = parseInt(scalarText(valueOf(item, "target")) ?? "", 10);
      const published = parseInt(scalarText(valueOf(item, "published")) ?? "", 10);
      if (target > 0) out.push(published > 0 ? { host: published, container: target } : { container: target });
      continue;
    }
    const s = scalarText(item);
    if (!s) continue;
    // [ip:]host:container[/proto], ranges "8000-8001" count by their first port.
    const parts = interp(s).replace(/\/\w+$/, "").split(":");
    const num = (x: string | undefined) => (x ? parseInt(x.split("-")[0], 10) : NaN);
    const container = num(parts[parts.length - 1]);
    const host = parts.length >= 2 ? num(parts[parts.length - 2]) : NaN;
    if (container > 0) out.push(host > 0 ? { host, container } : { container });
  }
  return out;
}

function listOrKeys(n: unknown): string[] {
  if (isSeq(n)) return n.items.map(scalarText).filter((x): x is string => !!x);
  if (isMap(n)) return n.items.map((p) => (isPair(p) ? scalarText(p.key) : undefined)).filter((x): x is string => !!x);
  const s = scalarText(n);
  return s ? [s] : [];
}

function commandText(n: unknown): string | undefined {
  if (isSeq(n)) return n.items.map(scalarText).filter(Boolean).join(" ") || undefined;
  return scalarText(n);
}

/** The example env files that stand for an `env_file` entry: the entry itself
 * when it is an example variant, else `<entry>.example` (and friends) beside it. */
export function exampleFor(path: string, has: (p: string) => boolean): string[] {
  if (ENV_EXAMPLE_RE.test(path)) return has(path) ? [path] : [];
  return [".example", ".sample", ".template", ".dist"].map((x) => path + x).filter((p) => ENV_EXAMPLE_RE.test(p) && has(p));
}

/** Read one compose file. `has` says whether a path is among the files read (for env_file). */
export function readCompose(path: string, content: string, has: (p: string) => boolean = () => false): ComposeRead {
  const warnings: string[] = [];
  const lc = new LineCounter();
  const doc = parseDocument(content, { lineCounter: lc, uniqueKeys: false, prettyErrors: false });
  if (doc.errors.length) {
    warnings.push(`could not read ${path}: ${doc.errors[0].message.split("\n")[0]}`);
    return { services: [], warnings };
  }
  const lineOf = (n: unknown): number => {
    const r = (n as Node | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const root = doc.contents;
  if (!isMap(root)) return { services: [], warnings };
  const svcs = valueOf(root, "services");
  if (!isMap(svcs)) return { services: [], warnings };

  const out: ConfigService[] = [];
  const aliasesFor = new Map<string, string[]>(); // links: "target:alias" gives target another name
  for (const p of svcs.items) {
    if (!isPair(p) || !isScalar(p.key) || !isMap(p.value)) continue;
    const name = String(p.key.value);
    const m = p.value;
    const svc: ConfigService = { name, kind: "app", hostnames: [name], ports: [], env: {}, envFiles: [], dependsOn: [], file: path, line: lineOf(p.key), source: "compose" };

    const build = valueOf(m, "build");
    const buildCtx = isMap(build) ? scalarText(valueOf(build, "context")) ?? "." : scalarText(build);
    if (buildCtx !== undefined) {
      svc.dir = joinPath(dir, interp(buildCtx));
      const df = isMap(build) ? scalarText(valueOf(build, "dockerfile")) : undefined;
      if (df) svc.dockerfile = joinPath(svc.dir, interp(df));
    }
    const image = scalarText(valueOf(m, "image"));
    if (image) svc.image = interp(image);
    if (buildCtx === undefined) svc.kind = (image && kindOfImage(image)) || "placeholder";

    for (const k of ["container_name", "hostname"]) {
      const h = scalarText(valueOf(m, k));
      if (h && !svc.hostnames.includes(h)) svc.hostnames.push(h);
    }
    const nets = valueOf(m, "networks");
    if (isMap(nets)) {
      for (const np of nets.items) {
        if (!isPair(np) || !isMap(np.value)) continue;
        for (const a of listOrKeys(valueOf(np.value, "aliases"))) if (!svc.hostnames.includes(a)) svc.hostnames.push(a);
      }
    }
    for (const l of listOrKeys(valueOf(m, "links"))) {
      const [target, alias] = l.split(":");
      if (alias) aliasesFor.set(target, [...(aliasesFor.get(target) ?? []), alias]);
    }

    svc.ports = portsOf(valueOf(m, "ports"));
    for (const e of listOrKeys(valueOf(m, "expose"))) {
      const n = parseInt(e, 10);
      if (n > 0 && !svc.ports.some((x) => x.container === n)) svc.ports.push({ container: n });
    }

    const env = valueOf(m, "environment");
    if (isMap(env)) {
      for (const ep of env.items) {
        if (!isPair(ep)) continue;
        const k = scalarText(ep.key);
        const v = scalarText(ep.value);
        if (k && v !== undefined) svc.env[k] = { value: redactValue(k, interp(v)), line: lineOf(ep.key) };
      }
    } else if (isSeq(env)) {
      for (const item of env.items) {
        const s = scalarText(item);
        const eq = s?.indexOf("=") ?? -1;
        if (!s || eq <= 0) continue;
        const k = s.slice(0, eq).trim();
        svc.env[k] = { value: redactValue(k, interp(s.slice(eq + 1))), line: lineOf(item) };
      }
    }
    const envFile = valueOf(m, "env_file");
    const envFiles = isSeq(envFile) ? envFile.items.map((x) => (isMap(x) ? scalarText(valueOf(x, "path")) : scalarText(x))) : [scalarText(envFile)];
    for (const f of envFiles) if (f) for (const ex of exampleFor(joinPath(dir, interp(f)), has)) if (!svc.envFiles.includes(ex)) svc.envFiles.push(ex);

    svc.dependsOn = listOrKeys(valueOf(m, "depends_on"));
    const cmdPair = pairOf(m, "command") ?? pairOf(m, "entrypoint");
    const cmd = cmdPair ? commandText(cmdPair.value) : undefined;
    if (cmd) {
      svc.entry = interp(cmd);
      svc.entryLine = lineOf(cmdPair!.key);
      svc.entryFile = path;
    }
    out.push(svc);
  }
  for (const s of out) for (const a of aliasesFor.get(s.name) ?? []) if (!s.hostnames.includes(a)) s.hostnames.push(a);
  return { services: out, warnings };
}

/** An override file on top of a base one, as `docker compose` merges them:
 * scalars replaced, environment merged by name, lists joined. */
export function mergeCompose(base: ConfigService, over: ConfigService): ConfigService {
  const out: ConfigService = { ...base, env: { ...base.env }, hostnames: [...base.hostnames], ports: [...base.ports], envFiles: [...base.envFiles], dependsOn: [...base.dependsOn] };
  (out.also ??= []).push({ file: over.file, line: over.line });
  for (const [k, v] of Object.entries(over.env)) out.env[k] = { ...v, file: v.file ?? over.file };
  for (const h of over.hostnames) if (!out.hostnames.includes(h)) out.hostnames.push(h);
  for (const p of over.ports) if (!out.ports.some((x) => x.container === p.container && x.host === p.host)) out.ports.push(p);
  for (const f of over.envFiles) if (!out.envFiles.includes(f)) out.envFiles.push(f);
  for (const d of over.dependsOn) if (!out.dependsOn.includes(d)) out.dependsOn.push(d);
  if (over.dir !== undefined) {
    out.dir = over.dir;
    out.kind = "app";
  }
  if (over.dockerfile) out.dockerfile = over.dockerfile;
  if (over.image) {
    out.image = over.image;
    if (out.dir === undefined) out.kind = kindOfImage(over.image) ?? "placeholder";
  }
  if (over.entry) {
    out.entry = over.entry;
    out.entryLine = over.entryLine;
    out.entryFile = over.entryFile;
  }
  return out;
}
