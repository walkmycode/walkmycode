// Reads every config file in the repo into ConfigFacts (docs/SERVICES.md §3):
// compose services, Dockerfiles, example env files, Kubernetes and Helm,
// .proto, OpenAPI and AsyncAPI, workspaces, wrangler, the team's own catalog
// files, and the public addresses deploy files give a service (CI health
// checks, Caddy, Traefik labels, fly.toml, render.yaml, app.yaml, vercel.json,
// CNAME). Config files are never tree-sitter parsed and never leave
// the browser; values that could be secrets are redacted as they are read.
// Rewrites and proxies are read apart (gateway.ts), since next.config.js
// needs the JavaScript parser.
import type { SourceFile } from "../types";
import { mergeCompose, readCompose } from "./compose";
import { dockerfileService, readDockerfile } from "./dockerfile";
import { readBackstage, readCompass, readStructurizr } from "./declared";
import { readEnvFile, type EnvLine } from "./envfile";
import { readHelm, readK8s } from "./k8s";
import { readAsyncApi, readOpenApi } from "./openapi";
import { readProto } from "./proto";
import { readWorkspaces, readWrangler } from "./workspaces";
import { readDeploy } from "./hosting";
import { configKindOf, dirOf } from "./files";
import { emptyConfigFacts, type ConfigFacts, type ConfigService } from "./types";

export { configKindOf, configKindOfPath, configLangOf, ENV_EXAMPLE_RE, isConfigPath, redactConfigText, redactSource, redactValue } from "./files";
export type { ConfigFacts, ConfigService } from "./types";

/** Is this file one the config readers look at (by name and, for YAML, content)? */
export function isConfigFile(path: string, content: string): boolean {
  return configKindOf(path, content) !== null;
}

/** Files the workspace reader looks at (manifests are not config files, so they are named here). */
const WORKSPACE_FILES = /^(package\.json|pnpm-workspace\.yaml|lerna\.json|Cargo\.toml|go\.mod|go\.work|project\.json)$/;

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Base compose files first, then overrides by file name. */
function composeOrder(a: string, b: string): number {
  const isBase = (p: string) => /^(docker-)?compose\.ya?ml$/i.test(basename(p));
  if (isBase(a) !== isBase(b)) return isBase(a) ? -1 : 1;
  return a.localeCompare(b);
}

export function extractConfig(files: SourceFile[]): { facts: ConfigFacts; warnings: string[] } {
  const facts = emptyConfigFacts();
  const warnings: string[] = [];
  const byKind = (k: string) => files.filter((f) => configKindOf(f.path, f.content) === k);
  const paths = new Set(files.map((f) => f.path));

  // ── example env files ──
  const envFiles = new Map<string, EnvLine[]>();
  for (const f of byKind("envfile")) envFiles.set(f.path, readEnvFile(f.content));

  // ── compose, overrides merged per folder ──
  const composeByDir = new Map<string, SourceFile[]>();
  for (const f of byKind("compose")) composeByDir.set(dirOf(f.path), [...(composeByDir.get(dirOf(f.path)) ?? []), f]);
  const compose: ConfigService[] = [];
  for (const group of composeByDir.values()) {
    const merged = new Map<string, ConfigService>();
    for (const f of group.sort((a, b) => composeOrder(a.path, b.path))) {
      const r = readCompose(f.path, f.content, (p) => paths.has(p));
      warnings.push(...r.warnings);
      for (const s of r.services) merged.set(s.name, merged.has(s.name) ? mergeCompose(merged.get(s.name)!, s) : s);
    }
    compose.push(...merged.values());
  }
  const referenced = new Set<string>();
  for (const s of compose) {
    // environment: wins over env_file, as in docker compose.
    for (const ef of s.envFiles) {
      referenced.add(ef);
      for (const e of envFiles.get(ef) ?? []) if (!(e.name in s.env)) s.env[e.name] = { value: e.value, line: e.line, file: ef };
    }
    for (const [name, v] of Object.entries(s.env)) facts.envValues.push({ name, value: v.value, file: v.file ?? s.file, line: v.line, scope: s.name });
  }
  facts.services.push(...compose);

  // ── Dockerfiles: env scoped to the compose service built from here, else the folder's own ──
  for (const f of byKind("dockerfile")) {
    const d = readDockerfile(f.content);
    const dir = dirOf(f.path);
    const owner = compose.find((s) => s.dockerfile === f.path || (s.dockerfile === undefined && s.dir === dir && basename(f.path) === "Dockerfile"));
    for (const e of d.env) facts.envValues.push({ name: e.name, value: e.value, file: f.path, line: e.line, scope: owner?.name });
    facts.services.push(dockerfileService(f.path, dir, basename(dir), d));
  }

  // ── example env files nobody's compose points at: scoped by folder later ──
  for (const [file, lines] of envFiles) {
    if (referenced.has(file)) continue;
    for (const e of lines) facts.envValues.push({ name: e.name, value: e.value, file, line: e.line });
  }

  // ── Kubernetes (read together, so a Service meets its Deployment and ConfigMap), Helm charts ──
  const k8s = readK8s(byKind("k8s"));
  warnings.push(...k8s.warnings);
  facts.services.push(...k8s.services);
  facts.envValues.push(...k8s.envValues);
  for (const f of byKind("helm")) {
    const h = readHelm(f.path, f.content);
    warnings.push(...h.warnings);
    facts.declared.push(...h.declared);
    facts.envValues.push(...h.envValues);
  }

  // ── wrangler: a Worker is a service; its [vars] are its settings ──
  for (const f of byKind("wrangler")) {
    const w = readWrangler(f.path, f.content);
    if (w.service) facts.services.push(w.service);
    facts.envValues.push(...w.envValues);
    facts.bindings.push(...w.bindings);
  }

  // ── API descriptions ──
  for (const f of byKind("proto")) facts.rpcServices.push(...readProto(f.path, f.content));
  for (const f of byKind("openapi")) {
    const r = readOpenApi(f.path, f.content);
    warnings.push(...r.warnings);
    facts.routes.push(...r.routes);
  }
  for (const f of byKind("asyncapi")) {
    const r = readAsyncApi(f.path, f.content);
    warnings.push(...r.warnings);
    for (const c of r.channels) facts.channels.push(r.protocol ? { ...c, tech: r.protocol } : c);
  }

  // ── workspaces (manifests are passed in too: package.json workspaces, Cargo [workspace], go.mod) ──
  const ws = readWorkspaces(files.filter((f) => WORKSPACE_FILES.test(basename(f.path))));
  warnings.push(...ws.warnings);
  facts.workspaces.push(...ws.workspaces);

  // ── what the team wrote down ──
  for (const f of byKind("declared")) {
    const b = basename(f.path).toLowerCase();
    const r = b === "workspace.dsl" ? readStructurizr(f.path, f.content) : b.startsWith("compass") ? readCompass(f.path, f.content) : readBackstage(f.path, f.content);
    warnings.push(...r.warnings);
    facts.declared.push(...r.declared);
  }

  // ── where the deployed services answer on the internet: deploy files, and Traefik labels in compose ──
  for (const f of byKind("deploy")) facts.addresses.push(...readDeploy(f.path, f.content, "deploy"));
  for (const f of byKind("compose")) facts.addresses.push(...readDeploy(f.path, f.content, "compose"));
  return { facts, warnings };
}
