// What the team wrote down about its system, as opposed to what the code
// shows: Backstage catalog-info.yaml, Atlassian Compass compass.yml and a
// Structurizr workspace.dsl. Names, the `system` a component belongs to (a
// group box on the system view), and declared dependencies. None of it is
// ever drawn as a call: at most a thin grey "declared, not seen in code" line.
import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Node, type YAMLMap } from "yaml";
import type { ConfigFacts } from "./types";

type Declared = ConfigFacts["declared"][number];

function get(m: unknown, key: string): unknown {
  return isMap(m) ? (m as YAMLMap).get(key, true) : undefined;
}
function str(n: unknown): string | undefined {
  return isScalar(n) && n.value !== null && n.value !== undefined ? String(n.value) : undefined;
}
function list(n: unknown): string[] {
  if (isSeq(n)) return n.items.map(str).filter((x): x is string => !!x);
  const s = str(n);
  return s ? [s] : [];
}

/** "component:default/users" → "users". */
export function entityName(ref: string): string {
  return ref.replace(/^[a-z]+:/i, "").replace(/^[^/]+\//, "");
}

function yamlDocs(path: string, content: string, warnings: string[]) {
  const lc = new LineCounter();
  let docs;
  try {
    docs = parseAllDocuments(content, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
  } catch (e) {
    warnings.push(`could not read ${path}: ${(e as Error).message.split("\n")[0]}`);
    return { docs: [], lineOf: () => 1 };
  }
  const lineOf = (n: unknown): number => {
    const r = (n as Node | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  return { docs: Array.isArray(docs) ? docs.filter((d) => !d.errors.length) : [], lineOf };
}

function nameLine(root: unknown, meta: unknown, lineOf: (n: unknown) => number): number {
  const m = isMap(meta) ? meta : root;
  const p = isMap(m) ? m.items.find((x) => str(x.key) === "name") : undefined;
  return lineOf(p?.key ?? root);
}

export function readBackstage(path: string, content: string): { declared: Declared[]; warnings: string[] } {
  const warnings: string[] = [];
  const declared: Declared[] = [];
  const { docs, lineOf } = yamlDocs(path, content, warnings);
  for (const d of docs) {
    const root = d.contents;
    const kind = str(get(root, "kind"));
    const meta = get(root, "metadata");
    const name = str(get(meta, "name"));
    if (!kind || !name) continue;
    const spec = get(root, "spec");
    const type = str(get(spec, "type"));
    declared.push({
      name,
      kind: `${kind.toLowerCase()}${type ? `:${type.toLowerCase()}` : ""}`,
      ...(str(get(spec, "system")) ? { system: entityName(str(get(spec, "system"))!) } : {}),
      dependsOn: list(get(spec, "dependsOn")).map(entityName),
      provides: list(get(spec, "providesApis")).map(entityName),
      consumes: list(get(spec, "consumesApis")).map(entityName),
      file: path,
      line: nameLine(root, meta, lineOf),
      source: "backstage",
    });
  }
  return { declared, warnings };
}

export function readCompass(path: string, content: string): { declared: Declared[]; warnings: string[] } {
  const warnings: string[] = [];
  const declared: Declared[] = [];
  const { docs, lineOf } = yamlDocs(path, content, warnings);
  for (const d of docs) {
    const root = d.contents;
    const name = str(get(root, "name"));
    if (!name) continue;
    const type = str(get(root, "typeId")) ?? str(get(root, "type"));
    // Compass relationships are ARIs (ari:cloud:compass:…/component/<id>): not names we can match.
    declared.push({ name, kind: `compass:${(type ?? "component").toLowerCase()}`, dependsOn: [], provides: [], consumes: [], file: path, line: nameLine(root, root, lineOf), source: "compass" });
  }
  return { declared, warnings };
}

/** Structurizr DSL: `id = softwareSystem "Name"`, `id = container "Name"` (inside a system), `a -> b`. */
export function readStructurizr(path: string, content: string): { declared: Declared[]; warnings: string[] } {
  const declared: Declared[] = [];
  const byId = new Map<string, Declared>();
  const lines = content.split("\n");
  const stack: { system?: string }[] = [{}];
  const rels: { from: string; to: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, "").replace(/(^|\s)(\/\/|#).*$/, "");
    const el = /^\s*(?:(\w+)\s*=\s*)?(softwareSystem|container|component)\s+"([^"]+)"/.exec(l);
    const ctx = stack[stack.length - 1];
    if (el) {
      const [, id, what, name] = el;
      if (what === "softwareSystem") {
        // A system is a group; it is a card of its own only when nothing is declared inside it.
        const d: Declared = { name, kind: "structurizr:system", dependsOn: [], provides: [], consumes: [], file: path, line: i + 1, source: "structurizr" };
        if (id) byId.set(id, d);
        declared.push(d);
      } else if (what === "container") {
        const d: Declared = { name, kind: "structurizr:container", ...(ctx.system ? { system: ctx.system } : {}), dependsOn: [], provides: [], consumes: [], file: path, line: i + 1, source: "structurizr" };
        if (id) byId.set(id, d);
        declared.push(d);
      }
    }
    const rel = /^\s*(\w+)\s*->\s*(\w+)/.exec(l);
    if (rel) rels.push({ from: rel[1], to: rel[2] });
    for (const ch of l) {
      if (ch === "{") stack.push({ system: el?.[2] === "softwareSystem" ? el[3] : ctx.system });
      else if (ch === "}" && stack.length > 1) stack.pop();
    }
  }
  for (const r of rels) {
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (a && b && !a.dependsOn.includes(b.name)) a.dependsOn.push(b.name);
  }
  // Systems that hold containers are groups, not cards.
  const holders = new Set(declared.filter((d) => d.system).map((d) => d.system));
  return { declared: declared.filter((d) => !(d.kind === "structurizr:system" && holders.has(d.name))), warnings: [] };
}
