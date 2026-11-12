// What config files tell us, before anything is joined to the code. Produced
// only from config files (compose, Dockerfile, .env.example, ...); never from
// tree-sitter. Every value that could be a secret is already redacted.
// See docs/SERVICES.md §2 and §3.
import type { Method } from "../facts";
import type { GatewayRule, ServiceDef } from "../types";
import type { DeployAddress } from "./deploy";

export type ConfigSource = "compose" | "k8s" | "dockerfile" | "wrangler" | "workspace" | "folder";

export interface ConfigEnvValue {
  value: string;
  line: number;
  /** The file the value is in, when it is not the service's own file (an env_file, an override). */
  file?: string;
}

export interface ConfigService {
  name: string;
  kind: ServiceDef["kind"];
  /** Folder the service is built from (compose build context, Dockerfile folder), repo-relative. */
  dir?: string;
  image?: string;
  hostnames: string[];
  ports: { host?: number; container: number }[];
  env: Record<string, ConfigEnvValue>;
  /** Example env files read for this service (env_file entries, example variants only). */
  envFiles: string[];
  dependsOn: string[];
  /** The start command, as it would be typed ("node src/index.js"). */
  entry?: string;
  entryLine?: number;
  entryFile?: string;
  /** A label from the start command ("Node.js", "uvicorn"). */
  framework?: string;
  /** Compose build.dockerfile, repo-relative, when given. */
  dockerfile?: string;
  /** Dockerfile LABELs that name the service: another name it may be called by (docs/SERVICES.md §6.5). */
  labels?: { value: string; line: number }[];
  file: string;
  line: number;
  /** More lines that prove the same service (compose overrides). */
  also?: { file: string; line: number }[];
  /** How sure the boundary is, when not the source's default (a workspace's apps/* folder is a guess). */
  confidence?: "certain" | "likely";
  source: ConfigSource;
}

export interface ConfigFacts {
  services: ConfigService[];
  /** scope = compose service name / k8s workload. `likely` = why the value is only a guess (a Helm values key). */
  envValues: { name: string; value: string; file: string; line: number; scope?: string; likely?: string }[];
  gateways: GatewayRule[];
  /** OpenAPI */
  routes: { method: Method; path: string; operationId?: string; serverUrl?: string; file: string; line: number }[];
  /** AsyncAPI; `tech` from its servers' protocol when given ("kafka", "amqp"). */
  channels: { name: string; op: "publish" | "consume"; file: string; line: number; tech?: string }[];
  /** .proto */
  rpcServices: { name: string; methods: string[]; file: string; line: number }[];
  workspaces: { dir: string; name?: string; isApp?: boolean; deps: string[]; file: string; line: number }[];
  declared: { name: string; kind: string; system?: string; dependsOn: string[]; provides: string[]; consumes: string[]; file: string; line: number; source?: "backstage" | "compass" | "structurizr" | "helm" }[];
  /** wrangler `[[services]]`: `env.<binding>.fetch()` reaches the Worker named `service`. */
  bindings: { binding: string; service: string; file: string; line: number; scope?: string }[];
  /** Public addresses deploy config gives a service (CI health checks, Caddy, Traefik, nginx server_name,
   * Ingress hosts, fly.toml, render.yaml, app.yaml, vercel.json, CNAME); build.ts decides whose each one is. */
  addresses: DeployAddress[];
}

export function emptyConfigFacts(): ConfigFacts {
  return { services: [], envValues: [], gateways: [], routes: [], channels: [], rpcServices: [], workspaces: [], declared: [], bindings: [], addresses: [] };
}
