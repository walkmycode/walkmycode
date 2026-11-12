// Brings a saved map up to the current version. A v1 map (one repo, no
// services) becomes a v2 monolith: the new fields are filled in, every node
// gets its `service`, and no id is ever rewritten. Called wherever a map
// comes back from storage: store.ts, api/demo/route.ts, scripts/index.ts.
// What the user told WalkMyCode ("Where does this point?", "Whose address is this?") rides along untouched.
import type { CodeMap, MapNode, RepoRef, ServiceDef } from "./types";

/** "My Shop API" → "my-shop-api": the stable part of a ServiceDef.id. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
}

export function serviceId(name: string): string {
  return `svc-${slug(name)}`;
}

function countLayers(nodes: MapNode[]): ServiceDef["counts"] {
  const counts = { ui: 0, api: 0, logic: 0, data: 0 };
  for (const n of nodes) if (n.layer in counts) counts[n.layer as keyof typeof counts]++;
  return counts;
}

/** The single app service a one-repo map without config files gets. */
export function monolithService(name: string, areas: string[], nodes: MapNode[], extra: Partial<ServiceDef> = {}): ServiceDef {
  return {
    id: serviceId(name),
    name,
    kind: "app",
    areas: [...areas],
    hostnames: [],
    devHosts: [],
    ports: [],
    env: {},
    dependsOn: [],
    evidence: [],
    confidence: "likely",
    counts: countLayers(nodes),
    ...extra,
  };
}

type AnyMap = Partial<CodeMap> & { version?: number; name?: string; nodes?: MapNode[] };

/** v1 → v2 (additive), or a v2 map with any missing field filled. Ids are never rewritten. */
export function upgradeMap(raw: unknown, kind: RepoRef["kind"] = "local"): CodeMap {
  const m = (raw ?? {}) as AnyMap;
  const name = m.name ?? "repo";
  const nodes = m.nodes ?? [];
  const areas = m.areas ?? [];
  const edges = m.edges ?? [];
  const services = m.services?.length ? m.services : [monolithService(name, areas, nodes, { evidence: firstAnchor(nodes) })];
  const system = m.system ?? { kind: "monolith" as const, links: [] };
  const app = services.find((s) => s.kind === "app") ?? services[0];
  if (app && system.kind !== "services") {
    for (const n of nodes) if (n.layer !== "external" && n.service === undefined) n.service = app.id;
  }
  const stats: Partial<CodeMap["stats"]> = m.stats ?? {};
  return {
    version: 2,
    name,
    generatedAt: m.generatedAt ?? new Date().toISOString(),
    repos: m.repos?.length ? m.repos : [{ label: name, prefix: "", kind }],
    system,
    services,
    gateways: m.gateways ?? [],
    areas,
    files: m.files ?? [],
    nodes,
    edges,
    warnings: m.warnings ?? [],
    // Settings with no value, public addresses, what the user told WalkMyCode about them, and doors called but not found, as they are.
    ...(m.unresolvedBases?.length ? { unresolvedBases: m.unresolvedBases } : {}),
    ...(m.publicHosts?.length ? { publicHosts: m.publicHosts } : {}),
    ...(m.missingRoutes?.length ? { missingRoutes: m.missingRoutes } : {}),
    stats: {
      files: stats.files ?? (m.files?.length ?? 0),
      parsed: stats.parsed ?? 0,
      routes: stats.routes ?? nodes.filter((n) => n.kind === "route").length,
      tables: stats.tables ?? nodes.filter((n) => n.kind === "table").length,
      edges: stats.edges ?? edges.length,
      likely: stats.likely ?? edges.filter((e) => e.confidence === "likely").length,
      ms: stats.ms ?? 0,
      services: stats.services ?? services.length,
      links: stats.links ?? system.links.length,
      crossService: stats.crossService ?? 0,
      ...(stats.assets ? { assets: stats.assets } : {}),
      ...(stats.otherCode ? { otherCode: stats.otherCode } : {}),
    },
  };
}

/** The best "this is where the app starts" line an old map still holds: its first route, else its first file. */
function firstAnchor(nodes: MapNode[]) {
  const n = nodes.find((x) => x.kind === "route" && x.file) ?? nodes.find((x) => x.file);
  return n?.file ? [{ file: n.file, line: n.line ?? 1, text: n.name, role: "code" as const }] : [];
}
