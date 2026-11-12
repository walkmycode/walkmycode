// Rewrites and proxies: the rules that send a path one app is asked for on to
// another service (docs/SERVICES.md §3, §5 step 3b). Next.js rewrites(), Vite
// server.proxy, the Create React App "proxy" field, Angular proxy.conf.json,
// nginx location/proxy_pass, Kubernetes Ingress and Gateway API HTTPRoute.
// Only literal rules are kept; each one cites the line it is written on.
import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Node as YamlNode, type YAMLMap } from "yaml";
import type { Node } from "web-tree-sitter";
import { parseJsSnippet } from "../parser";
import type { Evidence, GatewayRule, SourceFile } from "../types";
import { ownHost, type DeployAddress } from "./deploy";
import { redactValue } from "./files";
import type { ConfigFacts } from "./types";

export interface GatewayRead {
  rules: GatewayRule[];
  /** next.config `env: {}` values, unscoped (bound to a service by folder later). */
  envValues: ConfigFacts["envValues"];
  warnings: string[];
  /** Public addresses the proxy answers at (nginx server_name, Ingress hosts, HTTPRoute hostnames). */
  addresses?: DeployAddress[];
}

function base(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Which gateway reader a file needs, by its name. */
export function gatewayKindOf(path: string): "next" | "vite" | "cra" | "angular" | "nginx" | "k8s" | null {
  const b = base(path).toLowerCase();
  if (/^next\.config\.[cm]?[jt]s$/.test(b)) return "next";
  if (/^vite\.config\.[cm]?[jt]s$/.test(b)) return "vite";
  if (b === "package.json") return "cra";
  if (b === "proxy.conf.json") return "angular";
  if (/^nginx.*\.conf$/.test(b) || /(^|\/)conf\.d\/[^/]+\.conf$/i.test(path) || /(^|\/)sites-(available|enabled)\/[^/]+$/i.test(path)) return "nginx";
  if (/\.ya?ml$/.test(b)) return "k8s";
  return null;
}

// ── paths ──

/** "/api/:path*" → ["api", "**"]; ":id" → "*"; "(.*)" → "**". Null when a
 * segment is a pattern we can't read. */
export function sourceSegments(pattern: string): string[] | null {
  const clean = pattern.split("?")[0].replace(/^\/+|\/+$/g, "");
  if (!clean) return ["**"];
  const out: string[] = [];
  for (const s of clean.split("/")) {
    if (/^:\w+[*+]$/.test(s) || s === "(.*)" || s === "*" || s === "**" || s === ":path*") out.push("**");
    else if (/^:\w+\??$/.test(s) || /^\[.+\]$/.test(s) || /^\{.+\}$/.test(s)) out.push("*");
    else if (/[()*?+\\^$|]/.test(s)) return null;
    else out.push(s);
  }
  return out;
}

/** Literal segments of a destination path up to its first parameter. */
function literalPrefix(path: string): { segs: string[]; hasParam: boolean } {
  const clean = path.split("?")[0].replace(/^\/+|\/+$/g, "");
  const segs: string[] = [];
  if (!clean) return { segs, hasParam: false };
  for (const s of clean.split("/")) {
    if (s.startsWith(":") || s.includes("$") || s.includes("*")) return { segs, hasParam: true };
    segs.push(s);
  }
  return { segs, hasParam: false };
}

/** "http://users:8080/v1" → host "users:8080", path "/v1"; "/v2/x" → no host. */
function splitUrl(u: string): { host?: string; path: string } {
  const m = /^(?:https?|wss?):\/\/([^/?#]+)(\/[^?#]*)?/i.exec(u.trim());
  if (m) return { host: m[1].toLowerCase(), path: m[2] ?? "" };
  return { path: u.trim() };
}

/** The call's segments after a rule rewrites them, or null when the rule does
 * not match. A call segment "*" (a runtime value) only matches a parameter. */
export function matchGateway(rule: GatewayRule, segs: string[]): string[] | null {
  const src = rule.source;
  let i = 0;
  for (; i < src.length; i++) {
    const s = src[i];
    if (s === "**") return [...rule.prependPath, ...segs.slice(Math.min(rule.strip, segs.length))];
    if (i >= segs.length) return null;
    if (s === "*") continue;
    if (segs[i] !== s) return null;
  }
  if (segs.length !== src.length) return null;
  return [...rule.prependPath, ...segs.slice(Math.min(rule.strip, segs.length))];
}

/** How many leading source segments a rule removes before appending the rest. */
function stripOf(source: string[]): number {
  const i = source.findIndex((s) => s === "*" || s === "**");
  return i < 0 ? source.length : i;
}

function evidence(file: string, lines: string[], line: number): Evidence {
  return { file, line, text: (lines[line - 1] ?? "").trim().slice(0, 160), role: "config" };
}

// ── Next.js / Vite (tree-sitter) ──

function strVal(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "string") return n.text.slice(1, -1);
  if (n.type === "template_string" && !n.namedChildren.some((c) => c.type === "template_substitution")) return n.text.slice(1, -1);
  return undefined;
}

function keyOf(pair: Node): string | undefined {
  const k = pair.childForFieldName("key");
  if (!k) return undefined;
  return k.type === "property_identifier" || k.type === "identifier" ? k.text : strVal(k);
}

function pairsOf(obj: Node): Map<string, Node> {
  const out = new Map<string, Node>();
  for (const c of obj.namedChildren) {
    if (c.type !== "pair") continue;
    const k = keyOf(c);
    const v = c.childForFieldName("value");
    if (k && v) out.set(k, v);
  }
  return out;
}

/** Nodes that define `name` as a function or property: `async rewrites() {}`, `rewrites: () => []`. */
function definitionsOf(root: Node, name: string): Node[] {
  const out: Node[] = [];
  for (const n of root.descendantsOfType(["method_definition", "pair", "function_declaration"])) {
    const key = n.type === "pair" ? keyOf(n) : n.childForFieldName("name")?.text;
    if (key === name) out.push(n);
  }
  return out;
}

export function readNextConfig(path: string, content: string, root: Node): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  const lines = content.split("\n");
  for (const def of definitionsOf(root, "rewrites")) {
    for (const obj of def.descendantsOfType("object")) {
      const p = pairsOf(obj);
      const source = strVal(p.get("source"));
      const destination = strVal(p.get("destination"));
      if (!source || !destination) continue;
      // beforeFiles / afterFiles / fallback: the group is the nearest named array holding the row.
      let group = "";
      for (let a = obj.parent; a && a !== def; a = a.parent) {
        if (a.type === "pair") {
          group = keyOf(a) ?? "";
          break;
        }
      }
      const segs = sourceSegments(source);
      if (!segs) continue;
      const dest = splitUrl(destination);
      const pre = literalPrefix(dest.path);
      const fallback = group === "fallback";
      // A catch-all fallback means "everything unmatched": never applied to a call.
      if (fallback && !(segs[0] && segs[0] !== "*" && segs[0] !== "**")) continue;
      out.rules.push({
        source: segs,
        toHost: dest.host,
        strip: pre.hasParam ? stripOf(segs) : segs.length,
        prependPath: pre.segs,
        kind: "next-rewrite",
        evidence: evidence(path, lines, obj.startPosition.row + 1),
        confidence: fallback || p.has("has") || p.has("missing") ? "likely" : "certain",
      });
    }
  }
  // env: { NAME: "value" } in the config object, not inside rewrites().
  for (const def of definitionsOf(root, "env")) {
    const v = def.childForFieldName("value");
    if (def.type !== "pair" || v?.type !== "object") continue;
    for (const [name, val] of pairsOf(v)) {
      const s = strVal(val);
      if (s === undefined || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
      out.envValues.push({ name, value: redactValue(name, s), file: path, line: val.startPosition.row + 1 });
    }
  }
  return out;
}

export function readViteConfig(path: string, content: string, root: Node): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  const lines = content.split("\n");
  for (const def of definitionsOf(root, "proxy")) {
    const obj = def.type === "pair" ? def.childForFieldName("value") : null;
    if (obj?.type !== "object") continue;
    for (const pair of obj.namedChildren) {
      if (pair.type !== "pair") continue;
      const prefix = keyOf(pair);
      const val = pair.childForFieldName("value");
      if (!prefix || !val || prefix.startsWith("^")) continue; // a regex key is not a literal prefix
      const segs = sourceSegments(prefix);
      if (!segs) continue;
      let target: string | undefined;
      let rewrite: Node | undefined;
      if (strVal(val) !== undefined) target = strVal(val);
      else if (val.type === "object") {
        const p = pairsOf(val);
        target = strVal(p.get("target"));
        rewrite = p.get("rewrite");
      }
      if (!target) continue;
      const dest = splitUrl(target);
      const literal = segs.filter((s) => s !== "**" && s !== "*");
      // rewrite: (path) => path.replace(/^\/api/, "") strips the prefix for sure; any other rewrite is a guess.
      const strips = rewrite ? new RegExp(`\\^\\\\/${literal.join("\\\\/")}\\/?\\s*,\\s*(["'\`])\\1`).test(rewrite.text) : false;
      out.rules.push({
        source: segs[segs.length - 1] === "**" ? segs : [...segs, "**"],
        toHost: dest.host,
        strip: rewrite ? literal.length : 0,
        prependPath: literalPrefix(dest.path).segs,
        kind: "vite-proxy",
        evidence: evidence(path, lines, pair.startPosition.row + 1),
        confidence: rewrite && !strips ? "likely" : "certain",
      });
    }
  }
  return out;
}

// ── JSON proxies (Create React App, Angular) ──

function lineOfKey(lines: string[], key: string): number {
  const i = lines.findIndex((l) => l.includes(`"${key}"`));
  return i < 0 ? 1 : i + 1;
}

export function readPackageProxy(path: string, content: string): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  let pj: { proxy?: unknown };
  try {
    pj = JSON.parse(content) as { proxy?: unknown };
  } catch {
    return out;
  }
  if (typeof pj.proxy !== "string") return out;
  const lines = content.split("\n");
  const dest = splitUrl(pj.proxy);
  if (!dest.host) return out;
  // The dev server sends every request it has no file for to the proxy.
  out.rules.push({ source: ["**"], toHost: dest.host, strip: 0, prependPath: literalPrefix(dest.path).segs, kind: "cra-proxy", evidence: evidence(path, lines, lineOfKey(lines, "proxy")), confidence: "certain" });
  return out;
}

export function readAngularProxy(path: string, content: string): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  let conf: Record<string, { target?: unknown; pathRewrite?: Record<string, string> }>;
  try {
    conf = JSON.parse(content) as typeof conf;
  } catch {
    return out;
  }
  const lines = content.split("\n");
  for (const [key, v] of Object.entries(conf ?? {})) {
    if (!v || typeof v.target !== "string") continue;
    const segs = sourceSegments(key.replace(/\/\*\*?$/, ""));
    if (!segs) continue;
    const dest = splitUrl(v.target);
    const literal = segs.filter((s) => s !== "**" && s !== "*");
    const rw = Object.entries(v.pathRewrite ?? {});
    const strips = rw.some(([from, to]) => to === "" && from.replace(/^\^\/?/, "").replace(/\/$/, "") === literal.join("/"));
    out.rules.push({
      source: segs[segs.length - 1] === "**" ? segs : [...segs, "**"],
      toHost: dest.host,
      strip: rw.length ? literal.length : 0,
      prependPath: literalPrefix(dest.path).segs,
      kind: "angular-proxy",
      evidence: evidence(path, lines, lineOfKey(lines, key)),
      confidence: rw.length && !strips ? "likely" : "certain",
    });
  }
  return out;
}

// ── nginx ──

interface Tok {
  t: string;
  line: number;
}

function nginxTokens(content: string): Tok[] {
  const out: Tok[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // A Windows line ending first: `.` stops at "\r", which would leave the comment in.
    const l = lines[i].replace(/\r$/, "").replace(/(^|\s)#.*$/, "");
    const re = /"[^"]*"|'[^']*'|[{};]|[^\s{};]+/g;
    for (let m = re.exec(l); m; m = re.exec(l)) out.push({ t: m[0].replace(/^(["'])(.*)\1$/, "$2"), line: i + 1 });
  }
  return out;
}

interface NginxBlock {
  name: string[];
  line: number;
  statements: { words: string[]; line: number }[];
  children: NginxBlock[];
}

function nginxTree(toks: Tok[]): NginxBlock {
  const root: NginxBlock = { name: [], line: 1, statements: [], children: [] };
  const stack = [root];
  let words: Tok[] = [];
  for (const tk of toks) {
    const top = stack[stack.length - 1];
    if (tk.t === ";") {
      if (words.length) top.statements.push({ words: words.map((w) => w.t), line: words[0].line });
      words = [];
    } else if (tk.t === "{") {
      const b: NginxBlock = { name: words.map((w) => w.t), line: words[0]?.line ?? tk.line, statements: [], children: [] };
      top.children.push(b);
      stack.push(b);
      words = [];
    } else if (tk.t === "}") {
      if (stack.length > 1) stack.pop();
      words = [];
    } else words.push(tk);
  }
  return root;
}

export function readNginx(path: string, content: string): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  const lines = content.split("\n");
  const root = nginxTree(nginxTokens(content));
  const upstreams = new Map<string, string>();
  const walk = (b: NginxBlock, f: (b: NginxBlock, vars: Map<string, string>) => void, vars: Map<string, string>) => {
    const mine = new Map(vars);
    for (const s of b.statements) if (s.words[0] === "set" && s.words[1]?.startsWith("$") && s.words[2]) mine.set(s.words[1], s.words[2]);
    f(b, mine);
    for (const c of b.children) walk(c, f, mine);
  };
  walk(
    root,
    (b) => {
      if (b.name[0] !== "upstream" || !b.name[1]) return;
      const server = b.statements.find((s) => s.words[0] === "server" && s.words[1]);
      if (server) upstreams.set(b.name[1].toLowerCase(), server.words[1].toLowerCase());
    },
    new Map(),
  );
  walk(
    root,
    (b, vars) => {
      if (b.name[0] !== "location") return;
      const mod = b.name.length > 2 ? b.name[1] : "";
      const prefix = b.name[b.name.length - 1];
      if (mod === "~" || mod === "~*" || prefix.startsWith("@")) return; // regex and named locations are not literal prefixes
      const pp = b.statements.find((s) => s.words[0] === "proxy_pass" && s.words[1]);
      if (!pp) return;
      const raw = pp.words[1];
      const value = raw.replace(/\$\w+/g, (v) => vars.get(v) ?? v);
      if (value.includes("$")) return; // built at run time
      const dest = splitUrl(value);
      if (!dest.host) return;
      const host = upstreams.get(dest.host.split(":")[0]) ?? dest.host;
      const segs = sourceSegments(prefix);
      if (!segs) return;
      const literal = segs.filter((s) => s !== "**");
      // proxy_pass with a URI (even "/") replaces the matched prefix; without one the path goes as it came.
      const withUri = !/\$/.test(raw) && dest.path !== "";
      out.rules.push({
        source: mod === "=" ? literal : [...literal, "**"],
        toHost: host,
        strip: withUri ? literal.length : 0,
        prependPath: withUri ? literalPrefix(dest.path).segs : [],
        kind: "nginx",
        evidence: evidence(path, lines, pp.line),
        confidence: "certain",
      });
    },
    new Map(),
  );
  // Public addresses: each server block's server_name, and where its proxy_pass sends (when to one place).
  const addresses: DeployAddress[] = [];
  walk(
    root,
    (b, vars) => {
      if (b.name[0] !== "server") return;
      const names = b.statements.filter((s) => s.words[0] === "server_name");
      if (!names.length) return;
      const targets = new Set<string>();
      const visit = (x: NginxBlock, v: Map<string, string>) => {
        const mine = new Map(v);
        for (const s of x.statements) if (s.words[0] === "set" && s.words[1]?.startsWith("$") && s.words[2]) mine.set(s.words[1], s.words[2]);
        for (const s of x.statements) {
          if (s.words[0] !== "proxy_pass" || !s.words[1]) continue;
          const value = s.words[1].replace(/\$\w+/g, (w) => mine.get(w) ?? w);
          const host = value.includes("$") ? undefined : splitUrl(value).host;
          targets.add(host ? (upstreams.get(host.split(":")[0]) ?? host) : "?");
        }
        for (const c of x.children) visit(c, mine);
      };
      visit(b, vars);
      const to = targets.size === 1 && !targets.has("?") ? [...targets][0] : undefined;
      for (const s of names) {
        for (const w of s.words.slice(1)) {
          if (w.startsWith("~") || w.includes("*") || w === "_") continue;
          const host = ownHost(w, false);
          if (host && !addresses.some((a) => a.host === host)) addresses.push({ host, file: path, line: s.line, how: "nginx server_name", ...(to ? { to } : {}) });
        }
      }
    },
    new Map(),
  );
  if (addresses.length) out.addresses = addresses;
  return out;
}

// ── Kubernetes Ingress and Gateway API HTTPRoute ──

function get(m: unknown, key: string): unknown {
  return isMap(m) ? (m as YAMLMap).get(key, true) : undefined;
}
function str(n: unknown): string | undefined {
  return isScalar(n) && n.value !== null && n.value !== undefined ? String(n.value) : undefined;
}
function items(n: unknown): unknown[] {
  return isSeq(n) ? n.items : [];
}

export function readK8sRoutes(path: string, content: string): GatewayRead {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  if (!/^kind\s*:\s*(Ingress|HTTPRoute)\s*$/m.test(content) || content.includes("{{")) return out;
  const lines = content.split("\n");
  const lc = new LineCounter();
  let docs;
  try {
    docs = parseAllDocuments(content, { lineCounter: lc, prettyErrors: false });
  } catch {
    return out;
  }
  if (!Array.isArray(docs)) return out;
  const lineOf = (n: unknown) => {
    const r = (n as YamlNode | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  for (const doc of docs) {
    if (doc.errors.length) continue;
    const root = doc.contents;
    const kind = str(get(root, "kind"));
    const spec = get(root, "spec");
    if (kind === "Ingress") {
      for (const rule of items(get(spec, "rules"))) {
        // The rule's host is a public address of the service its paths go to (when they go to one).
        const hostNode = get(rule, "host");
        const ruleHost = str(hostNode) ? ownHost(str(hostNode)!, false) : null;
        if (ruleHost) {
          const backs = new Set(
            items(get(get(rule, "http"), "paths")).map((p) => {
              const backend = get(p, "backend");
              const name = str(get(get(backend, "service"), "name")) ?? str(get(backend, "serviceName"));
              const port = str(get(get(get(backend, "service"), "port"), "number")) ?? str(get(backend, "servicePort"));
              return name ? (port && /^\d+$/.test(port) ? `${name}:${port}` : name) : "?";
            }),
          );
          const to = backs.size === 1 && !backs.has("?") ? [...backs][0] : undefined;
          (out.addresses ??= []).push({ host: ruleHost, file: path, line: lineOf(hostNode), how: "an Ingress host", ...(to ? { to } : {}) });
        }
        for (const p of items(get(get(rule, "http"), "paths"))) {
          const pathText = str(get(p, "path")) ?? "/";
          const type = str(get(p, "pathType")) ?? "Prefix";
          const backend = get(p, "backend");
          const svc = get(backend, "service");
          const name = str(get(svc, "name")) ?? str(get(backend, "serviceName"));
          const port = str(get(get(svc, "port"), "number")) ?? str(get(backend, "servicePort"));
          const segs = sourceSegments(pathText);
          if (!name || !segs) continue;
          const literal = segs.filter((s) => s !== "**");
          out.rules.push({ source: type === "Exact" ? literal : [...literal, "**"], toHost: port && /^\d+$/.test(port) ? `${name}:${port}` : name, strip: 0, prependPath: [], kind: "ingress", evidence: evidence(path, lines, lineOf(p)), confidence: "certain" });
        }
      }
    } else if (kind === "HTTPRoute") {
      // Its hostnames are public addresses of the service its rules send to (when they send to one).
      const backs = new Set(
        items(get(spec, "rules")).map((rule) => {
          const ref = items(get(rule, "backendRefs"))[0];
          const name = str(get(ref, "name"));
          const port = str(get(ref, "port"));
          return name ? (port ? `${name}:${port}` : name) : "?";
        }),
      );
      const to = backs.size === 1 && !backs.has("?") ? [...backs][0] : undefined;
      for (const h of items(get(spec, "hostnames"))) {
        const host = str(h) ? ownHost(str(h)!, false) : null;
        if (host) (out.addresses ??= []).push({ host, file: path, line: lineOf(h), how: "an HTTPRoute hostname", ...(to ? { to } : {}) });
      }
      for (const rule of items(get(spec, "rules"))) {
        const ref = items(get(rule, "backendRefs"))[0];
        const name = str(get(ref, "name"));
        const port = str(get(ref, "port"));
        if (!name) continue;
        let replace: string | undefined;
        for (const f of items(get(rule, "filters"))) {
          const rp = get(get(get(f, "urlRewrite"), "path"), "replacePrefixMatch");
          if (str(rp) !== undefined) replace = str(rp);
        }
        const matches = items(get(rule, "matches"));
        for (const m of matches.length ? matches : [undefined]) {
          const pm = get(m, "path");
          const value = str(get(pm, "value")) ?? "/";
          const type = str(get(pm, "type")) ?? "PathPrefix";
          const segs = sourceSegments(value);
          if (!segs) continue;
          const literal = segs.filter((s) => s !== "**");
          out.rules.push({
            source: type === "Exact" ? literal : [...literal, "**"],
            toHost: port ? `${name}:${port}` : name,
            strip: replace !== undefined ? literal.length : 0,
            prependPath: replace !== undefined ? literalPrefix(replace).segs : [],
            kind: "httproute",
            evidence: evidence(path, lines, lineOf(m ?? ref)),
            confidence: "certain",
          });
        }
      }
    }
  }
  return out;
}

/** Every gateway rule in the repo. JS configs are parsed with tree-sitter, so this is async. */
export async function extractGateways(files: SourceFile[]): Promise<GatewayRead> {
  const out: GatewayRead = { rules: [], envValues: [], warnings: [] };
  for (const f of files) {
    const k = gatewayKindOf(f.path);
    if (!k) continue;
    let r: GatewayRead | null = null;
    try {
      if (k === "next" || k === "vite") {
        const root = await parseJsSnippet(f.path, f.content);
        if (root) r = k === "next" ? readNextConfig(f.path, f.content, root) : readViteConfig(f.path, f.content, root);
      } else if (k === "cra") r = readPackageProxy(f.path, f.content);
      else if (k === "angular") r = readAngularProxy(f.path, f.content);
      else if (k === "nginx") r = readNginx(f.path, f.content);
      else r = readK8sRoutes(f.path, f.content);
    } catch (e) {
      out.warnings.push(`could not read the rewrites in ${f.path}: ${(e as Error).message}`);
    }
    if (!r) continue;
    out.rules.push(...r.rules);
    out.envValues.push(...r.envValues);
    out.warnings.push(...r.warnings);
    if (r.addresses?.length) (out.addresses ??= []).push(...r.addresses);
  }
  return out;
}
