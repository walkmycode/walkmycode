// Where a deployed service answers on the internet, as its own repo's deploy
// config says (docs/SERVICES.md §13, "Whose address is this?"): a CI step that
// health-checks https://api.example.com after deploying, a deployment URL, a
// Caddy site, a Traefik Host() rule on a compose service, fly.toml's app,
// render.yaml / app.yaml domains, vercel.json's alias, a CNAME file. nginx
// server_name and Ingress / HTTPRoute hosts are read with the rewrites
// (gateway.ts); Traefik labels and render.yaml / app.yaml in hosting.ts. Only
// config counts: never a README, a comment or a docstring. build.ts decides
// whose address each one is. No YAML parser here: the folder readers use it.
import { serviceForHost } from "../extract/common";

/** A public address a deploy file gives a service. */
export interface DeployAddress {
  /** "api.example.com": lower case, with the port when one is given (and is not 80 or 443). */
  host: string;
  file: string;
  line: number;
  /** What says it, in words: "a health check after deploying", "a Caddy site". */
  how: string;
  /** Where the address leads, when the config says: a compose service (Traefik), a backend service or
   * upstream host:port (Caddy, nginx, Ingress, HTTPRoute), a service name (render.yaml, app.yaml). */
  to?: string;
  /** The folder it belongs to, when the config says: a CI step's working-directory or `cd`, render.yaml's
   * rootDir, the folder of fly.toml / vercel.json / CNAME. */
  dir?: string;
}

/** GitHub Actions workflows and GitLab CI: kept by the folder readers although they are hidden. */
export const CI_RE = /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml)$/i;

/** "https://API.example.com:443/x" → "api.example.com"; null for a local, private, templated or wildcard name. */
export function publicHost(raw: string): string | null {
  let s = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.split(/[/?#\s"'`,;)\]}]/)[0].replace(/^[^@]*@/, "").toLowerCase().replace(/\.$/, "");
  s = s.replace(/:(80|443)$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(s)) return null;
  const bare = s.replace(/:\d+$/, "");
  if (/^(127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(bare)) return null;
  if (/(^|\.)(localhost|local|internal|svc|cluster\.local|test|invalid)$/.test(bare)) return null;
  const tld = bare.slice(bare.lastIndexOf(".") + 1);
  if (/^\d+$/.test(tld) ? !/^\d+\.\d+\.\d+\.\d+$/.test(bare) : !/^[a-z]{2,}$/.test(tld)) return null;
  return s;
}

/** Hosts a CI job reaches for tools, packages, notifications and the CI's own APIs: never the app's own address. */
const CI_TOOLING =
  /(^|\.)(github\.com|githubusercontent\.com|github\.io|ghcr\.io|docker\.com|docker\.io|npmjs\.org|npmjs\.com|yarnpkg\.com|pypi\.org|pythonhosted\.org|nodesource\.com|rustup\.rs|rust-lang\.org|golang\.org|go\.dev|deno\.land|bun\.sh|pnpm\.io|codecov\.io|gitlab\.com|bitbucket\.org|slack\.com|discord\.com|discordapp\.com|telegram\.org|amazonaws\.com|googleapis\.com|google\.com|microsoft\.com|azure\.com|sentry\.io|cloudflare\.com|vercel\.com|netlify\.com|heroku\.com|fly\.io|render\.com|digitalocean\.com|jfrog\.io|sonarcloud\.io|snyk\.io|atlassian\.net|ubuntu\.com|debian\.org|alpinelinux\.org|apache\.org|maven\.org|gradle\.org|nuget\.org|rubygems\.org|packagist\.org|jsdelivr\.net|unpkg\.com|cloudfront\.net|hashicorp\.com|releases\.hashicorp\.com|k8s\.io|kubernetes\.io|helm\.sh)$/;

/** A host a deploy file may give a service: public, and not a company WalkMyCode knows. */
export function ownHost(raw: string, ci: boolean): string | null {
  const h = publicHost(raw);
  if (!h || serviceForHost(h.replace(/:\d+$/, ""))) return null;
  if (ci && CI_TOOLING.test(h.replace(/:\d+$/, ""))) return null;
  return h;
}

/** A line without its comment ("# …" at the start, or after a space outside quotes). */
function code(line: string): string {
  const t = line.replace(/\r$/, "");
  if (/^\s*#/.test(t)) return "";
  let q: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && i > 0 && /\s/.test(t[i - 1])) return t.slice(0, i);
  }
  return t;
}

const URL_RE = /\bhttps?:\/\/[^\s"'`<>|;)\\]+/gi;
/** Health checks by path: the root, /health, /status, /ping, /ready, /version … */
const CHECK_PATH = /^\/?$|^\/(api\/)?(_?health(z|check)?|status|ping|ready(z)?|live(z)?|alive|version|up)(\/|$|\?)/i;
const CHECK_WORDS = /health|smoke|\bcheck|verify|status|\bping|ready|alive|uptime|reachab|wait.*\b(up|ready)\b/i;

/** Does this curl/wget command check a deployed address (rather than download, install or notify)? */
function isCheck(cmd: string, url: string, context: string): boolean {
  // Downloads, installers, uploads and webhooks.
  if (/\|\s*(sudo\s+)?(sh|bash|zsh|ash|dash|python3?|node|tar|gunzip|unzip|apt-key|gpg|tee|sudo)\b/.test(cmd)) return false;
  if (/\s(-o|--output)\s+(?!\/dev\/null\b)\S/.test(cmd) || /\s(-O|--remote-name)(\s|$)/.test(cmd)) return false;
  if (/\s(-X|--request)\s*["']?(POST|PUT|PATCH|DELETE)\b/i.test(cmd) || /\s(-d|--data[\w-]*|-F|--form|-T|--upload-file|--json)(\s|=|$)/.test(cmd)) return false;
  const path = url.replace(/^https?:\/\/[^/?#]+/i, "");
  if (/\/[^/?#]+\.[a-z0-9]{1,10}([?#].*)?$/i.test(path)) return false; // a file: install.sh, app.tar.gz
  const isWget = /\bwget\b/.test(cmd) && !/\bcurl\b/.test(cmd);
  if (isWget && !/--spider|\s-q?O\s*(-|\/dev\/null)(\s|$)|-qO-|\|\s*grep\b/.test(cmd)) return false; // wget saves the page: a download
  return (
    /\scurl\b.*\s-[a-zA-Z]*[fI][a-zA-Z]*(\s|$)|--fail|--head|--retry|\s-w\s|--write-out|%\{http_code\}|--spider/.test(` ${cmd}`) ||
    /\|\s*grep\b/.test(cmd) ||
    CHECK_PATH.test(path) ||
    CHECK_WORDS.test(context)
  );
}

/** A folder given to a CI step (`working-directory:`, `cd web`): repo-relative, or undefined (the root, a home or absolute path). */
export function relDir(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!d || d === "." || /^[~/$]|\$\{|\.\./.test(d)) return undefined;
  return d;
}

/** GitHub Actions / GitLab CI: health checks after a deploy, deployment URLs, health-check actions. */
export function ciAddresses(path: string, content: string): DeployAddress[] {
  const lines = content.split("\n");
  const out: DeployAddress[] = [];
  // A step's folder is relative to the repo the workflow is in (its root is where .github/ or .gitlab-ci.yml is).
  const root = path.replace(CI_RE, "");
  const indent = (l: string) => l.search(/\S/);
  /** The step (GitHub) or job (GitLab) a line is in: from the closest line that starts one. */
  const blockStart = (i: number): number => {
    for (let j = i; j >= 0; j--) {
      if (/^\s*-\s+(name|uses|run|id|if|with|env|working-directory|shell)\s*:/.test(lines[j]) || /^[A-Za-z0-9_.-]+\s*:\s*$/.test(lines[j])) return j;
    }
    return 0;
  };
  const dirAt = (i: number): string | undefined => {
    const s = blockStart(i);
    let dir: string | undefined;
    for (let j = s; j <= i; j++) {
      const wd = /^\s*(?:-\s+)?working-directory\s*:\s*(\S+)/.exec(code(lines[j]));
      if (wd) dir = relDir(wd[1]);
      for (const m of code(lines[j]).matchAll(/(?:^|[\s;&|(])cd\s+([^\s;&|)]+)/g)) dir = relDir(m[1]) ?? dir;
    }
    return dir && root ? `${root}/${dir}` : dir;
  };
  /** The step's name and the comments just above a line: what the step says it does. */
  const contextAt = (i: number): string => {
    const s = blockStart(i);
    const name = /^\s*-?\s*name\s*:\s*(.+)$/.exec(lines[s])?.[1] ?? "";
    const above = lines.slice(Math.max(s, i - 4), i).filter((l) => /^\s*#/.test(l));
    return [name, ...above].join(" ");
  };
  const push = (raw: string, line: number, how: string, dir?: string) => {
    const host = ownHost(raw, true);
    if (host && !out.some((a) => a.host === host && a.line === line)) out.push({ host, file: path, line, how, ...(dir ? { dir } : {}) });
  };
  for (let i = 0; i < lines.length; i++) {
    const text = code(lines[i]);
    if (!text.trim()) continue;
    // curl / wget, with the lines a trailing backslash carries it onto
    if (/(^|[\s;&|(`$])(curl|wget)\s/.test(text)) {
      const parts = [text];
      for (let j = i; /\\\s*$/.test(lines[j]) && j + 1 < lines.length && j - i < 8; j++) parts.push(code(lines[j + 1]));
      const cmd = parts.map((p) => p.replace(/\\\s*$/, " ")).join(" ");
      for (const [k, part] of parts.entries()) {
        for (const m of part.matchAll(URL_RE)) if (isCheck(cmd, m[0], contextAt(i))) push(m[0], i + k + 1, "a health check after deploying", dirAt(i));
      }
      continue;
    }
    // environment: { url: https://… } or environment:\n  url: https://… — where the deploy says the app answers
    const inline = /^\s*environment\s*:\s*\{[^}]*\burl\s*:\s*["']?(https?:\/\/[^\s"',}]+)/.exec(text);
    if (inline) push(inline[1], i + 1, "the deployment's URL");
    const url = /^(\s*)urls?\s*:\s*["']?(https?:\/\/[^\s"',]+)/.exec(text);
    if (url) {
      const own = indent(lines[i]);
      let parent = "";
      for (let j = i - 1; j >= 0; j--) {
        if (!lines[j].trim() || /^\s*#/.test(lines[j])) continue;
        if (indent(lines[j]) < own) {
          parent = lines[j];
          break;
        }
      }
      if (/^\s*(-\s+)?environment\s*:\s*$/.test(parent)) push(url[2], i + 1, "the deployment's URL");
      else if (/^\s*(-\s+)?with\s*:\s*$/.test(parent)) {
        // a health-check action: `uses: jtalk/url-health-check-action@v4` with `url:`
        const s = blockStart(i);
        const uses = lines.slice(s, i).map((l) => /^\s*-?\s*uses\s*:\s*(\S+)/.exec(l)?.[1]).find(Boolean);
        if (uses && /health|uptime|smoke|url-check|wait-for|availability|ping/i.test(uses)) push(url[2], i + 1, "a health check after deploying", dirAt(i));
      }
    }
  }
  return out;
}

/** Caddyfile: site blocks (`api.example.com {`) and the upstream their reverse_proxy sends to. */
export function caddyAddresses(path: string, content: string): DeployAddress[] {
  const lines = content.split("\n");
  const out: DeployAddress[] = [];
  let depth = 0;
  let site: { hosts: { host: string; line: number }[]; to: Set<string> } | null = null;
  const flush = () => {
    if (!site) return;
    const to = site.to.size === 1 ? [...site.to][0] : undefined;
    for (const h of site.hosts) if (!out.some((a) => a.host === h.host)) out.push({ host: h.host, file: path, line: h.line, how: "a Caddy site", ...(to ? { to } : {}) });
    site = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const t = code(lines[i]).trim();
    if (!t) continue;
    if (depth === 0 && /\{$/.test(t)) {
      const head = t.slice(0, -1).trim();
      // `{` alone is the global options block; `(name) {` a snippet.
      site = head && !head.startsWith("(") ? { hosts: head.split(/[\s,]+/).flatMap((a) => (ownHost(a, false) ? [{ host: ownHost(a, false)!, line: i + 1 }] : [])), to: new Set() } : null;
      depth = 1;
      continue;
    }
    if (site && depth >= 1) {
      const rp = /^reverse_proxy\s+(?:(?:@\S+|\/\S*)\s+)?([^\s{]+)/.exec(t);
      if (rp && !rp[1].includes("{")) site.to.add(rp[1].replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase());
    }
    if (/\{$/.test(t)) depth++;
    if (t === "}" || /^\}\s/.test(t)) depth = Math.max(0, depth - 1);
    if (depth === 0) flush();
  }
  flush();
  return out;
}

function dirOfPath(p: string): string | undefined {
  const i = p.lastIndexOf("/");
  return i < 0 ? undefined : p.slice(0, i);
}

/** fly.toml: Fly serves an app at <app>.fly.dev. */
export function flyAddresses(path: string, content: string): DeployAddress[] {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*app\s*=\s*["']([a-z0-9][a-z0-9-]*)["']/.exec(code(lines[i]));
    const host = m ? ownHost(`${m[1]}.fly.dev`, false) : null;
    const dir = dirOfPath(path);
    if (host) return [{ host, file: path, line: i + 1, how: "fly.toml's app (Fly serves it at <app>.fly.dev)", ...(dir ? { dir } : {}) }];
  }
  return [];
}

/** vercel.json `alias` ("example.com" or a list). */
export function vercelAddresses(path: string, content: string): DeployAddress[] {
  let json: { alias?: unknown };
  try {
    json = JSON.parse(content) as { alias?: unknown };
  } catch {
    return [];
  }
  const aliases = typeof json.alias === "string" ? [json.alias] : Array.isArray(json.alias) ? json.alias.filter((a): a is string => typeof a === "string") : [];
  const lines = content.split("\n");
  const dir = dirOfPath(path);
  const out: DeployAddress[] = [];
  for (const a of aliases) {
    const host = ownHost(a, false);
    const at = lines.findIndex((l) => l.includes(a));
    if (host) out.push({ host, file: path, line: at < 0 ? 1 : at + 1, how: "vercel.json's alias", ...(dir ? { dir } : {}) });
  }
  return out;
}

/** A CNAME file (GitHub Pages): the custom domain the site is served at. */
export function cnameAddresses(path: string, content: string): DeployAddress[] {
  const lines = content.split("\n");
  const i = lines.findIndex((l) => l.trim());
  const host = i < 0 || lines.filter((l) => l.trim()).length !== 1 ? null : ownHost(lines[i], false);
  const dir = dirOfPath(path);
  return host ? [{ host, file: path, line: i + 1, how: "the CNAME file", ...(dir ? { dir } : {}) }] : [];
}

/** Is this file a deploy file that names a public address? (Deploy files that name none are not read at all.) */
export function deployKindOf(path: string, content: string): boolean {
  const b = path.slice(path.lastIndexOf("/") + 1);
  if (CI_RE.test(path)) return ciAddresses(path, content).length > 0;
  if (/^caddyfile([.-][^/]*)?$/i.test(b) || /\.caddyfile$/i.test(b)) return true;
  if (b === "fly.toml") return true;
  if (/^render\.ya?ml$/i.test(b)) return true;
  if (/^app\.ya?ml$/i.test(b)) return /^domains\s*:/m.test(content);
  if (b === "vercel.json") return /"alias"\s*:/.test(content);
  if (b === "CNAME") return cnameAddresses(path, content).length > 0;
  return false;
}

/** May this path be a deploy file? (Name only: the folder readers keep it, the content decides.) */
export function isDeployPath(path: string): boolean {
  const b = path.slice(path.lastIndexOf("/") + 1);
  return CI_RE.test(path) || /^caddyfile([.-][^/]*)?$/i.test(b) || /\.caddyfile$/i.test(b) || b === "fly.toml" || /^render\.ya?ml$/i.test(b) || /^app\.ya?ml$/i.test(b) || b === "vercel.json" || b === "CNAME";
}
