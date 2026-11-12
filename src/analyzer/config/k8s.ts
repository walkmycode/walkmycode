// Kubernetes YAML: a `Service` is a name other pods reach, a workload
// (Deployment, StatefulSet, DaemonSet, Job, CronJob) is what runs behind it,
// joined when the Service's selector is a subset of the pod labels. Env
// values come from `env[].value` and ConfigMaps; `secretKeyRef` is never
// followed. kustomization.yaml adds its `namespace` to the resources it lists.
// Helm templates (`{{ }}`, `templates/`) are never read here: they are not
// YAML until Helm renders them. Chart.yaml and values*.yaml are read by
// readHelm, as the team's description rather than something observed.
import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, parseDocument, type Node, type YAMLMap } from "yaml";
import { kindOfImage } from "./compose";
import { dirOf, joinPath, redactValue } from "./files";
import type { ConfigFacts, ConfigService } from "./types";

const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet", "Pod"]);

function get(m: unknown, key: string): unknown {
  return isMap(m) ? (m as YAMLMap).get(key, true) : undefined;
}
function str(n: unknown): string | undefined {
  return isScalar(n) && n.value !== null && n.value !== undefined ? String(n.value) : undefined;
}
function items(n: unknown): unknown[] {
  return isSeq(n) ? n.items : [];
}
function labels(n: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isMap(n)) return out;
  for (const p of n.items) {
    const k = str(p.key);
    const v = str(p.value);
    if (k && v !== undefined) out[k] = v;
  }
  return out;
}

interface Doc {
  kind: string;
  name: string;
  namespace?: string;
  root: unknown;
  file: string;
  line: number;
  lineOf: (n: unknown) => number;
}

function docsOf(path: string, content: string, warnings: string[]): Doc[] {
  const lc = new LineCounter();
  let parsed;
  try {
    parsed = parseAllDocuments(content, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
  } catch (e) {
    warnings.push(`could not read ${path}: ${(e as Error).message.split("\n")[0]}`);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const lineOf = (n: unknown): number => {
    const r = (n as Node | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  const out: Doc[] = [];
  for (const d of parsed) {
    if (d.errors.length) {
      warnings.push(`could not read part of ${path}: ${d.errors[0].message.split("\n")[0]}`);
      continue;
    }
    const root = d.contents;
    const kind = str(get(root, "kind"));
    const meta = get(root, "metadata");
    const name = str(get(meta, "name"));
    if (!kind || !name) continue;
    const kindPair = isMap(root) ? root.items.find((p) => str(p.key) === "kind") : undefined;
    out.push({ kind, name, namespace: str(get(meta, "namespace")), root, file: path, line: lineOf(kindPair?.key ?? root), lineOf });
  }
  return out;
}

/** The pod spec of a workload (CronJob nests it one level deeper). */
function podTemplate(d: Doc): unknown {
  const spec = get(d.root, "spec");
  if (d.kind === "Pod") return d.root;
  if (d.kind === "CronJob") return get(get(get(spec, "jobTemplate"), "spec"), "template");
  return get(spec, "template");
}

export interface K8sRead {
  services: ConfigService[];
  envValues: ConfigFacts["envValues"];
  warnings: string[];
}

/** Every Kubernetes file, read together so Services, workloads and ConfigMaps in different files meet. */
export function readK8s(files: { path: string; content: string }[]): K8sRead {
  const warnings: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  // kustomization.yaml: the namespace it gives its resources (followed into sub-folders).
  const nsOf = new Map<string, string>();
  const kustomize = (path: string, ns: string | undefined, seen: Set<string>) => {
    if (seen.has(path)) return;
    seen.add(path);
    const f = byPath.get(path);
    if (!f) return;
    const doc = parseDocument(f.content, { prettyErrors: false });
    if (doc.errors.length) return;
    const own = str(get(doc.contents, "namespace")) ?? ns;
    for (const r of items(get(doc.contents, "resources")).concat(items(get(doc.contents, "bases")))) {
      const rel = str(r);
      if (!rel || /^[a-z]+:\/\//i.test(rel)) continue;
      const target = joinPath(dirOf(path), rel);
      const sub = [`${target}/kustomization.yaml`, `${target}/kustomization.yml`].find((p) => byPath.has(p));
      if (sub) kustomize(sub, own, seen);
      else if (own && !nsOf.has(target)) nsOf.set(target, own);
    }
  };
  for (const f of files) if (/(^|\/)kustomization\.ya?ml$/i.test(f.path)) kustomize(f.path, undefined, new Set());

  const docs: Doc[] = [];
  for (const f of files) {
    if (/(^|\/)kustomization\.ya?ml$/i.test(f.path)) continue;
    for (const d of docsOf(f.path, f.content, warnings)) {
      d.namespace ??= nsOf.get(f.path);
      docs.push(d);
    }
  }

  const configMaps = new Map<string, Map<string, { value: string; file: string; line: number }>>();
  for (const d of docs) {
    if (d.kind !== "ConfigMap") continue;
    const data = get(d.root, "data");
    const m = new Map<string, { value: string; file: string; line: number }>();
    if (isMap(data)) for (const p of data.items) {
      const k = str(p.key);
      const v = str(p.value);
      if (k && v !== undefined) m.set(k, { value: redactValue(k, v), file: d.file, line: d.lineOf(p.key) });
    }
    configMaps.set(d.name, m);
  }

  interface Workload {
    doc: Doc;
    image?: string;
    labels: Record<string, string>;
    env: ConfigService["env"];
    ports: number[];
    entry?: { text: string; line: number };
  }
  const workloads: Workload[] = [];
  const envValues: ConfigFacts["envValues"] = [];
  for (const d of docs) {
    if (!WORKLOADS.has(d.kind)) continue;
    const tpl = podTemplate(d);
    const w: Workload = { doc: d, labels: labels(get(get(tpl, "metadata"), "labels")), env: {}, ports: [] };
    for (const c of items(get(get(tpl, "spec"), "containers"))) {
      w.image ??= str(get(c, "image"));
      for (const p of items(get(c, "ports"))) {
        const n = parseInt(str(get(p, "containerPort")) ?? "", 10);
        if (n > 0 && !w.ports.includes(n)) w.ports.push(n);
      }
      const cmd = [...items(get(c, "command")), ...items(get(c, "args"))].map(str).filter(Boolean).join(" ");
      if (cmd && !w.entry) w.entry = { text: cmd, line: d.lineOf(get(c, "command") ?? get(c, "args")) };
      for (const e of items(get(c, "env"))) {
        const name = str(get(e, "name"));
        if (!name) continue;
        const value = str(get(e, "value"));
        if (value !== undefined) {
          w.env[name] = { value: redactValue(name, value), line: d.lineOf(e), file: d.file };
          continue;
        }
        // valueFrom.configMapKeyRef is followed; secretKeyRef never is.
        const ref = get(get(e, "valueFrom"), "configMapKeyRef");
        const hit = configMaps.get(str(get(ref, "name")) ?? "")?.get(str(get(ref, "key")) ?? "");
        if (hit) w.env[name] = { value: redactValue(name, hit.value), line: hit.line, file: hit.file };
      }
      for (const ef of items(get(c, "envFrom"))) {
        const cm = configMaps.get(str(get(get(ef, "configMapRef"), "name")) ?? "");
        if (cm) for (const [k, v] of cm) if (!(k in w.env)) w.env[k] = { value: redactValue(k, v.value), line: v.line, file: v.file };
      }
    }
    workloads.push(w);
  }

  const services: ConfigService[] = [];
  const claimed = new Set<Workload>();
  for (const d of docs) {
    if (d.kind !== "Service") continue;
    const spec = get(d.root, "spec");
    const selector = labels(get(spec, "selector"));
    const sel = Object.entries(selector);
    // selector ⊆ pod labels, in the same namespace.
    const w = sel.length ? workloads.find((x) => (x.doc.namespace ?? "") === (d.namespace ?? "") && sel.every(([k, v]) => x.labels[k] === v)) : undefined;
    if (w) claimed.add(w);
    const ports: ConfigService["ports"] = [];
    for (const p of items(get(spec, "ports"))) {
      const port = parseInt(str(get(p, "port")) ?? "", 10);
      const target = parseInt(str(get(p, "targetPort")) ?? "", 10);
      const node = parseInt(str(get(p, "nodePort")) ?? "", 10);
      if (port > 0) ports.push(node > 0 ? { host: node, container: port } : { container: port });
      if (target > 0 && target !== port && !ports.some((x) => x.container === target)) ports.push({ container: target });
    }
    const ns = d.namespace ?? "default";
    const hostnames = [d.name, `${d.name}.${ns}`, `${d.name}.${ns}.svc`, `${d.name}.${ns}.svc.cluster.local`];
    const s: ConfigService = {
      name: d.name,
      kind: w?.image ? (kindOfImage(w.image) ?? "placeholder") : "placeholder",
      hostnames,
      ports,
      env: w?.env ?? {},
      envFiles: [],
      dependsOn: [],
      file: d.file,
      line: d.line,
      source: "k8s",
    };
    if (w?.image) s.image = w.image;
    if (w) (s.also ??= []).push({ file: w.doc.file, line: w.doc.line });
    if (w?.entry) {
      s.entry = w.entry.text;
      s.entryLine = w.entry.line;
      s.entryFile = w.doc.file;
    }
    services.push(s);
    // Pods get <NAME>_SERVICE_HOST / _PORT for every Service in their namespace.
    const envName = d.name.toUpperCase().replace(/[-.]/g, "_");
    envValues.push({ name: `${envName}_SERVICE_HOST`, value: d.name, file: d.file, line: d.line });
    if (ports[0]) envValues.push({ name: `${envName}_SERVICE_PORT`, value: String(ports[0].container), file: d.file, line: d.line });
  }
  // A workload no Service selects (a worker, a job) still runs code: a service with no hostname.
  for (const w of workloads) {
    if (claimed.has(w)) continue;
    services.push({
      name: w.doc.name,
      kind: w.image ? (kindOfImage(w.image) ?? "placeholder") : "placeholder",
      ...(w.image ? { image: w.image } : {}),
      hostnames: [],
      ports: w.ports.map((p) => ({ container: p })),
      env: w.env,
      envFiles: [],
      dependsOn: [],
      ...(w.entry ? { entry: w.entry.text, entryLine: w.entry.line, entryFile: w.doc.file } : {}),
      file: w.doc.file,
      line: w.doc.line,
      source: "k8s",
    });
  }
  for (const s of services) for (const [name, v] of Object.entries(s.env)) envValues.push({ name, value: v.value, file: v.file ?? s.file, line: v.line, scope: s.name });
  return { services, envValues, warnings };
}

/** Chart.yaml and values*.yaml: the chart's name and dependencies, and values that look like
 * addresses (`usersUrl`, `users.host`), as env-style settings. All of it is a guess. */
export function readHelm(path: string, content: string): { declared: ConfigFacts["declared"]; envValues: ConfigFacts["envValues"]; warnings: string[] } {
  const warnings: string[] = [];
  const declared: ConfigFacts["declared"] = [];
  const envValues: ConfigFacts["envValues"] = [];
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (content.includes("{{") || /(^|\/)templates\//.test(path)) return { declared, envValues, warnings };
  const lc = new LineCounter();
  const doc = parseDocument(content, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
  if (doc.errors.length) {
    warnings.push(`could not read ${path}: ${doc.errors[0].message.split("\n")[0]}`);
    return { declared, envValues, warnings };
  }
  const lineOf = (n: unknown): number => {
    const r = (n as Node | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  const root = doc.contents;
  if (/^chart\.ya?ml$/.test(base)) {
    const name = str(get(root, "name"));
    if (!name) return { declared, envValues, warnings };
    const deps = items(get(root, "dependencies"))
      .map((d) => str(get(d, "name")))
      .filter((x): x is string => !!x);
    const namePair = isMap(root) ? root.items.find((p) => str(p.key) === "name") : undefined;
    declared.push({ name, kind: "helm chart", dependsOn: deps, provides: [], consumes: [], file: path, line: lineOf(namePair?.key), source: "helm" });
    return { declared, envValues, warnings };
  }
  const walk = (n: unknown, trail: string[], depth: number) => {
    if (!isMap(n) || depth > 6) return;
    for (const p of n.items) {
      const k = str(p.key);
      if (!k) continue;
      const path2 = [...trail, k];
      if (isMap(p.value)) walk(p.value, path2, depth + 1);
      else if (/(url|host|baseurl|endpoint|addr)$/i.test(k)) {
        const v = str(p.value);
        if (!v) continue;
        // usersUrl → USERS_URL, users.host → USERS_HOST
        const name = path2
          .join("_")
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .replace(/[^A-Za-z0-9]+/g, "_")
          .toUpperCase();
        envValues.push({ name, value: redactValue(name, v), file: path, line: lineOf(p.key), likely: "from a Helm values file" });
      }
    }
  };
  walk(root, [], 0);
  return { declared, envValues, warnings };
}
