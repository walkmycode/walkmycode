// Words about a system of services, shared by the AI's map summary and its
// tools (docs/SERVICES.md §8). Everything here is read off the map: each line
// cites the file:line the map already holds, and nothing adds a link.
// No "use client": the server imports prompts.ts too.
import type { CodeMap, Evidence, MapEdge, MapNode, ServiceDef, ServiceLink } from "@/analyzer/types";

/** Only a map of several app services gets the service words; a monolith never hears of services. */
export const isSystem = (map: CodeMap): boolean => map.system?.kind === "services";

export const at = (e: Evidence | undefined): string => (e ? `${e.file}:${e.line}` : "");

export function nodeOf(map: CodeMap, id: string): MapNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

export function serviceById(map: CodeMap, id: string | undefined): ServiceDef | undefined {
  return id ? map.services?.find((s) => s.id === id) : undefined;
}

export const nameOf = (map: CodeMap, id: string): string => serviceById(map, id)?.name ?? id;

/** "postgres/shop" for `svc-postgres/shop`; "orders' own database" for `own:svc-orders`. */
export function dbLabel(map: CodeMap, db: string | undefined): string {
  if (!db) return "";
  if (db.startsWith("own:")) {
    const who = nameOf(map, db.slice(4));
    return `${who}${who.endsWith("s") ? "'" : "'s"} own database (no address for it in the config)`;
  }
  const [svc, ...rest] = db.split("/");
  return [nameOf(map, svc), ...rest].join("/");
}

export const KIND_WORDS: Record<ServiceDef["kind"], string> = {
  app: "app",
  db: "database",
  cache: "cache",
  broker: "message broker",
  gateway: "gateway",
  placeholder: "one of this system's own services, code not in this workspace",
};

/** A line in a config file that forwards requests (next.config rewrite, proxy, nginx, Ingress). */
function gatewayAt(map: CodeMap, e: Evidence): string | undefined {
  const g = map.gateways?.find((r) => r.evidence.file === e.file && r.evidence.line === e.line);
  if (g) return { "next-rewrite": "rewrite", "vite-proxy": "proxy", "cra-proxy": "proxy", "angular-proxy": "proxy", nginx: "nginx rule", ingress: "Ingress rule", httproute: "HTTPRoute rule" }[g.kind];
  return map.files.find((f) => f.path === e.file)?.configKind === "gateway" ? "rewrite" : undefined;
}

/** ", via web/next.config.js:4 (rewrite), resolved through docker-compose.yml:8" — the config lines behind an edge. */
export function configTail(map: CodeMap, e: MapEdge): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of e.evidence) {
    if (v.role !== "config" || seen.has(at(v))) continue;
    seen.add(at(v));
    const g = gatewayAt(map, v);
    out.push(g ? `via ${at(v)} (${g})` : `resolved through ${at(v)}`);
  }
  return out.length ? `, ${out.slice(0, 3).join(", ")}` : "";
}

const OUT_WORDS: Record<string, string> = {
  imports: "imports",
  calls: "calls",
  "calls-route": "sends a request to",
  reads: "reads table",
  writes: "writes table",
  defines: "defines table",
  "uses-service": "uses",
  "calls-rpc": "calls (gRPC)",
  publishes: "puts messages on",
  consumes: "picks messages up from",
  "depends-on": "is started after",
  proxies: "passes requests on to",
};
const IN_WORDS: Record<string, string> = {
  imports: "is imported by",
  calls: "is called by",
  "calls-route": "is requested from",
  reads: "is read by",
  writes: "is written by",
  defines: "is defined by",
  "uses-service": "is used by",
  "calls-rpc": "is called (gRPC) by",
  publishes: "gets messages from",
  consumes: "has its messages picked up by",
  "depends-on": "is started before",
  proxies: "gets requests passed on by",
};

/** " (users service)" after a name that lives in another service than `selfId`. */
function crossSuffix(map: CodeMap, selfId: string, other: MapNode | undefined): string {
  if (!isSystem(map) || !other) return "";
  const self = nodeOf(map, selfId)?.service;
  const svc = serviceById(map, other.service);
  if (other.kind === "channel") return ` (${other.tech ?? "channel"}${svc ? ` on ${svc.name}` : ""})`;
  if (other.kind === "table") return other.service !== self && other.db ? ` (in ${dbLabel(map, other.db)})` : "";
  if (!svc || other.service === self) return "";
  if (svc.kind === "placeholder") return ` (${svc.name} service, code not in this workspace)`;
  return ` (${svc.name} service)`;
}

/** A line of code, not a config line or the user's answer. */
const isCode = (v: Evidence) => !v.role || v.role === "code";

/** " [YOU TOLD WALKMYCODE: VITE_API_URL → backend; …]" when an arrow rests on the user's answer (docs/SERVICES.md §13). */
export function toldTail(e: MapEdge): string {
  const told = [...new Set(e.evidence.filter((v) => v.role === "user").map((v) => v.text.replace(/^you told (?:WalkMyCode|Lantern): /, "")))];
  return told.length ? ` [YOU TOLD WALKMYCODE: ${told.join("; ")} — the user's answer, not proven by the code]` : "";
}

/** One link of the map in words, from the side of `from ? e.from : e.to`, with its evidence. */
export function describeEdge(map: CodeMap, e: MapEdge, from: boolean): string {
  const selfId = from ? e.from : e.to;
  const other = nodeOf(map, from ? e.to : e.from);
  const name = other ? `${other.name} [${other.id}]` : from ? e.to : e.from;
  const code = e.evidence.filter(isCode);
  const ev = code[0] ?? e.evidence[0];
  const trig = ev?.trigger ? ` (triggered by <${ev.trigger.element}> "${ev.trigger.label ?? ""}" at ${ev.file}:${ev.trigger.line})` : "";
  const more = code.length > 1 ? ` (+${code.length - 1} more place${code.length > 2 ? "s" : ""})` : "";
  const fns = e.toFns?.length ? ` → ${e.toFns.slice(0, 5).join(", ")}` : "";
  const conf = e.confidence === "likely" ? ` [GUESS: ${e.note ?? "matched by pattern"}]` : "";
  const verb = (from ? OUT_WORDS : IN_WORDS)[e.kind] ?? e.kind;
  return `${verb} ${name}${crossSuffix(map, selfId, other)}${fns} — ${at(ev)}${more}${trig}${configTail(map, e)}${conf}${toldTail(e)}`;
}

/** "POST /api/v1/book/*\/review (web/lib/api.ts:397, +2 more)": doors the code asks a service for that it doesn't have. */
export function missingLines(map: CodeMap, serviceId: string | undefined, max: number): string[] {
  const all = (map.missingRoutes ?? []).filter((m) => !serviceId || m.service === serviceId);
  const rows = all.slice(0, max).map((m) => `${serviceId ? "" : `${nameOf(map, m.service)}: `}${m.method ? `${m.method} ` : ""}${m.path} (${at(m.calls[0])}${m.calls.length > 1 ? `, +${m.calls.length - 1} more` : ""})${m.confidence === "likely" ? ` [GUESS: ${m.note ?? "worked out from the other requests"}]` : ""}`);
  if (all.length > max) rows.push(`…${all.length - max} more`);
  return rows;
}

/** The settings requests are built on with no value in the repo, and what the user told WalkMyCode about them.
 * `open` also lists the ones not answered yet. */
export function settingLines(map: CodeMap, open: boolean): string[] {
  const bases = (map.unresolvedBases ?? []).filter((b) => open || b.answer?.service);
  if (!bases.length) return [];
  const out = [`## Settings with no value in the repo (request addresses are built on them)`];
  for (const b of bases) {
    const who = b.services.map((id) => nameOf(map, id)).join(", ") || "code in no service";
    const where = b.reads[0] ? `read at ${at(b.reads[0])}; ` : "";
    const told = map.edges.filter((e) => e.evidence.some((v) => v.role === "user" && v.setting === b.setting)).length;
    const target = b.answer?.service === b.placeholder ? "a separate backend whose code isn't here" : b.answer?.service ? nameOf(map, b.answer.service) : "";
    const standIn = map.services?.find((s) => s.kind === "placeholder" && s.setting === b.setting);
    const said = b.answer?.service
      ? `YOU TOLD WALKMYCODE it points at ${target}: ${told} arrow${told === 1 ? "" : "s"} rest on that answer, not on code`
      : `${b.answer ? "the user said it points outside this workspace, or is not sure" : "not answered"}; requests built on it are matched by their path only${standIn ? `, and the ones no route here answers go to a stand-in [svc-int:${standIn.id}] (GUESS)` : ""}`;
    out.push(`- ${b.setting} (${where}${b.calls} request${b.calls === 1 ? "" : "s"} from ${who}): ${said}`);
  }
  return out;
}

/** Public addresses the code calls and whose they are ("Whose address is this?"): what deploy config says, what the user
 * said, and (with `open`) the guess when one app's routes answer most of an address's requests. */
export function hostLines(map: CodeMap, open: boolean): string[] {
  const hosts = (map.publicHosts ?? []).filter((h) => h.config || h.answer || (open && h.guess));
  if (!hosts.length) return [];
  const out = [`## Public addresses the code calls (whose they are)`];
  for (const h of hosts) {
    const who = h.services.map((id) => nameOf(map, id)).join(", ") || "code in no service";
    const where = h.setAt[0] ? `set at ${at(h.setAt[0])}; ` : "";
    const cfg = h.config ? `deploy config says it is ${nameOf(map, h.config.service)} (${at(h.config.evidence)})` : "";
    const said = h.answer?.service
      ? `YOU TOLD WALKMYCODE it is ${nameOf(map, h.answer.service)}: arrows to it rest on that answer, not on code`
      : h.answer
        ? `the user said it is another company's, or is not sure${cfg ? ` (although ${cfg})` : ""}; requests to it are matched by their path only`
        : cfg
          ? `${cfg}, so requests to it resolve as to that service`
          : `not answered; ${h.matches[h.guess!] ?? 0} of its requests match ${nameOf(map, h.guess!)}'s routes, so it may be ${nameOf(map, h.guess!)} (GUESS); requests to it are matched by their path only`;
    out.push(`- ${h.origin} (${where}${h.calls} request${h.calls === 1 ? "" : "s"} from ${who}): ${said}`);
  }
  return out;
}

/** Setting names in any service's config whose value is this service's address, e.g. USERS_URL in web (docker-compose.yml:8). */
export function addressSettings(map: CodeMap, s: ServiceDef): { name: string; in: string; file: string; line: number }[] {
  const hosts = new Set(s.hostnames.map((h) => h.toLowerCase()));
  const out: { name: string; in: string; file: string; line: number }[] = [];
  for (const o of map.services ?? []) {
    for (const [name, v] of Object.entries(o.env ?? {})) {
      const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/?#\s,]+)/i.exec(v.value.trim());
      const host = m?.[1]?.toLowerCase();
      if (!host || !(hosts.has(host) || hosts.has(host.replace(/:\d+$/, "")))) continue;
      out.push({ name, in: o.name, file: v.file, line: v.line });
    }
  }
  return out;
}

/** The edges behind a service link, likely ones counted. */
export function linkEdges(map: CodeMap, l: ServiceLink): { edges: MapEdge[]; guesses: number } {
  const ids = new Set(l.edgeIds);
  const edges = map.edges.filter((e) => ids.has(e.id));
  return { edges, guesses: edges.filter((e) => e.confidence === "likely").length };
}

/** "web → users" or "orders → users via kafka topic orders.created [chan:…]". */
export function linkTitle(map: CodeMap, l: ServiceLink): string {
  const via = l.via ? nodeOf(map, l.via) : undefined;
  return `${nameOf(map, l.from)} → ${nameOf(map, l.to)}${via ? ` via ${via.tech ?? via.kind} ${via.name} [${via.id}]` : ""}`;
}

/** One service link with up to `max` of the node edges that prove it, each with its code and config lines. */
export function describeLink(map: CodeMap, l: ServiceLink, max: number): string[] {
  const found = linkEdges(map, l);
  const guesses = found.guesses;
  // Proven ones first, and among those the ones a config line resolved.
  const rank = (e: MapEdge) => (e.confidence === "certain" ? 0 : 2) + (e.evidence.some((v) => v.role === "config") ? 0 : 1);
  const edges = [...found.edges].sort((a, b) => rank(a) - rank(b));
  if (l.kind === "depends-on") return [`- ${linkTitle(map, l)}: depends-on${l.confidence === "likely" ? " (GUESS)" : ""} (${l.note ?? "declared in the config"}; start-up order, not a call)`];
  if (l.kind === "proxies") return [`- ${linkTitle(map, l)}: proxies${l.confidence === "likely" ? " (GUESS)" : ""} (${l.note ?? "declared in the config"}; a gateway rule, not a call seen in code)`];
  const g = guesses ? `, ${guesses} guess${guesses > 1 ? "es" : ""}` : "";
  const toldN = found.edges.filter((e) => e.evidence.some((v) => v.role === "user")).length;
  const told = toldN ? `, ${toldN} resting on what YOU TOLD WALKMYCODE (not proven by code)` : "";
  const why = l.confidence === "likely" ? ` [GUESS: ${l.note ?? "matched by pattern"}]` : "";
  const out = [`- ${linkTitle(map, l)}: ${l.kind} ×${l.count}${g}${told}${why}`];
  for (const e of edges.slice(0, max)) {
    const n = nodeOf(map, e.from);
    out.push(`  - ${n?.name ?? e.from} [${e.from}] ${describeEdge(map, e, true)}`);
  }
  if (edges.length > max) out.push(`  - …${edges.length - max} more; query_map a node id for the rest`);
  return out;
}

/** Nodes that belong to a service, by kind. */
export function nodesIn(map: CodeMap, id: string): MapNode[] {
  return map.nodes.filter((n) => n.service === id);
}

/** Tables kept in a db/cache service's database (db id `svc-postgres` or `svc-postgres/shop`). */
export function tablesInDb(map: CodeMap, id: string): MapNode[] {
  return map.nodes.filter((n) => n.kind === "table" && n.db && (n.db === id || n.db.startsWith(id + "/")));
}

/** Services that read or write a db/cache service, from the map's links and the tables' usedBy. */
export function usersOfDb(map: CodeMap, id: string): string[] {
  const users = new Set<string>();
  for (const l of map.system?.links ?? []) if (l.to === id && (l.kind === "reads" || l.kind === "writes")) users.add(l.from);
  for (const t of tablesInDb(map, id)) for (const u of t.usedBy ?? []) users.add(u);
  return [...users].map((u) => nameOf(map, u));
}

/** The code lines that call a placeholder, e.g. services/orders/app/billing.py:8. */
export function callersOf(map: CodeMap, s: ServiceDef): { from: string; code?: Evidence; config?: Evidence }[] {
  const node = `svc-int:${s.id}`;
  return map.edges
    .filter((e) => e.to === node)
    .map((e) => ({ from: e.from, code: e.evidence.find(isCode), config: e.evidence.find((v) => v.role === "config") }));
}

/** A query like "users", "the users service", "svc-users" or "users:8080" → that service.
 * The query is tried as written first, so a service named "user-service" or "web-app" is found by its own name. */
export function findService(map: CodeMap, q: string): ServiceDef | undefined {
  const raw = q.trim().toLowerCase().replace(/^the\s+/, "").trim();
  const bare = raw.replace(/[\s-]+(service|svc|app)$/, "").trim();
  const is = (ql: string) => (s: ServiceDef) =>
    s.id.toLowerCase() === ql || s.name.toLowerCase() === ql || `svc-int:${s.id}`.toLowerCase() === ql || s.hostnames.some((h) => h.toLowerCase() === ql);
  for (const ql of [raw, bare]) {
    if (!ql) continue;
    const hit = (map.services ?? []).find(is(ql));
    if (hit) return hit;
  }
  return undefined;
}

/** Everything query_map knows about one service: boundary, addresses, settings, doors, tables, links with evidence. */
export function describeService(map: CodeMap, s: ServiceDef): string {
  const out: string[] = [];
  const what = s.kind === "app" ? `${s.framework ? `${s.framework} ` : ""}app` : KIND_WORDS[s.kind];
  const where = s.areas.length ? `, in ${s.areas.map((a) => `${a}/`).join(", ")}` : "";
  out.push(`## ${s.name} service [${s.id}] — ${what}${where}${s.repo ? ` (repo ${s.repo})` : ""}${s.confidence === "likely" ? " (a guess: going by names, not config)" : ""}`);
  if (s.declared) out.push("- the team wrote this down (catalogue file); I did not see its code or config");
  if (s.evidence.length) out.push(`- why it is a service: ${s.evidence.slice(0, 4).map((e) => `${at(e)} \`${e.text}\``).join("; ")}`);
  if (s.image) out.push(`- image: ${s.image}${s.kind === "placeholder" ? " (built elsewhere)" : ""}`);
  if (s.hostnames.length) out.push(`- addresses other services use: ${s.hostnames.slice(0, 8).join(", ")}`);
  const dev = s.devHosts.filter((h) => h.startsWith("localhost"));
  if (dev.length) out.push(`- published on your machine: ${dev.join(", ")} (a request there is matched as a guess)`);
  const ports = s.ports.filter((p) => p.host || p.container).map((p) => (p.host && p.container ? `${p.host} → ${p.container} inside` : String(p.container ?? p.host)));
  if (ports.length) out.push(`- ports: ${ports.join(", ")}`);
  if (s.entry) out.push(`- start here: ${at(s.entry)} \`${s.entry.text}\``);
  const env = Object.entries(s.env ?? {});
  if (env.length) out.push(`- settings: ${env.slice(0, 20).map(([k, v]) => `${k}=${v.value} (${v.file}:${v.line})`).join("; ")}`);
  const addr = addressSettings(map, s).filter((a) => a.in !== s.name);
  if (addr.length) out.push(`- other services find it through: ${addr.slice(0, 10).map((a) => `${a.name} in ${a.in} (${a.file}:${a.line})`).join("; ")}`);
  if (s.dependsOn.length) out.push(`- started after (declared in the config, not a call): ${s.dependsOn.map((d) => nameOf(map, d)).join(", ")}`);
  if (s.kind === "placeholder") {
    const calls = callersOf(map, s);
    out.push(`- its code isn't in this workspace; add its folder to see inside${calls.length ? `. Called from ${calls.slice(0, 6).map((c) => `${at(c.code)}${c.config ? ` (address from ${at(c.config)})` : ""}`).join("; ")}` : ""}`);
  }
  const mine = nodesIn(map, s.id);
  const routes = mine.filter((n) => n.kind === "route" || n.kind === "rpc");
  if (routes.length) out.push(`- doors (${routes.length}): ${routes.slice(0, 30).map((n) => `${n.name} [${n.id}] ${n.file ?? ""}${n.line ? `:${n.line}` : ""}`).join("; ")}${routes.length > 30 ? `; …${routes.length - 30} more` : ""}`);
  const tables = s.kind === "app" ? mine.filter((n) => n.kind === "table") : tablesInDb(map, s.id);
  if (tables.length) out.push(`- tables (${tables.length}): ${tables.slice(0, 30).map((n) => `${n.name} [${n.id}]${n.db ? ` in ${dbLabel(map, n.db)}` : ""}`).join("; ")}`);
  if (s.kind === "db" || s.kind === "cache") {
    const users = usersOfDb(map, s.id);
    if (users.length) out.push(`- used by: ${users.join(", ")}`);
  }
  const chans = s.kind === "broker" ? mine.filter((n) => n.kind === "channel") : [];
  if (chans.length) out.push(`- carries: ${chans.map((n) => `${n.tech ?? "channel"} ${n.name} [${n.id}]`).join("; ")}`);
  const ui = mine.filter((n) => n.layer === "ui").length;
  const logic = mine.filter((n) => n.layer === "logic").length;
  if (ui || logic) out.push(`- inside: ${ui} pages/components, ${logic} logic modules (query_map a file for its links)`);
  const notFound = missingLines(map, s.id, 30);
  if (notFound.length) out.push(`- called but not found here (the code asks for these doors; ${s.name} has no such route): ${notFound.join("; ")}`);
  const links = (map.system?.links ?? []).filter((l) => l.from === s.id || l.to === s.id);
  out.push(links.length ? `## Links of the ${s.name} service` : `- no links to other services found by the parser`);
  for (const l of links) out.push(...describeLink(map, l, 8));
  return out.join("\n");
}

/** query_map("system"): every service in flow order and every link between them, with evidence. */
export function describeSystem(map: CodeMap): string {
  const out = [`# The system: ${map.services.filter((s) => s.kind === "app").length} app services, ${map.system.links.length} links between services`];
  for (const s of map.services) out.push(`- ${s.name} [${s.id}] — ${s.kind === "app" ? `${s.framework ? `${s.framework} ` : ""}app` : KIND_WORDS[s.kind]}${s.evidence[0] ? ` (${at(s.evidence[0])})` : ""}`);
  out.push("## Links between services");
  for (const l of map.system.links) out.push(...describeLink(map, l, 5));
  if (!map.system.links.length) out.push("- none found by the parser");
  return out.join("\n");
}
