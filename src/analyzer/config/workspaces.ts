// Workspaces: the packages a monorepo says it is made of (npm/yarn
// `workspaces`, pnpm-workspace.yaml, lerna.json, Cargo `[workspace]`,
// go.work or several go.mod files, Nx project.json), which of them look like
// apps, and which sibling packages each one depends on. turbo.json and
// nx.json only say "this is a monorepo": the packages come from the files
// above. Also wrangler.toml / wrangler.json: a Cloudflare Worker is a service,
// its `[vars]` are its settings and its `[[services]]` bindings name the
// Workers `env.<BINDING>.fetch()` reaches.
import { isScalar, isSeq, parseDocument } from "yaml";
import { dirOf, joinPath, redactValue, unquote } from "./files";
import type { ConfigFacts, ConfigService } from "./types";

type Ws = ConfigFacts["workspaces"][number];

function base(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** "apps/*" → a matcher for package folders. `**` = any depth, `*` = one segment. */
function globRe(glob: string, root: string): RegExp {
  const g = joinPath(root, glob.replace(/\/+$/, "").replace(/^\.\//, ""));
  const body = g
    .split("/")
    .map((s) => (s === "**" ? "(?:.+)" : s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
    .join("/");
  return new RegExp(`^${body}$`);
}

/** The package folders a list of globs names, among folders holding `manifest`. */
function expand(globs: string[], root: string, dirsWith: Set<string>): string[] {
  const inc = globs.filter((g) => !g.startsWith("!")).map((g) => globRe(g, root));
  const exc = globs.filter((g) => g.startsWith("!")).map((g) => globRe(g.slice(1), root));
  return [...dirsWith].filter((d) => d !== root && inc.some((re) => re.test(d)) && !exc.some((re) => re.test(d))).sort();
}

/** apps/* and services/* look like apps, packages/* and libs/* like libraries; anything else, no hint. */
export function appHintOf(dir: string): boolean | undefined {
  if (/(^|\/)(apps|services)\/[^/]+$/.test(dir)) return true;
  if (/(^|\/)(packages|libs|lib|crates|modules)\/[^/]+$/.test(dir)) return false;
  return undefined;
}

/** Nx says app or library outright (projectType, or a type:app / type:lib tag); else the folder decides. */
function nxAppHint(pj: Record<string, unknown>, dir: string): boolean | undefined {
  const tags = strings(pj.tags);
  const type = typeof pj.projectType === "string" ? pj.projectType : undefined;
  return type === "application" ? true : type === "library" ? false : tags.includes("type:app") ? true : tags.includes("type:lib") ? false : appHintOf(dir);
}

function lineOf(content: string, re: RegExp): number {
  const i = content.split("\n").findIndex((l) => re.test(l));
  return i < 0 ? 1 : i + 1;
}

function jsonOf(content: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(content.replace(/^\s*\/\/[^\n]*$/gm, "")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function npmPackage(dir: string, byPath: Map<string, string>): Ws {
  const file = dir ? `${dir}/package.json` : "package.json";
  const content = byPath.get(file) ?? "";
  const pj = jsonOf(content) ?? {};
  const deps = new Set<string>();
  for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const d = pj[k];
    if (d && typeof d === "object") for (const n of Object.keys(d)) deps.add(n);
  }
  // Nx can live in package.json too: an `nx` key with projectType, tags and implicitDependencies.
  const nx = pj.nx && typeof pj.nx === "object" ? (pj.nx as Record<string, unknown>) : undefined;
  for (const d of strings(nx?.implicitDependencies)) if (!d.startsWith("!")) deps.add(d);
  const ws: Ws = { dir, deps: [...deps], file, line: lineOf(content, /^\s*"name"\s*:/) };
  if (typeof pj.name === "string") ws.name = pj.name;
  const hint = nx ? nxAppHint(nx, dir) : appHintOf(dir);
  if (hint !== undefined) ws.isApp = hint;
  return ws;
}

/** `[section]` → { key: raw value } for the simple TOML WalkMyCode needs. Arrays may span lines. */
function tomlSections(content: string): { name: string; line: number; kv: Map<string, { value: string; line: number }> }[] {
  const out: { name: string; line: number; kv: Map<string, { value: string; line: number }> }[] = [{ name: "", line: 1, kv: new Map() }];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, "").replace(/(^|\s)#.*$/, "");
    const sec = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(l);
    if (sec) {
      out.push({ name: sec[1], line: i + 1, kv: new Map() });
      continue;
    }
    const kv = /^\s*([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(l);
    if (!kv) continue;
    let value = kv[2].trim();
    const start = i;
    // A multi-line array: read on to the closing bracket.
    if (value.startsWith("[") && !value.includes("]")) {
      while (i + 1 < lines.length && !value.includes("]")) value += " " + lines[++i].replace(/(^|\s)#.*$/, "").trim();
    }
    out[out.length - 1].kv.set(unquote(kv[1]), { value, line: start + 1 });
  }
  return out;
}

function tomlStrings(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
}

export function readWorkspaces(files: { path: string; content: string }[]): { workspaces: ConfigFacts["workspaces"]; warnings: string[] } {
  const warnings: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const dirsWith = (name: string) => new Set(files.filter((f) => base(f.path) === name).map((f) => dirOf(f.path)));
  const out = new Map<string, Ws>();
  const put = (ws: Ws) => {
    const had = out.get(ws.dir);
    if (!had) out.set(ws.dir, ws);
    else {
      had.name ??= ws.name;
      had.isApp ??= ws.isApp;
      for (const d of ws.deps) if (!had.deps.includes(d)) had.deps.push(d);
    }
  };

  // npm / yarn / bun workspaces, lerna, pnpm: package.json folders.
  const npmDirs = dirsWith("package.json");
  for (const f of files) {
    const b = base(f.path);
    const root = dirOf(f.path);
    let globs: string[] = [];
    if (b === "package.json") {
      const pj = jsonOf(f.content);
      const w = pj?.workspaces;
      globs = Array.isArray(w) ? strings(w) : w && typeof w === "object" ? strings((w as { packages?: unknown }).packages) : [];
    } else if (b === "lerna.json") globs = strings(jsonOf(f.content)?.packages);
    else if (b === "pnpm-workspace.yaml") {
      const doc = parseDocument(f.content, { prettyErrors: false });
      const pk = doc.errors.length ? undefined : (doc.contents as { get?: (k: string) => unknown } | null)?.get?.("packages");
      if (isSeq(pk)) globs = pk.items.map((x) => (isScalar(x) ? String(x.value) : "")).filter(Boolean);
    }
    for (const d of expand(globs, root, npmDirs)) put(npmPackage(d, byPath));
  }

  // Cargo [workspace] members.
  const cargoDirs = dirsWith("Cargo.toml");
  for (const f of files) {
    if (base(f.path) !== "Cargo.toml") continue;
    const ws = tomlSections(f.content).find((s) => s.name === "workspace");
    if (!ws) continue;
    for (const d of expand(tomlStrings(ws.kv.get("members")?.value), dirOf(f.path), cargoDirs)) {
      const file = `${d}/Cargo.toml`;
      const secs = tomlSections(byPath.get(file) ?? "");
      const pkg = secs.find((s) => s.name === "package");
      const deps = secs.filter((s) => /(^|\.)(dev-|build-)?dependencies$/.test(s.name)).flatMap((s) => [...s.kv.keys()].map((k) => k.split(".")[0]));
      const entry: Ws = { dir: d, deps: [...new Set(deps)], file, line: pkg?.kv.get("name")?.line ?? 1 };
      const name = unquote(pkg?.kv.get("name")?.value ?? "");
      if (name) entry.name = name;
      const hint = appHintOf(d);
      if (hint !== undefined) entry.isApp = hint;
      put(entry);
    }
  }

  // Go: go.work `use`, else two or more go.mod files.
  const goDirs = dirsWith("go.mod");
  const goWork = files.filter((f) => base(f.path) === "go.work");
  const goUse = new Set<string>();
  for (const f of goWork) {
    const body = f.content.replace(/\/\/[^\n]*/g, "");
    for (const m of body.matchAll(/\buse\s*\(([^)]*)\)|\buse\s+(\S+)/g)) {
      for (const d of (m[1] ?? m[2]).split(/\s+/).filter(Boolean)) goUse.add(joinPath(dirOf(f.path), d));
    }
  }
  const goPkgs = goWork.length ? [...goUse].filter((d) => goDirs.has(d)) : goDirs.size >= 2 ? [...goDirs] : [];
  for (const d of goPkgs.sort()) {
    const file = d ? `${d}/go.mod` : "go.mod";
    const content = byPath.get(file) ?? "";
    const mod = /^\s*module\s+(\S+)/m.exec(content)?.[1];
    const deps = [...content.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/\S+)\s+v\S+/gim)].map((m) => m[1]);
    const entry: Ws = { dir: d, deps, file, line: lineOf(content, /^\s*module\s/) };
    if (mod) entry.name = mod;
    const hint = appHintOf(d);
    if (hint !== undefined) entry.isApp = hint;
    put(entry);
  }

  // Nx project.json: projectType says app or library outright.
  for (const f of files) {
    if (base(f.path) !== "project.json") continue;
    const pj = jsonOf(f.content);
    if (!pj) {
      warnings.push(`could not read ${f.path}`);
      continue;
    }
    const d = dirOf(f.path);
    const entry: Ws = { dir: d, deps: strings(pj.implicitDependencies).filter((x) => !x.startsWith("!")), file: f.path, line: lineOf(f.content, /"(name|projectType)"\s*:/) };
    if (typeof pj.name === "string") entry.name = pj.name;
    const isApp = nxAppHint(pj, d);
    if (isApp !== undefined) entry.isApp = isApp;
    // An Nx project inside an npm workspace keeps its package.json dependencies too.
    if (npmDirs.has(d)) for (const x of npmPackage(d, byPath).deps) if (!entry.deps.includes(x)) entry.deps.push(x);
    put(entry);
    // What Nx says outranks the folder-name hint an npm workspace entry already gave it.
    if (isApp !== undefined) out.get(d)!.isApp = isApp;
  }

  return { workspaces: [...out.values()], warnings };
}

// ── wrangler ──

export interface WranglerRead {
  service?: ConfigService;
  envValues: ConfigFacts["envValues"];
  bindings: ConfigFacts["bindings"];
}

export function readWrangler(path: string, content: string): WranglerRead {
  const out: WranglerRead = { envValues: [], bindings: [] };
  const dir = dirOf(path);
  let name: string | undefined;
  let nameLine = 1;
  let main: { value: string; line: number } | undefined;
  const vars: { name: string; value: string; line: number }[] = [];
  if (/\.jsonc?$/i.test(path)) {
    const j = jsonOf(content.replace(/\/\*[\s\S]*?\*\//g, ""));
    if (!j) return out;
    if (typeof j.name === "string") {
      name = j.name;
      nameLine = lineOf(content, /"name"\s*:/);
    }
    if (typeof j.main === "string") main = { value: j.main, line: lineOf(content, /"main"\s*:/) };
    const v = j.vars;
    if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) if (typeof val === "string") vars.push({ name: k, value: val, line: lineOf(content, new RegExp(`"${k}"\\s*:`)) });
    if (Array.isArray(j.services)) {
      for (const s of j.services as { binding?: unknown; service?: unknown }[]) {
        if (typeof s?.binding === "string" && typeof s.service === "string") out.bindings.push({ binding: s.binding, service: s.service, file: path, line: lineOf(content, new RegExp(`"${s.binding}"`)) });
      }
    }
  } else {
    const secs = tomlSections(content);
    const top = secs[0];
    const n = top.kv.get("name");
    if (n) {
      name = unquote(n.value);
      nameLine = n.line;
    }
    const m = top.kv.get("main");
    if (m) main = { value: unquote(m.value), line: m.line };
    for (const s of secs) {
      if (s.name === "vars") for (const [k, v] of s.kv) vars.push({ name: k, value: unquote(v.value), line: v.line });
      if (s.name === "services") {
        const b = s.kv.get("binding");
        const t = s.kv.get("service");
        if (b && t) out.bindings.push({ binding: unquote(b.value), service: unquote(t.value), file: path, line: b.line });
      }
    }
  }
  if (!name) return out;
  const env: ConfigService["env"] = {};
  for (const v of vars) {
    env[v.name] = { value: redactValue(v.name, v.value), line: v.line };
    out.envValues.push({ name: v.name, value: redactValue(v.name, v.value), file: path, line: v.line, scope: name });
  }
  for (const b of out.bindings) b.scope = name;
  out.service = {
    name,
    kind: "app",
    dir,
    hostnames: [],
    ports: [],
    env,
    envFiles: [],
    dependsOn: [],
    ...(main ? { entry: `wrangler: ${main.value}`, entryLine: main.line, entryFile: path } : {}),
    framework: /pages_build_output_dir/.test(content) ? "Cloudflare Pages" : "Cloudflare Workers",
    file: path,
    line: nameLine,
    source: "wrangler",
  };
  return out;
}
