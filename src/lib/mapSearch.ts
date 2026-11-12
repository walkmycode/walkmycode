// Search everything on a map: names, files, paths, hostnames and env settings
// (USERS_URL finds the users service). Results are grouped by the service they
// are in. Prefixes narrow it: svc:, route:, table:, chan:. Used by the go-to
// bar (Palette.tsx) and the fly-through's name resolution (flyPath.ts), so it
// runs in the browser on every keystroke: no AI, nothing but the map.
// No React here, so tests can load it.
import type { CodeMap, MapNode, ServiceDef } from "@/analyzer/types";

export interface Hit {
  kind: "service" | "node" | "file";
  id: string;
  label: string;
  sub: string;
  score: number;
}
export interface HitGroup {
  group: string;
  hits: Hit[];
}

const PREFIX = /^(svc|route|table|chan):\s*/i;
const KIND_OF: Record<string, MapNode["kind"][]> = { svc: ["service"], route: ["route"], table: ["table"], chan: ["channel"] };

/** Host of a URL-ish setting value: "http://users:8080/x" → ["users:8080", "users"]. */
function hostsOf(value: string): string[] {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)(?::(\d+))?/i.exec(value.trim());
  if (!m) return [];
  const host = m[1].toLowerCase();
  return m[2] ? [`${host}:${m[2]}`, host] : [host];
}

function score(text: string | undefined, q: string, base: number): number {
  if (!text) return Infinity;
  const t = text.toLowerCase();
  if (t === q) return base;
  if (t.startsWith(q)) return base + 1;
  if (t.includes(q)) return base + 2;
  return Infinity;
}

/** Everything that matches, best first, grouped by where it lives. Pure, for tests. */
export function searchMap(map: CodeMap, raw: string, limit = 60): HitGroup[] {
  let q = raw.trim();
  const pre = PREFIX.exec(q);
  const only = pre ? KIND_OF[pre[1].toLowerCase()] : null;
  if (pre) q = q.slice(pre[0].length);
  const ql = q.toLowerCase();
  if (!ql && !only) return [];
  const services = map.system.kind === "services";
  const svcById = new Map(map.services.map((s) => [s.id, s]));
  const hits: (Hit & { group: string })[] = [];

  // Services by name, hostname, image, and the settings that point at them.
  if (services && (!only || only.includes("service"))) {
    const byHost = new Map<string, ServiceDef>();
    for (const s of map.services) for (const h of [...s.hostnames, ...s.devHosts]) byHost.set(h.toLowerCase(), s);
    const best = new Map<string, Hit>();
    const put = (s: ServiceDef, sc: number, why: string) => {
      if (sc === Infinity) return;
      const cur = best.get(s.id);
      if (!cur || sc < cur.score) best.set(s.id, { kind: "service", id: s.id, label: `${s.name} service`, sub: why, score: sc });
    };
    for (const s of map.services) {
      put(s, ql ? score(s.name, ql, 0) : 5, s.framework ?? s.kind);
      if (!ql) continue;
      put(s, Math.min(...[...s.hostnames, ...s.devHosts].map((h) => score(h, ql, 2))), `listens at ${[...s.hostnames, ...s.devHosts].find((h) => h.toLowerCase().includes(ql)) ?? ""}`);
      if (s.image) put(s, score(s.image, ql, 3), `image ${s.image}`);
      for (const [k, v] of Object.entries(s.env)) {
        const sc = score(k, ql, 1);
        if (sc === Infinity) continue;
        put(s, sc + 2, `sets ${k} (${v.file}:${v.line})`);
        const target = hostsOf(v.value)
          .map((h) => byHost.get(h))
          .find((x) => !!x);
        if (target) put(target, sc, `${k} points here (${v.file}:${v.line})`);
      }
    }
    for (const h of best.values()) hits.push({ ...h, group: "Services" });
  }

  // Cards on the map by name, file, path or id.
  const nodeFiles = new Set<string>();
  for (const n of map.nodes) {
    if (n.file && n.kind !== "route") nodeFiles.add(n.file);
    if (only && !only.includes(n.kind)) continue;
    const sc = ql ? Math.min(score(n.name, ql, 0), score(n.file, ql, 3), score(n.path, ql, 3), score(n.id, ql, 4)) : 5;
    if (sc === Infinity) continue;
    const s = n.service ? svcById.get(n.service) : undefined;
    const group = !n.service && n.layer === "external" ? "outside" : services && s ? `in ${s.name} service` : `in ${map.name}`;
    hits.push({ kind: "node", id: n.id, label: n.name, sub: n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : n.kind, score: sc, group });
  }

  // Files that are not a card (config files, skipped files) open in the Code panel.
  if (!only && ql) {
    for (const f of map.files) {
      if (nodeFiles.has(f.path) || f.skipped === "secret") continue;
      const sc = score(f.path, ql, 3);
      if (sc === Infinity) continue;
      hits.push({ kind: "file", id: f.path, label: f.path.split("/").pop() ?? f.path, sub: f.configKind ? `${f.path} · ${f.configKind} config` : f.path, score: sc, group: "Files" });
    }
  }

  hits.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  const groups = new Map<string, Hit[]>();
  let n = 0;
  for (const { group, ...h } of hits) {
    if (n >= limit) break;
    const g = groups.get(group) ?? [];
    if (g.length >= 12) continue;
    g.push(h);
    groups.set(group, g);
    n++;
  }
  const order = (g: string) => (g === "Services" ? 0 : g === "Files" ? 2 : 1);
  return [...groups.entries()].map(([group, hits]) => ({ group, hits })).sort((a, b) => order(a.group) - order(b.group));
}
