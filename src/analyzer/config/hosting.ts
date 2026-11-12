// Deploy config read as YAML (docs/SERVICES.md §13, "Whose address is this?"):
// Traefik Host() rules in compose labels, render.yaml and app.yaml domains.
// Kept apart from deploy.ts so the folder readers' file checks need no YAML parser.
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap } from "yaml";
import { caddyAddresses, ciAddresses, cnameAddresses, CI_RE, flyAddresses, ownHost, relDir, vercelAddresses, type DeployAddress } from "./deploy";

function parse(content: string): { doc: ReturnType<typeof parseDocument>; lineOf: (n: unknown) => number } | null {
  const lc = new LineCounter();
  try {
    const doc = parseDocument(content, { lineCounter: lc, prettyErrors: false });
    if (doc.errors.length) return null;
    const lineOf = (n: unknown) => {
      const r = (n as { range?: [number, number, number] } | undefined)?.range;
      return r ? lc.linePos(r[0]).line : 1;
    };
    return { doc, lineOf };
  } catch {
    return null;
  }
}
const str = (n: unknown) => (isScalar(n) && n.value !== null && n.value !== undefined ? String(n.value) : undefined);
const get = (m: unknown, k: string) => (isMap(m) ? (m as YAMLMap).get(k, true) : undefined);
const seq = (n: unknown) => (isSeq(n) ? n.items : []);

/** Hosts in a Traefik rule: Host(`a.com`) || Host(`b.com`, `c.com`). */
function traefikHosts(rule: string): string[] {
  const out: string[] = [];
  for (const m of rule.matchAll(/\bHost(?:SNI)?\(([^)]*)\)/g)) for (const q of m[1].matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'/g)) out.push(q[1] ?? q[2] ?? q[3]);
  return out;
}

/** Compose services with Traefik labels: `traefik.http.routers.api.rule=Host(`api.example.com`)`. */
export function traefikAddresses(path: string, content: string): DeployAddress[] {
  if (!/traefik\.(http|tcp)\.routers\./.test(content)) return [];
  const out: DeployAddress[] = [];
  const p = parse(content);
  const services = p?.doc.get("services", true);
  if (!p || !isMap(services)) return out;
  for (const pair of (services as YAMLMap).items) {
    const name = isScalar(pair.key) ? String(pair.key.value) : undefined;
    const labels = get(pair.value, "labels");
    if (!name) continue;
    const rules: { rule: string; line: number }[] = [];
    for (const item of seq(labels)) {
      const m = /^\s*traefik\.(?:http|tcp)\.routers\.[^.=]+\.rule\s*[=:]\s*(.+)$/.exec(str(item) ?? "");
      if (m) rules.push({ rule: m[1], line: p.lineOf(item) });
    }
    if (isMap(labels)) {
      for (const kv of (labels as YAMLMap).items) {
        const k = str(kv.key) ?? "";
        if (/^traefik\.(?:http|tcp)\.routers\.[^.]+\.rule$/.test(k) && str(kv.value)) rules.push({ rule: str(kv.value)!, line: p.lineOf(kv.key) });
      }
    }
    for (const r of rules) {
      for (const raw of traefikHosts(r.rule)) {
        const host = ownHost(raw, false);
        if (host && !out.some((a) => a.host === host && a.to === name)) out.push({ host, file: path, line: r.line, how: "a Traefik rule", to: name });
      }
    }
  }
  return out;
}

/** render.yaml (`services[].domains`, with `name` and `rootDir`) and app.yaml (DigitalOcean App Platform `domains[].domain`). */
export function domainAddresses(path: string, content: string): DeployAddress[] {
  const out: DeployAddress[] = [];
  const p = parse(content);
  if (!p) return out;
  const root = p.doc.contents;
  // rootDir / source_dir are relative to the repo, whose root is where the file is.
  const here = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const under = (d: string | undefined) => (d && here ? `${here}/${d}` : d);
  if (/(^|\/)render\.ya?ml$/i.test(path)) {
    for (const s of seq(get(root, "services"))) {
      const name = str(get(s, "name"));
      const dir = under(relDir(str(get(s, "rootDir"))));
      for (const d of seq(get(s, "domains"))) {
        const host = ownHost(str(d) ?? "", false);
        if (host) out.push({ host, file: path, line: p.lineOf(d), how: "render.yaml's domains", ...(name ? { to: name } : {}), ...(dir ? { dir } : {}) });
      }
    }
    return out;
  }
  // DigitalOcean App Platform: the app's domains reach its one service (or the repo's one app).
  const services = seq(get(root, "services"));
  const only = services.length === 1 ? str(get(services[0], "name")) : undefined;
  const dir = services.length === 1 ? under(relDir(str(get(services[0], "source_dir")))) : undefined;
  for (const d of seq(get(root, "domains"))) {
    const host = ownHost(str(get(d, "domain")) ?? str(d) ?? "", false);
    if (host) out.push({ host, file: path, line: p.lineOf(d), how: "app.yaml's domains", ...(only ? { to: only } : {}), ...(dir ? { dir } : {}) });
  }
  return out;
}

/** Every public address a deploy file names; compose files are read for their Traefik labels. */
export function readDeploy(path: string, content: string, kind: "deploy" | "compose"): DeployAddress[] {
  if (kind === "compose") return traefikAddresses(path, content);
  const b = path.slice(path.lastIndexOf("/") + 1);
  if (CI_RE.test(path)) return ciAddresses(path, content);
  if (/^caddyfile([.-][^/]*)?$/i.test(b) || /\.caddyfile$/i.test(b)) return caddyAddresses(path, content);
  if (b === "fly.toml") return flyAddresses(path, content);
  if (/^(render|app)\.ya?ml$/i.test(b)) return domainAddresses(path, content);
  if (b === "vercel.json") return vercelAddresses(path, content);
  if (b === "CNAME") return cnameAddresses(path, content);
  return [];
}
