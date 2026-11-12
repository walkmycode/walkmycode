"use client";
// What one node is connected to, in plain words, each link backed by a line.
import type { CodeMap, MapEdge, MapNode } from "@/analyzer/types";
import { edgesOf, nodeById } from "@/lib/store";
import { SettingsList } from "./PointsAt";

interface Props {
  map: CodeMap;
  selected: string | null;
  onOpen: (path: string, start: number, end?: number) => void;
  onSelect: (id: string) => void;
  onExplain: (node: MapNode) => void;
  onTrace: (node: MapNode) => void;
  onTour: (node: MapNode) => void;
}

const OUT_WORDS: Record<string, string> = { imports: "uses code from", calls: "calls", "calls-route": "sends a request to", reads: "reads from", writes: "writes to", defines: "creates", "uses-service": "talks to", "calls-rpc": "calls (gRPC)", publishes: "puts messages on", consumes: "picks messages up from", "depends-on": "is started after", proxies: "passes requests on to" };
const IN_WORDS: Record<string, string> = { imports: "is used by", calls: "is called by", "calls-route": "is requested by", reads: "is read by", writes: "is written by", defines: "is created in", "uses-service": "is used by", "calls-rpc": "is called (gRPC) by", publishes: "gets messages from", consumes: "is read by", "depends-on": "is started before", proxies: "gets requests passed on by" };

/** What a card is, in a beginner's words. With the map, one of this system's own
 * services is told apart from another company's API (never "another company" for those),
 * and a public address one of the apps may be is asked about, not called another company's. */
export function kindWord(n: MapNode, map?: CodeMap): string {
  switch (n.kind) {
    case "route":
      return `${n.method === "ANY" ? "" : n.method + " "}route — a door the app knocks on`;
    case "table": {
      const shared = map && n.usedBy && n.usedBy.length > 1 ? `; shared by ${n.usedBy.map((id) => serviceName(map, id)).join(" and ")}` : "";
      return `database table — where rows are kept${shared}`;
    }
    case "service": {
      if (!n.internal) {
        // A public address the code calls ("Whose address is this?"): perhaps one of yours, when an app's routes answer its requests.
        const h = map?.publicHosts?.find((x) => x.host === n.name.replace(/:(80|443)$/, ""));
        if (h?.answer && !h.answer.service) return "outside service — you said this address is another company's, or you're not sure";
        if (h?.guess && !h.answer && !h.config) return `an address on the internet — is it one of yours? Its requests match ${serviceName(map!, h.guess)}'s routes`;
        return "outside service — another company's API";
      }
      const svc = map?.services.find((s) => s.id === n.service);
      switch (svc?.kind) {
        case "app":
          return "another service in this system — code you can open";
        case "db":
          return "a database this system runs — one of its own services";
        case "cache":
          return "a cache this system runs — one of its own services";
        case "broker":
          return "a message broker this system runs — one of its own services";
        case "gateway":
          return "a gateway this system runs — it passes requests on";
        default:
          return "one of this app's own services — its code isn't in this workspace";
      }
    }
    case "channel":
      return "a queue or topic — messages wait here for another service to pick up";
    case "rpc":
      return "a gRPC service — doors called by name, not by URL";
    case "component":
      return "page or component — what the user sees";
    default:
      return n.layer === "ui" ? "front-end module" : "logic module — code that does the work";
  }
}

function serviceName(map: CodeMap, id: string): string {
  return map.services.find((s) => s.id === id)?.name ?? id;
}

function EdgeRow({ map, e, dir, i, onOpen, onSelect }: { map: CodeMap; e: MapEdge; dir: "in" | "out"; i: number; onOpen: Props["onOpen"]; onSelect: Props["onSelect"] }) {
  const otherId = dir === "out" ? e.to : e.from;
  const other = nodeById(map, otherId);
  const ev = e.evidence[0];
  const words = dir === "out" ? OUT_WORDS[e.kind] : IN_WORDS[e.kind];
  // Across a service boundary, say which service the other end is in, and any rewrite it went through.
  const here = nodeById(map, dir === "out" ? e.from : e.to)?.service;
  const there = other?.service && other.service !== here && map.system.kind === "services" && other.kind !== "service" ? map.services.find((s) => s.id === other.service) : undefined;
  const via = /goes through the (.+?)(?:;|\.$)/i.exec(e.note ?? "")?.[1];
  // The config line that pointed the request at the other service, when there is one,
  // or what the user told WalkMyCode about the setting it is built on.
  const cfg = e.evidence.find((v) => v.role === "config");
  const told = e.evidence.find((v) => v.role === "user");
  return (
    <div
      className="edge"
      style={{ ["--i" as string]: i }}
      title={`${ev.file}:${ev.line}\n${ev.text}`}
      onClick={() => {
        onOpen(ev.file, ev.line);
      }}
    >
      <span className="how">{words}</span>
      <span className="who">
        <button className="link" style={{ textDecoration: "none", color: "inherit" }} onClick={(x) => (x.stopPropagation(), onSelect(otherId))}>
          {other?.name ?? otherId}
        </button>
      </span>
      {there && <span className="how">({there.name} service)</span>}
      {e.toFns?.length ? <span className="how">({e.toFns.slice(0, 3).join(", ")})</span> : null}
      {via && <span className="how">— through the {via}</span>}
      {cfg && (
        <button
          className="evchip config"
          title={`${cfg.file}:${cfg.line}\n${cfg.text}`}
          onClick={(x) => {
            x.stopPropagation();
            onOpen(cfg.file, cfg.line);
          }}
        >
          config
        </button>
      )}
      {told && (
        <span className="evchip user" title={`${told.text} — your answer, not something the code proves`}>
          you told WalkMyCode
        </span>
      )}
      {ev.trigger && (
        <span className="trig">
          ← the {ev.trigger.label ? `“${ev.trigger.label}” ` : ""}
          {ev.trigger.element}
        </span>
      )}
      {e.confidence === "likely" && (
        <span className="guess" title={e.note}>
          guess
        </span>
      )}
    </div>
  );
}

export default function Inspector({ map, selected, onOpen, onSelect, onExplain, onTrace, onTour }: Props) {
  const n = selected ? nodeById(map, selected) : undefined;
  if (!n) {
    return (
      <div className="inspect">
        <p className="note">Click a card on the map to see what it’s connected to. Double-click to focus on it.</p>
        <p className="note">Solid arrows are facts the parser found. Dashed arrows are guesses, and say why.</p>
        <SettingsList map={map} onOpen={onOpen} />
      </div>
    );
  }
  const { in: ins, out: outs } = edgesOf(map, n.id);
  const fns = n.file ? map.files.find((f) => f.path === n.file)?.fns : undefined;
  // The "Service" line: only where there is more than one service to be in.
  const svc = map.system.kind === "services" && n.service ? map.services.find((s) => s.id === n.service) : undefined;
  return (
    // Keyed by the card, so each new selection rises in afresh.
    <div className="inspect" key={n.id}>
      <h3 className={n.kind === "route" ? "mono" : ""}>{n.name}</h3>
      <div className="kind">{kindWord(n, map)}</div>
      {svc && (
        <div className="kind">
          in the {svc.name} service
          {svc.evidence[0] && (
            <>
              {" · "}
              <button className="link mono" style={{ fontSize: "var(--text)" }} onClick={() => onOpen(svc.evidence[0].file, svc.evidence[0].line)}>
                {svc.evidence[0].file}:{svc.evidence[0].line}
              </button>
            </>
          )}
        </div>
      )}
      {n.file && (
        <button className="link mono" style={{ fontSize: "var(--text)", textAlign: "left" }} onClick={() => onOpen(n.file!, n.line ?? 1, n.endLine)}>
          {n.file}:{n.line ?? 1}
        </button>
      )}
      <div className="row">
        <button className="ctl compact primary" onClick={() => onExplain(n)}>
          Explain this
        </button>
        <button className="ctl compact" onClick={() => onTrace(n)}>
          Trace it
        </button>
        <button className="ctl compact" onClick={() => onTour(n)}>
          Tour from here
        </button>
      </div>
      {n.columns && n.columns.length > 0 && (
        <>
          <div className="label">
            Columns · {n.columns.length}
            {n.columnsAt && (
              <>
                {" · "}
                <button className="link mono" style={{ fontSize: "var(--text)" }} onClick={() => onOpen(n.columnsAt!.file, n.columnsAt!.line)} title="Where these columns are written">
                  {n.columnsAt.file.split("/").pop()}:{n.columnsAt.line}
                </button>
              </>
            )}
          </div>
          <div className="edges">
            {n.columns.map((c, j) => (
              <div key={c.name} className="edge" style={{ ["--i" as string]: j, cursor: n.columnsAt ? "pointer" : "default" }} onClick={() => n.columnsAt && onOpen(n.columnsAt.file, n.columnsAt.line)}>
                <span className="who mono">{c.name}</span>
                {c.type && <span className="how mono">{c.type}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {outs.length > 0 && (
        <>
          <div className="label">It reaches out to</div>
          <div className="edges">
            {outs.map((e, i) => (
              <EdgeRow key={e.id} map={map} e={e} dir="out" i={i} onOpen={onOpen} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
      {ins.length > 0 && (
        <>
          <div className="label">It is reached from</div>
          <div className="edges">
            {ins.map((e, i) => (
              <EdgeRow key={e.id} map={map} e={e} dir="in" i={outs.length + i} onOpen={onOpen} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
      {!ins.length && !outs.length && <p className="note">The parser found no links for this one.</p>}
      {fns && Object.keys(fns).length > 0 && n.kind !== "route" && (
        <>
          <div className="label">Functions inside</div>
          <div className="edges">
            {Object.entries(fns)
              .slice(0, 40)
              .map(([name, [s, e]], j) => (
                <div key={name} className="edge" style={{ ["--i" as string]: j }} onClick={() => onOpen(n.file!, s, e)}>
                  <span className="who mono">{name}</span>
                  <span className="how">
                    lines {s}–{e}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
