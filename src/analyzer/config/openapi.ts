// API descriptions: OpenAPI / Swagger (the doors a service says it has) and
// AsyncAPI (the channels it says it sends to or reads from). A described
// door or channel is real in the sense that someone wrote it down; build.ts
// keeps the parsed handler when there is one and marks a described-only door
// "described in openapi.yaml; I did not find the code".
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, type Node, type YAMLMap } from "yaml";
import type { Method } from "../facts";
import type { ConfigFacts } from "./types";

const METHODS: Record<string, Method> = { get: "GET", post: "POST", put: "PUT", patch: "PATCH", delete: "DELETE" };

function get(m: unknown, key: string): unknown {
  return isMap(m) ? (m as YAMLMap).get(key, true) : undefined;
}
function str(n: unknown): string | undefined {
  return isScalar(n) && n.value !== null && n.value !== undefined ? String(n.value) : undefined;
}
function pairs(m: unknown): { key: string; keyNode: unknown; value: unknown }[] {
  if (!isMap(m)) return [];
  const out: { key: string; keyNode: unknown; value: unknown }[] = [];
  for (const p of m.items) if (isPair(p) && isScalar(p.key)) out.push({ key: String(p.key.value), keyNode: p.key, value: p.value });
  return out;
}

function parse(path: string, content: string, warnings: string[]) {
  const lc = new LineCounter();
  const doc = parseDocument(content, { lineCounter: lc, uniqueKeys: false, prettyErrors: false });
  if (doc.errors.length) {
    warnings.push(`could not read ${path}: ${doc.errors[0].message.split("\n")[0]}`);
    return null;
  }
  const lineOf = (n: unknown): number => {
    const r = (n as Node | undefined)?.range;
    return r ? lc.linePos(r[0]).line : 1;
  };
  return { root: doc.contents, lineOf };
}

/** Path part of a server URL ("http://users:8080/v1" → "/v1"; "/api" → "/api"). */
function urlPath(u: string): string {
  const m = /^(?:[a-z]+:)?\/\/[^/]+(\/[^?#]*)?/i.exec(u);
  const p = m ? (m[1] ?? "") : u.startsWith("/") ? u.split(/[?#]/)[0] : "";
  return p.replace(/\/+$/, "");
}

export function readOpenApi(path: string, content: string): { routes: ConfigFacts["routes"]; warnings: string[] } {
  const warnings: string[] = [];
  const routes: ConfigFacts["routes"] = [];
  const doc = parse(path, content, warnings);
  if (!doc || !isMap(doc.root)) return { routes, warnings };
  const { root, lineOf } = doc;
  if (!get(root, "openapi") && !get(root, "swagger")) return { routes, warnings };
  // Where the doors are mounted: OpenAPI 3 `servers[0].url`, Swagger 2 `host` + `basePath`.
  const servers = get(root, "servers");
  const serverUrl = isSeq(servers) ? str(get(servers.items[0], "url")) : undefined;
  const host = str(get(root, "host"));
  const base = serverUrl !== undefined ? urlPath(serverUrl) : (str(get(root, "basePath")) ?? "").replace(/\/+$/, "");
  const server = serverUrl ?? (host ? `http://${host}${base}` : undefined);
  for (const p of pairs(get(root, "paths"))) {
    if (!p.key.startsWith("/")) continue;
    for (const op of pairs(p.value)) {
      const method = METHODS[op.key.toLowerCase()];
      if (!method) continue;
      const full = `${base}${p.key}`.replace(/\/{2,}/g, "/") || "/";
      const r: ConfigFacts["routes"][number] = { method, path: full, file: path, line: lineOf(op.keyNode) };
      const id = str(get(op.value, "operationId"));
      if (id) r.operationId = id;
      if (server) r.serverUrl = server;
      routes.push(r);
    }
  }
  return { routes, warnings };
}

/** AsyncAPI 2 (`channels.<n>.publish|subscribe`) and 3 (`operations.<n>.action` + channel ref). */
export function readAsyncApi(path: string, content: string): { channels: ConfigFacts["channels"]; protocol?: string; warnings: string[] } {
  const warnings: string[] = [];
  const channels: ConfigFacts["channels"] = [];
  const doc = parse(path, content, warnings);
  if (!doc || !isMap(doc.root)) return { channels, warnings };
  const { root, lineOf } = doc;
  const version = str(get(root, "asyncapi"));
  if (!version) return { channels, warnings };
  let protocol: string | undefined;
  for (const s of pairs(get(root, "servers"))) protocol ??= str(get(s.value, "protocol"))?.toLowerCase();
  const chans = pairs(get(root, "channels"));
  if (version.startsWith("2")) {
    // In AsyncAPI 2 the verbs are the reader's: `subscribe` = this app sends, `publish` = this app receives.
    for (const c of chans) {
      for (const op of pairs(c.value)) {
        if (op.key === "subscribe") channels.push({ name: c.key, op: "publish", file: path, line: lineOf(op.keyNode) });
        else if (op.key === "publish") channels.push({ name: c.key, op: "consume", file: path, line: lineOf(op.keyNode) });
      }
    }
    return { channels, protocol, warnings };
  }
  const nameOf = new Map<string, string>();
  for (const c of chans) nameOf.set(c.key, str(get(c.value, "address")) ?? c.key);
  for (const op of pairs(get(root, "operations"))) {
    const action = str(get(op.value, "action"));
    const ref = str(get(get(op.value, "channel"), "$ref"));
    const key = ref?.split("/").pop();
    const name = key ? nameOf.get(key.replace(/~1/g, "/")) : undefined;
    if (!name || (action !== "send" && action !== "receive")) continue;
    channels.push({ name, op: action === "send" ? "publish" : "consume", file: path, line: lineOf(op.keyNode) });
  }
  return { channels, protocol, warnings };
}
