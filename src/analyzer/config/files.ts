// Which config files WalkMyCode reads, and how their secrets are hidden. No
// dependencies (deploy.ts is plain too), so both folder readers (browser and
// CLI) can share it. See docs/SERVICES.md §3.
import type { FileEntry } from "../types";
import { CI_RE, deployKindOf, isDeployPath } from "./deploy";

export type ConfigKind = NonNullable<FileEntry["configKind"]>;

/** The only .env files ever read: templates meant to be committed. */
export const ENV_EXAMPLE_RE = /(^|\/)\.env\.(example|sample|template|dist)$/i;

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|sql|prisma)$/i;
const YAML = /\.ya?ml$/i;
/** Folders where plain Kubernetes / Helm YAML usually lives. */
const K8S_DIR = /(^|\/)(k8s|kube|kubernetes|manifests?|deploy|deployments?|helm|charts?|kustomize|overlays|infra|ops)(\/|$)/i;

function base(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Folder of a repo-relative path ("" at the root). */
export function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** `joinPath("web", "../api/./x")` → "api/x". Never climbs above the repo root. */
export function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir.split("/") : []).filter(Boolean);
  for (const seg of rel.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The config kind a path names, from the file name alone. `k8s` is only a
 * candidate here: the content decides (`configKindOf`). */
export function configKindOfPath(path: string): ConfigKind | null {
  const b = base(path);
  const lb = b.toLowerCase();
  if (ENV_EXAMPLE_RE.test(path)) return "envfile";
  if (/^(docker-)?compose([.-][^/]*)?\.ya?ml$/.test(lb)) return "compose";
  if (/^dockerfile(\..+)?$/.test(lb) || lb.endsWith(".dockerfile")) return "dockerfile";
  if (lb.endsWith(".proto")) return "proto";
  if (/^(next|vite|nuxt)\.config\.[cm]?[jt]s$/.test(lb) || lb === "proxy.conf.json") return "gateway";
  if (/^nginx.*\.conf$/.test(lb) || /(^|\/)conf\.d\/[^/]+\.conf$/i.test(path) || /(^|\/)sites-(available|enabled)\/[^/]+$/i.test(path)) return "gateway";
  if (/^(openapi|swagger)\.(json|ya?ml)$/.test(lb) || lb === "api-docs.json" || /(^|\/)openapi\/.+\.(json|ya?ml)$/i.test(path)) return "openapi";
  if (/^asyncapi\.(json|ya?ml)$/.test(lb)) return "asyncapi";
  if (/^wrangler\.(toml|json|jsonc)$/.test(lb)) return "wrangler";
  if (/^(catalog-info|compass)\.ya?ml$/.test(lb) || lb === "workspace.dsl") return "declared";
  if (/^(pnpm-workspace\.yaml|turbo\.json|nx\.json|project\.json|go\.work|lerna\.json)$/.test(lb)) return "workspace";
  if (/^chart\.ya?ml$/.test(lb) || /^values([.-][^/]*)?\.ya?ml$/.test(lb)) return "helm";
  if (/^kustomization\.ya?ml$/.test(lb)) return "k8s";
  if (YAML.test(lb) && K8S_DIR.test(path)) return "k8s";
  // CI workflows, Caddyfile, fly.toml, render.yaml, app.yaml, vercel.json, CNAME: only read when they name a public address.
  if (isDeployPath(path)) return "deploy";
  return null;
}

/** The config kind of a file once its content is known, or null when it is
 * not a config file WalkMyCode reads (a YAML file that is not Kubernetes, say). */
export function configKindOf(path: string, content: string): ConfigKind | null {
  const k = configKindOfPath(path);
  if (k === "deploy") return deployKindOf(path, content) ? "deploy" : null;
  if (k !== "k8s" || /^kustomization\.ya?ml$/i.test(base(path))) return k;
  // Plain YAML: Kubernetes only with apiVersion + kind; a Helm template when it has {{ }} or sits in templates/.
  // Not Kubernetes, it may still be a deploy file kept in a deploy/ folder (render.yaml, app.yaml).
  if (!/^apiVersion\s*:/m.test(content) || !/^kind\s*:/m.test(content)) return isDeployPath(path) && deployKindOf(path, content) ? "deploy" : null;
  return content.includes("{{") || /(^|\/)templates\//.test(path) ? "helm" : "k8s";
}

/** Is this path a config file the folder readers should keep? (Name only.) */
export function isConfigPath(path: string): boolean {
  return configKindOfPath(path) !== null;
}

/** Source in a language the map doesn't draw yet (Rust, Go, Java, C#, Ruby…). The folder readers keep it,
 * so the guide can list, read and search it ("not on the map"); without this a Rust project was empty to it. */
const READABLE: Record<string, string> = {
  rs: "Rust", go: "Go", java: "Java", kt: "Kotlin", kts: "Kotlin", scala: "Scala", groovy: "Groovy", swift: "Swift",
  cs: "C#", fs: "F#", vb: "Visual Basic", rb: "Ruby", ex: "Elixir", exs: "Elixir", erl: "Erlang", hrl: "Erlang",
  hs: "Haskell", clj: "Clojure", cljs: "Clojure", lua: "Lua", pl: "Perl", pm: "Perl", r: "R", jl: "Julia", zig: "Zig",
  nim: "Nim", c: "C", h: "C", cc: "C++", cpp: "C++", cxx: "C++", hpp: "C++", hh: "C++", m: "Objective-C", mm: "Objective-C",
  vue: "Vue", svelte: "Svelte", astro: "Astro", html: "HTML", htm: "HTML", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS",
  sh: "Shell", bash: "Shell", ps1: "PowerShell", graphql: "GraphQL", gql: "GraphQL", sol: "Solidity",
};
/** The language of a file the map doesn't draw ("Rust" for main.rs), or null. */
export function readableLanguage(path: string): string | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return (m && READABLE[m[1].toLowerCase()]) || null;
}
export function isReadablePath(path: string): boolean {
  return readableLanguage(path) !== null;
}

/** A file an app serves as it is (Next.js and Vite `public/`, SvelteKit `static/`). The folder
 * readers keep its path with no content, so a request for it is known for a file, not an API call. */
const ASSET_RE = /(^|\/)(public|static)\/(?:[^/]+\/)*[^/]+\.(json|txt|xml|svg|png|jpe?g|gif|webp|avif|ico|webmanifest|css|html?|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|pdf|csv|map|wasm|md)$/i;
export function isAssetPath(path: string): boolean {
  return ASSET_RE.test(path) && !isConfigPath(path);
}
/** At most this many asset paths per folder, apart from the code files' own limit. */
export const MAX_ASSETS = 2000;

/** The map language of a config file: code files (next.config.js) keep their own. */
export function configLangOf(path: string, content: string): "config" | "proto" | null {
  if (CODE_EXT.test(path)) return null;
  const k = configKindOf(path, content);
  if (!k) return null;
  return k === "proto" ? "proto" : "config";
}

// ── secrets ──

export const REDACTED = "•••";
const SECRET_NAME = /(SECRET|TOKEN|KEY|PASSWORD|PASS|PWD|PRIVATE)/i;
const SECRET_VALUE = /^(sk|pk|rk|ghp|xox|AKIA)[A-Za-z0-9_-]{8,}|^[A-Fa-f0-9]{32,}$|^[A-Za-z0-9_-]{40,}$/;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:)([^\s@/'"]+)@/gi;

/** A config value as WalkMyCode may show it: secrets become "•••", and a
 * password inside a URL becomes `://user:•••@`. */
export function redactValue(name: string, value: string): string {
  const v = value.trim();
  if (!v) return value;
  // A CI expression (`${{ secrets.VPS_SSH_KEY }}`) names where a secret is kept; it is not the secret.
  if (/^\$\{\{[^}]*\}\}$/.test(v)) return value;
  if (SECRET_NAME.test(name) || SECRET_VALUE.test(v)) return REDACTED;
  return value.replace(URL_PASSWORD, `$1${REDACTED}@`);
}

/** One line of a config file with any secret values hidden; line count and
 * the shape of the line are kept so file:line evidence still points right. */
function redactLine(line: string): string {
  // Dockerfile ENV / ARG with pairs: ENV A=1 B="two", ARG NPM_TOKEN=abc
  const env = /^(\s*(?:ENV|ARG)\s+)(.*)$/i.exec(line);
  if (env && /^\w+=/.test(env[2])) {
    return env[1] + env[2].replace(/(\w+)=("[^"]*"|'[^']*'|\S+)/g, (_, k: string, v: string) => `${k}=${quoted(v, redactValue(k, unquote(v)))}`);
  }
  if (env) {
    const m = /^(\w+)(\s+)(.+)$/.exec(env[2]);
    if (m) return `${env[1]}${m[1]}${m[2]}${quoted(m[3], redactValue(m[1], unquote(m[3])))}`;
  }
  // KEY=value, - KEY=value, export KEY=value, key: value, "key": "value"
  const kv = /^(\s*(?:-\s+)?(?:export\s+)?["']?)([A-Za-z_][\w.-]*)(["']?\s*(?:=|:(?=\s))\s*)(.*?)(\s*,?\s*)$/.exec(line);
  if (kv && kv[4] && !/^[|>{[&*!]/.test(kv[4])) {
    const [, pre, key, sep, raw, post] = kv;
    const { value, comment } = splitComment(raw);
    const shown = redactValue(key, unquote(value));
    if (shown !== unquote(value)) return `${pre}${key}${sep}${quoted(value, shown)}${comment}${post}`;
  }
  return line.replace(URL_PASSWORD, `$1${REDACTED}@`);
}

function splitComment(raw: string): { value: string; comment: string } {
  if (/^["']/.test(raw)) return { value: raw, comment: "" };
  const i = raw.search(/\s#/);
  return i < 0 ? { value: raw, comment: "" } : { value: raw.slice(0, i), comment: raw.slice(i) };
}

export function unquote(v: string): string {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
}

function quoted(original: string, shown: string): string {
  const t = original.trim();
  const q = /^["']/.test(t) ? t[0] : "";
  return shown === unquote(t) ? original : `${q}${shown}${q}`;
}

/** In a CI script a key can sit anywhere on a line (`curl -H "Authorization: Bearer ghp_…"`): anything that looks like one. */
const INLINE_KEY = /\b(?:(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|glpat|xox[abposr]|AKIA)[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{40,}|[A-Za-z0-9_-]{48,})\b/g;
const INLINE_AUTH = /\b(Bearer|Basic|token)(\s+)(?![$•])([A-Za-z0-9._~+/=-]{12,})/g;
function redactInline(line: string): string {
  return line.replace(INLINE_AUTH, `$1$2${REDACTED}`).replace(INLINE_KEY, REDACTED);
}

/** A whole config file with its secrets hidden, line for line. With its path, a CI workflow's
 * scripts also lose anything that looks like a key (a `${{ secrets.X }}` reference stays). */
export function redactConfigText(content: string, path?: string): string {
  const ci = !!path && CI_RE.test(path);
  const lines = content.split("\n").map((l) => {
    const cr = l.endsWith("\r");
    let r = redactLine(cr ? l.slice(0, -1) : l);
    if (ci) r = redactInline(r);
    return cr ? `${r}\r` : r;
  });
  return redactK8sSecrets(lines).join("\n");
}

/** Every value under `data:` / `stringData:` of a Kubernetes `kind: Secret`
 * document is hidden, whatever its key is called: a short base64 value under
 * `username:` is still a secret. */
function redactK8sSecrets(lines: string[]): string[] {
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && !/^---\s*\r?$/.test(lines[i])) continue;
    if (lines.slice(start, i).some((l) => /^kind:\s*["']?Secret["']?\s*\r?$/.test(l))) {
      let blockIndent = -1;
      for (let j = start; j < i; j++) {
        const indent = lines[j].search(/\S/);
        if (indent < 0) continue;
        if (blockIndent >= 0 && indent <= blockIndent) blockIndent = -1;
        if (blockIndent < 0) {
          if (/^\s*(data|stringData):\s*\r?$/.test(lines[j])) blockIndent = indent;
          continue;
        }
        lines[j] = lines[j].replace(/^(\s*["']?[^:\s"']+["']?:\s*)(\S.*?)(\r?)$/, (_, key: string, v: string, cr: string) => (/^[|>]/.test(v) ? `${key}${v}${cr}` : `${key}${REDACTED}${cr}`)).replace(/^(\s+)(?![^:]*:\s)(\S.*?)(\r?)$/, `$1${REDACTED}$3`);
      }
    }
    start = i + 1;
  }
  return lines;
}

/** What the browser and the CLI keep of a file: config files redacted, code as it is.
 * Judged by name, so a YAML file kept only to be classified (deploy/vars.yml that
 * turns out not to be Kubernetes) is redacted too. */
export function redactSource(path: string, content: string): string {
  return !CODE_EXT.test(path) && (isConfigPath(path) || configLangOf(path, content)) ? redactConfigText(content, path) : content;
}
