"use client";
// Why an arrow or a service is on the map: the lines that prove it, each one
// opening in the Code panel. Config lines (docker-compose.yml, next.config.js,
// .env.example) carry a "config" chip; what the user told WalkMyCode about a
// setting carries "you told WalkMyCode" (docs/SERVICES.md §13). Shared by the
// Details tab for an arrow, a system-view link and a service card.
import type { CodeMap, Evidence, MapEdge, ServiceDef, ServiceLink } from "@/analyzer/types";
import { nodeById } from "@/lib/store";
import { indexOf } from "@/lib/mapIndex";
import { HostAnswer, SettingAnswer } from "./PointsAt";

type Open = (path: string, start: number, end?: number) => void;

const VERB: Record<string, string> = {
  imports: "uses code from",
  calls: "calls",
  "calls-route": "sends a request to",
  reads: "reads from",
  writes: "writes to",
  defines: "creates",
  "uses-service": "talks to",
  "calls-rpc": "calls (gRPC)",
  publishes: "puts messages on",
  consumes: "picks messages up from",
  "depends-on": "is started after",
  proxies: "passes requests on to",
};

function nameOf(map: CodeMap, id: string): string {
  return map.services.find((s) => s.id === id)?.name ?? nodeById(map, id)?.name ?? id;
}

/** The proving lines, one row each: file:line, the line itself, a config chip, what the user clicks. */
export function EvidenceList({ evidence, onOpen }: { evidence: Evidence[]; onOpen: Open }) {
  if (!evidence.length) return <p className="note">No line proves this one; it was declared, not seen in code.</p>;
  return (
    <div className="edges evidence">
      {evidence.map((ev, i) => (
        <div key={`${ev.file}:${ev.line}:${i}`} className="edge" title={ev.text} onClick={() => onOpen(ev.file, ev.line)}>
          {ev.role === "config" && <span className="evchip config">config</span>}
          {ev.role === "user" && (
            <span className="evchip user" title={`Your answer to “${ev.host ? "Whose address is this?" : "Where does this point?"}”, not something the code proves`}>
              you told WalkMyCode
            </span>
          )}
          <span className="who mono">
            {ev.file}:{ev.line}
          </span>
          <span className="how mono ev-text">{ev.text}</span>
          {ev.trigger && (
            <span className="trig">
              ← the {ev.trigger.label ? `“${ev.trigger.label}” ` : ""}
              {ev.trigger.element}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One arrow between two cards: "why is this arrow here?" */
export function EdgeDetails({ map, edge, onOpen, onSelect }: { map: CodeMap; edge: MapEdge; onOpen: Open; onSelect: (id: string) => void }) {
  const from = nodeById(map, edge.from);
  const to = nodeById(map, edge.to);
  const svcName = (id?: string) => (id && map.system.kind === "services" ? map.services.find((s) => s.id === id)?.name : undefined);
  const fromSvc = svcName(from?.service);
  const toSvc = svcName(to?.service);
  const told = toldSettings(edge);
  const hosts = toldHosts(edge);
  return (
    <div className="inspect">
      <span className="evchip why">why is this arrow here?</span>
      <h3 className={from?.kind === "route" || to?.kind === "route" ? "mono" : ""} style={{ fontSize: "var(--text)", fontWeight: 650 }}>
        <button className="link" style={{ color: "inherit", textDecoration: "none" }} onClick={() => onSelect(edge.from)}>
          {from?.name ?? edge.from}
        </button>{" "}
        <span className="kind">{VERB[edge.kind] ?? edge.kind}</span>{" "}
        <button className="link" style={{ color: "inherit", textDecoration: "none" }} onClick={() => onSelect(edge.to)}>
          {to?.name ?? edge.to}
        </button>
      </h3>
      {fromSvc && toSvc && fromSvc !== toSvc && (
        <div className="kind">
          from the {fromSvc} service to the {toSvc} service
        </div>
      )}
      <div className="kind">
        {edge.confidence === "certain" ? (told.length || hosts.length ? "You told WalkMyCode where this goes: the request is in the code, where it lands is your answer." : "The parser found this.") : "A guess"}
        {edge.note ? ` — ${edge.note}` : edge.confidence === "likely" ? "." : ""}
      </div>
      <div className="label">{told.length || hosts.length ? "The lines behind it" : "The lines that prove it"}</div>
      <EvidenceList evidence={edge.evidence} onOpen={onOpen} />
      {told.length + hosts.length > 0 && (
        <>
          <div className="label">You told WalkMyCode</div>
          {told.map((s) => (
            <SettingAnswer key={s} map={map} setting={s} />
          ))}
          {hosts.map((h) => (
            <HostAnswer key={h} map={map} host={h} />
          ))}
        </>
      )}
    </div>
  );
}

/** The settings whose answers an arrow rests on. */
export function toldSettings(edge: MapEdge): string[] {
  return [...new Set(edge.evidence.filter((v) => v.role === "user" && v.setting).map((v) => v.setting!))];
}

/** The public addresses whose answers an arrow rests on ("Whose address is this?"). */
export function toldHosts(edge: MapEdge): string[] {
  return [...new Set(edge.evidence.filter((v) => v.role === "user" && v.host).map((v) => v.host!))];
}

/** A system-view arrow: the node arrows behind it, grouped by where they land, with counts. */
export function LinkDetails({ map, links, onOpen, onSelect, onTour }: { map: CodeMap; links: ServiceLink[]; onOpen: Open; onSelect: (id: string) => void; onTour?: (links: ServiceLink[]) => void }) {
  if (!links.length) return null;
  const from = nameOf(map, links[0].from);
  const to = nameOf(map, links[0].to);
  const edgeOf = new Map(map.edges.map((e) => [e.id, e]));
  return (
    <div className="inspect">
      <span className="evchip why">why is this arrow here?</span>
      <h3>
        {from} → {to}
      </h3>
      {onTour && links.some((l) => l.edgeIds.length) && (
        <div className="row">
          <button className="ctl compact primary" onClick={() => onTour(links)}>
            Tour how {from} talks to {to}
          </button>
        </div>
      )}
      {links.map((l) => {
        const edges = l.edgeIds.map((id) => edgeOf.get(id)).filter((e): e is MapEdge => !!e);
        const byTarget = new Map<string, MapEdge[]>();
        for (const e of edges) {
          // For a message link the far end is the other service's code; otherwise where the arrow lands.
          const key = e.kind === "consumes" || e.kind === "publishes" ? (e.from.startsWith("chan:") ? e.from : e.to) : e.to;
          byTarget.set(key, [...(byTarget.get(key) ?? []), e]);
        }
        const declaredAt = l.kind === "depends-on" ? declarationOf(map, l.from) : [];
        return (
          <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="label">
              {VERB[l.kind] ?? l.kind}
              {l.via ? ` via ${nameOf(map, l.via)}` : ""} · {l.count || "declared"}
              {l.confidence === "likely" && <span className="guess" style={{ marginLeft: 6 }}>guess</span>}
            </div>
            {l.note && <div className="kind">{l.note}</div>}
            {l.kind === "depends-on" && <EvidenceList evidence={declaredAt} onOpen={onOpen} />}
            {[...byTarget.entries()].map(([target, es]) => (
              <div key={target} className="linkgroup">
                <div className="edge" onClick={() => onSelect(target)}>
                  <span className="who">{nameOf(map, target)}</span>
                  <span className="how">×{es.length}</span>
                  {es.some((e) => e.confidence === "likely") && <span className="guess">{guesses(es.filter((e) => e.confidence === "likely").length)}</span>}
                  {es.some(isTold) && <span className="evchip user">{es.filter(isTold).length} you told WalkMyCode</span>}
                </div>
                <EvidenceList evidence={dedupe(es.flatMap((e) => e.evidence))} onOpen={onOpen} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function guesses(n: number): string {
  return `${n} ${n === 1 ? "guess" : "guesses"}`;
}

/** An arrow that rests on what the user told WalkMyCode. */
const isTold = (e: MapEdge) => e.evidence.some((v) => v.role === "user");

/** Doors called but not found, listed in a service's Details (the rest are in the map's warnings). */
const MISSING_SHOWN = 100;

function dedupe(evs: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evs.filter((e) => {
    const k = `${e.file}:${e.line}${e.role === "user" ? ":user" : ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Where a service's startup dependencies are written: its config lines (the compose entry). */
function declarationOf(map: CodeMap, serviceId: string): Evidence[] {
  const s = map.services.find((x) => x.id === serviceId);
  return (s?.evidence ?? []).filter((e) => e.role === "config").slice(0, 1);
}

const KIND_WORDS: Record<ServiceDef["kind"], string> = {
  app: "an app — code that runs on its own",
  db: "a database this system runs",
  cache: "a cache this system runs",
  broker: "a message broker — queues and topics live here",
  gateway: "a gateway — it passes requests on to other services",
  placeholder: "one of this system's own services — its code isn't in this workspace",
};

/** A service card: what it is, how it starts, where it listens, and why WalkMyCode thinks it is a service. */
export function ServiceDetails({
  map,
  service: s,
  onOpen,
  onOpenService,
  onExplain,
  onTrace,
  onLinks,
}: {
  map: CodeMap;
  service: ServiceDef;
  onOpen: Open;
  onOpenService?: (id: string) => void;
  onExplain?: (s: ServiceDef) => void;
  onTrace?: (s: ServiceDef) => void;
  onLinks?: (links: ServiceLink[]) => void;
}) {
  const routes = map.nodes.filter((n) => n.service === s.id && (n.kind === "route" || n.kind === "rpc")).length;
  const tables = map.nodes.filter((n) => n.service === s.id && n.kind === "table").length;
  const out = map.system.links.filter((l) => l.from === s.id);
  const edgeOf = indexOf(map).edge;
  const toldLink = (l: ServiceLink) => l.edgeIds.some((id) => !!edgeOf.get(id) && isTold(edgeOf.get(id)!));
  const missing = (map.missingRoutes ?? []).filter((m) => m.service === s.id);
  const ins = map.system.links.filter((l) => l.to === s.id);
  const env = Object.entries(s.env);
  return (
    <div className="inspect">
      <h3>{s.name} service</h3>
      <div className="kind">
        {KIND_WORDS[s.kind]}
        {s.framework ? ` · ${s.framework}` : ""}
        {s.kind === "app" ? ` · ${routes} routes · ${tables} tables` : ""}
        {s.image ? ` · image ${s.image}` : ""}
      </div>
      {s.confidence === "likely" && <div className="kind">A guess — I’m going by the folder or the code, not a config file.</div>}
      <div className="row">
        {onOpenService && s.kind === "app" && s.areas.length > 0 && (
          <button className="ctl compact primary" onClick={() => onOpenService(s.id)}>
            Open its lanes
          </button>
        )}
        {onExplain && (
          <button className="ctl compact" onClick={() => onExplain(s)}>
            Explain this service
          </button>
        )}
        {onTrace && (
          <button className="ctl compact" onClick={() => onTrace(s)}>
            Trace
          </button>
        )}
      </div>
      {s.entry && (
        <>
          <div className="label">Start here</div>
          <EvidenceList evidence={[s.entry]} onOpen={onOpen} />
        </>
      )}
      {(s.hostnames.length > 0 || s.devHosts.length > 0) && (
        <>
          <div className="label">Where it listens</div>
          <div className="kind mono">
            {s.hostnames.join(", ")}
            {s.devHosts.length ? ` · on your machine: ${s.devHosts.join(", ")}` : ""}
          </div>
        </>
      )}
      {(out.length > 0 || ins.length > 0) && (
        <>
          <div className="label">Links</div>
          <div className="edges">
            {[...out.map((l) => ({ l, dir: "out" as const })), ...ins.map((l) => ({ l, dir: "in" as const }))].map(({ l, dir }) => (
              <div key={`${dir}:${l.id}`} className="edge" onClick={() => onLinks?.([l])}>
                <span className="how">{dir === "out" ? VERB[l.kind] ?? l.kind : `← ${VERB[l.kind] ?? l.kind}`}</span>
                <span className="who">{nameOf(map, dir === "out" ? l.to : l.from)}</span>
                {l.count > 0 && <span className="how">×{l.count}</span>}
                {l.kind === "depends-on" && <span className="how">declared</span>}
                {l.confidence === "likely" && (
                  <span className="guess" title={l.note}>
                    guess
                  </span>
                )}
                {toldLink(l) && <span className="evchip user">you told WalkMyCode</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {missing.length > 0 && (
        <>
          <div className="label">Called but not found in {s.name}</div>
          <p className="note">
            The code asks the {s.name} service for {missing.length === 1 ? "this door" : `these ${missing.length} doors`}, but I can’t find {missing.length === 1 ? "it" : "them"} among its routes.
          </p>
          <div className="edges">
            {missing.slice(0, MISSING_SHOWN).map((m) => (
              <div key={`${m.method ?? ""} ${m.path}`} className="edge" title={m.note} onClick={() => onOpen(m.calls[0].file, m.calls[0].line)}>
                <span className="who mono">
                  {m.method ? `${m.method} ` : ""}
                  {m.path}
                </span>
                <span className="how mono ev-text">
                  {m.calls[0].file}:{m.calls[0].line}
                  {m.calls.length > 1 ? ` +${m.calls.length - 1}` : ""}
                </span>
                {m.confidence === "likely" && (
                  <span className="guess" title={m.note}>
                    guess
                  </span>
                )}
              </div>
            ))}
          </div>
          {missing.length > MISSING_SHOWN && <p className="note">…and {missing.length - MISSING_SHOWN} more.</p>}
        </>
      )}
      {env.length > 0 && (
        <>
          <div className="label">Settings</div>
          <div className="edges">
            {env.map(([k, v]) => (
              <div key={k} className="edge" title={`${v.file}:${v.line}`} onClick={() => onOpen(v.file, v.line)}>
                <span className="who mono">{k}</span>
                <span className="how mono ev-text">{v.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="label">Why is this a service?</div>
      <EvidenceList evidence={s.evidence} onOpen={onOpen} />
    </div>
  );
}
