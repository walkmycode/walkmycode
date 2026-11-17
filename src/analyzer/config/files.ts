// Which config files WalkMyCode reads, and how their secrets are hidden. No
// dependencies (deploy.ts is plain too), so both folder readers (browser and
// CLI) can share it. See docs/SERVICES.md §3.
import type { FileEntry, Lang } from "../types";
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
  // An app's own settings: Spring's application.properties / application.yml, ASP.NET Core's appsettings.json (settings.ts).
  if (/^application(-[\w.-]+)?\.(properties|ya?ml)$/.test(lb) || /^appsettings(\.[\w-]+)?\.json$/.test(lb)) return "settings";
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

/** Code the map draws, by extension: the analyzer's language for it and the language's name. The one list of
 * what the analyzer parses: build.ts maps a file to its language with it and the folder readers keep these files.
 * To draw another language, move its extensions here from READABLE with the same name: maps made before then
 * counted that name in stats.otherCode, and the map offers to map them again (migrate.ts drawnSince). */
export const DRAWN: Readonly<Record<string, { lang: Lang; name: string }>> = {
  ts: { lang: "ts", name: "TypeScript" }, mts: { lang: "ts", name: "TypeScript" }, cts: { lang: "ts", name: "TypeScript" },
  tsx: { lang: "tsx", name: "TypeScript" }, js: { lang: "js", name: "JavaScript" }, mjs: { lang: "js", name: "JavaScript" },
  cjs: { lang: "js", name: "JavaScript" }, jsx: { lang: "jsx", name: "JavaScript" }, py: { lang: "py", name: "Python" },
  sql: { lang: "sql", name: "SQL" }, prisma: { lang: "prisma", name: "Prisma" }, dart: { lang: "dart", name: "Dart" },
  php: { lang: "php", name: "PHP" }, twig: { lang: "twig", name: "Twig" }, rs: { lang: "rust", name: "Rust" },
  c: { lang: "c", name: "C" }, h: { lang: "c", name: "C" }, cc: { lang: "cpp", name: "C++" }, cpp: { lang: "cpp", name: "C++" },
  cxx: { lang: "cpp", name: "C++" }, hpp: { lang: "cpp", name: "C++" }, hh: { lang: "cpp", name: "C++" }, hxx: { lang: "cpp", name: "C++" },
  cs: { lang: "csharp", name: "C#" }, java: { lang: "java", name: "Java" }, kt: { lang: "kotlin", name: "Kotlin" }, kts: { lang: "kotlin", name: "Kotlin" },
};
/** Source in a language the map doesn't draw yet (Go, Ruby, Swift, Scala…). The folder readers keep it,
 * so the guide can list, read and search it ("not on the map"); without this a Rust project was empty to it. */
export const READABLE: Readonly<Record<string, string>> = {
  go: "Go", scala: "Scala", groovy: "Groovy", swift: "Swift",
  fs: "F#", vb: "Visual Basic", rb: "Ruby", ex: "Elixir", exs: "Elixir", erl: "Erlang", hrl: "Erlang",
  hs: "Haskell", clj: "Clojure", cljs: "Clojure", lua: "Lua", pl: "Perl", pm: "Perl", r: "R", jl: "Julia", zig: "Zig",
  nim: "Nim", m: "Objective-C", mm: "Objective-C",
  vue: "Vue", svelte: "Svelte", astro: "Astro", html: "HTML", htm: "HTML", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS",
  sh: "Shell", bash: "Shell", ps1: "PowerShell", graphql: "GraphQL", gql: "GraphQL", sol: "Solidity",
};
/** A path's extension, lower case ("rs" for src/main.rs), or "". */
function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}
const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
/** The analyzer's language for a file the map draws ("rust" for main.rs), or null. */
export function drawnLang(path: string): Lang | null {
  return own(DRAWN, extOf(path))?.lang ?? null;
}
/** Does the map draw this language now? By the name a map counts it under in stats.otherCode ("Rust"). */
export function drawsLanguage(name: string): boolean {
  return Object.values(DRAWN).some((d) => d.name === name);
}
/** The language of a file the map doesn't draw ("Go" for main.go), or null. */
export function readableLanguage(path: string): string | null {
  return own(READABLE, extOf(path)) ?? null;
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
/** A connection string's password: `Server=db;User Id=sa;Password=…;` (ADO.NET, JDBC's `?password=…`). */
const INLINE_PASSWORD = /(\b(?:password|pwd)\s*=\s*)([^;&"'\s]+)/gi;
const hideInline = (s: string) => s.replace(URL_PASSWORD, `$1${REDACTED}@`).replace(INLINE_PASSWORD, `$1${REDACTED}`);

/** A config value as WalkMyCode may show it: secrets become "•••", and a
 * password inside a URL becomes `://user:•••@`. */
export function redactValue(name: string, value: string): string {
  const v = value.trim();
  if (!v) return value;
  // A CI expression (`${{ secrets.VPS_SSH_KEY }}`) names where a secret is kept; it is not the secret.
  if (/^\$\{\{[^}]*\}\}$/.test(v)) return value;
  if (SECRET_NAME.test(name) || SECRET_VALUE.test(v)) return REDACTED;
  return hideInline(value);
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
  return hideInline(line);
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

// ── every other file: listed in Files, read only when it's plain text worth reading ──
// The owner (13 Nov): "whatever file found in the project should be shown in the file structure". Files the map
// doesn't read (README.md, LICENSE, .gitignore, images, fonts, lock files…) are kept as paths, with empty text, the
// way assets are; small text documents are read so they open like code. Never a secret: no real .env, no keys,
// no .npmrc, not even their names.

/** Never listed, not even by name. (.env.example and friends are config, read as config: isConfigPath.) */
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$|dist$)[^/]*)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|crt|cer)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*secrets?\.(json|ya?ml|toml)|\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|[^/]*\.kdbx)$/i;
/** Plain text documents read for Files (their text opens like code): prose, licences and small tool settings that never hold secrets. */
const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)(README|LICEN[CS]E|COPYING|CHANGELOG|CHANGES|CONTRIBUTING|NOTICE|AUTHORS|CODEOWNERS|SECURITY|Makefile|Procfile|Justfile)([.-][^/]*)?$|(^|\/)(\.gitignore|\.gitattributes|\.gitmodules|\.editorconfig|\.dockerignore|\.prettierignore|\.eslintignore|\.nvmrc|\.node-version|\.python-version|\.ruby-version|\.tool-versions|\.prettierrc(\.json|\.ya?ml)?|\.eslintrc(\.json|\.ya?ml)?|\.babelrc|\.browserslistrc|tsconfig[^/]*\.json|jsconfig\.json|rustfmt\.toml|\.rustfmt\.toml|clippy\.toml|rust-toolchain(\.toml)?|biome\.json|deno\.jsonc?|turbo\.json)$/i;
/** Hidden folders never walked, even to list: version control, caches, installs and editors' private state. */
const HIDDEN_NEVER = new Set([".git", ".hg", ".svn", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache", ".venv", ".walkmycode", ".lantern", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".gradle", ".dart_tool", ".pub-cache", ".expo", ".vercel", ".netlify", ".terraform", ".serverless", ".aws", ".ssh", ".gnupg", ".docker", ".kube", ".idea", ".vs", ".history", ".yarn", ".pnpm-store", ".npm"]);

/** Paths of other files listed per repo (not counted in the code limit). */
export const MAX_OTHER = 5000;
/** Documents bigger than this are listed, not read. */
export const DOC_MAX_BYTES = 512_000;

/** A file the readers don't keep as code, config or an asset: "doc" (read its text), "path" (list it only), or null (never: a secret). */
export function otherFileMode(path: string): "doc" | "path" | null {
  if (SECRET_FILE.test(path)) return null;
  return DOC_FILE.test(path) ? "doc" : "path";
}

/** A hidden folder whose files are listed (never read as code): .vscode, .husky, .cargo, .devcontainer… Never .git or a cache. */
export function listsHiddenDir(name: string): boolean {
  return name.startsWith(".") && !HIDDEN_NEVER.has(name.toLowerCase());
}
