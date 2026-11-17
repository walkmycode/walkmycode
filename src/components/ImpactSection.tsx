"use client";
// "If you change it", in Details (src/lib/impact.ts): what uses the selected card and how
// far that goes, the tables and services its code touches, and the tests that import it.
// The counts are always there; "Impact" lights the set on the map (everything else fades)
// and lists it, each item opening the line that links it. Only facts the map holds: the
// guide is asked about the risks only when the user presses "Explain the risks".
import { useMemo } from "react";
import type { CodeMap, MapNode } from "@/analyzer/types";
import { countWords, impactOf, lineOfUse, usersWithin, verbOf, type ImpactAsk, type ImpactUser, type Reach } from "@/lib/impact";
import { nodeById } from "@/lib/store";

export interface ImpactProps {
  files: Record<string, string>;
  ask: ImpactAsk | null;
  onShow(a: { id: string; fn?: string; reach: Reach; light: boolean }): void;
  onTour(a: { id: string; fn?: string; reach: Reach }): void;
  onRisks(a: { id: string; fn?: string; reach: Reach }): void;
}

interface Props extends ImpactProps {
  map: CodeMap;
  node: MapNode;
  onOpen: (path: string, start: number, end?: number) => void;
  onSelect: (id: string) => void;
}

const REACHES: { r: Reach; label: string }[] = [
  { r: 1, label: "1 step" },
  { r: 2, label: "2 steps" },
  { r: "all", label: "All" },
];

const names = (map: CodeMap, ids: string[]) => ids.map((id) => nodeById(map, id)?.name ?? id).join(", ");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function ImpactSection({ map, node, files, ask, onShow, onTour, onRisks, onOpen, onSelect }: Props) {
  const mine = ask?.id === node.id ? ask : null;
  const fn = mine?.fn;
  const reach: Reach = mine?.reach ?? ask?.reach ?? 2;
  const on = !!mine?.on;
  const imp = useMemo(() => impactOf(map, node.id, { fn, files }), [map, node.id, fn, files]);
  const fns = node.kind !== "route" && node.file ? Object.keys(map.files.find((f) => f.path === node.file)?.fns ?? {}) : [];
  const users = usersWithin(imp, reach);
  const direct = users.filter((u) => u.step === 1);
  const screen = users.filter((u) => nodeById(map, u.id)?.layer === "ui");
  const reads = imp.tables.filter((t) => t.reads.length).map((t) => t.id);
  const writes = imp.tables.filter((t) => t.writes.length).map((t) => t.id);
  const a = { id: node.id, ...(fn ? { fn } : {}), reach };
  const set = (patch: { fn?: string; reach?: Reach; light?: boolean }) => onShow({ id: node.id, fn: "fn" in patch ? patch.fn : fn, reach: patch.reach ?? reach, light: patch.light ?? on });
  const elsewhere = ask?.on && ask.id !== node.id ? nodeById(map, ask.id) : undefined;
  const noTests = imp.testFiles ? `None of the ${plural(imp.testFiles, "test file", "test files")} imports it, or code that uses it.` : "This project has no test files WalkMyCode could read.";

  const userRows = (list: ImpactUser[], start: number) =>
    list.map((u, i) => {
      const at = lineOfUse(map, u, files);
      return (
        <div key={u.id} className="edge" style={{ ["--i" as string]: start + i }} title={`${at.file}:${at.line}`} onClick={() => onOpen(at.file, at.line)}>
          <span className="who">
            <button className="link" style={{ textDecoration: "none", color: "inherit" }} onClick={(x) => (x.stopPropagation(), onSelect(u.id))}>
              {nodeById(map, u.id)?.name ?? u.id}
            </button>
          </span>
          <span className="how">
            {verbOf(u)}
            {u.step > 1 ? ` ${nodeById(map, u.on)?.name ?? u.on}` : " it"}
          </span>
          {u.guess && (
            <span className="guess" title={u.via.note}>
              guess
            </span>
          )}
        </div>
      );
    });
  const steps = [
    { label: "Uses it directly", list: users.filter((u) => u.step === 1) },
    { label: "Uses those", list: users.filter((u) => u.step === 2) },
    { label: "Further along", list: users.filter((u) => u.step > 2) },
  ];

  return (
    <section className="impact" aria-label="Change impact">
      {elsewhere && (
        <p className="note">
          The map shows what changing{" "}
          <button className="link" onClick={() => onSelect(elsewhere.id)}>
            {ask?.fn ? `${ask.fn}()` : elsewhere.name}
          </button>{" "}
          reaches.
        </p>
      )}
      <div className="label impact-head">
        <span>If you change {fn ? `${fn}()` : node.name}</span>
        {fns.length > 0 && (
          <select className="impact-fn" aria-label="Which part of the file" value={fn ?? ""} onChange={(e) => set({ fn: e.target.value || undefined })}>
            <option value="">all of {node.file!.split("/").pop()}</option>
            {fns.map((f) => (
              <option key={f} value={f}>
                only {f}()
              </option>
            ))}
          </select>
        )}
      </div>
      <dl className="impact-stats">
        <div>
          <dt>Used directly by</dt>
          <dd>{direct.length ? countWords(map, direct.map((u) => u.id)) : "nothing on the map"}</dd>
        </div>
        <div>
          <dt>Reaches the screen through</dt>
          <dd>{screen.length ? plural(screen.length, "component", "components") : "no components"}</dd>
        </div>
        <div>
          <dt>Reads tables</dt>
          <dd>{reads.length ? names(map, reads) : "none"}</dd>
        </div>
        {writes.length > 0 && (
          <div>
            <dt>Writes tables</dt>
            <dd>{names(map, writes)}</dd>
          </div>
        )}
        {imp.services.length > 0 && (
          <div>
            <dt>Talks to</dt>
            <dd>{names(map, imp.services.map((s) => s.id))}</dd>
          </div>
        )}
        <div>
          <dt>Tests that cover it</dt>
          <dd className={imp.tests.length ? "" : "none"} title={imp.tests.length ? undefined : noTests}>
            {imp.tests.length ? plural(imp.tests.length, "test file", "test files") : "none found"}
          </dd>
        </div>
      </dl>
      <div className="row impact-ctl">
        <button className={`ctl compact${on ? " on" : ""}`} aria-pressed={on} onClick={() => set({ light: !on })} title={on ? "Put the map back" : "Light what it reaches on the map; everything else fades"}>
          Impact
        </button>
        <span className="chips seg" role="group" aria-label="How far back to look">
          {REACHES.map((x) => (
            <button key={String(x.r)} type="button" className={`chip${reach === x.r ? " on" : ""}`} aria-pressed={reach === x.r} onClick={() => set({ reach: x.r, light: true })}>
              {x.label}
            </button>
          ))}
        </span>
      </div>
      {on && (
        <>
          <p className="note">Everything else on the map is faded.</p>
          {steps.map(
            (s, k) =>
              s.list.length > 0 && (
                <div key={s.label}>
                  <div className="label">
                    {s.label} · {s.list.length}
                  </div>
                  <div className="edges">{userRows(s.list, k * 10)}</div>
                </div>
              ),
          )}
          {imp.tables.length > 0 && (
            <div>
              <div className="label">Tables · {imp.tables.length}</div>
              <div className="edges">
                {imp.tables.map((t, i) => {
                  const e = t.writes[0] ?? t.reads[0];
                  const how = t.reads.length && t.writes.length ? "reads and writes" : t.writes.length ? "writes" : "reads";
                  return (
                    <div key={t.id} className="edge" style={{ ["--i" as string]: i }} title={`${e.evidence[0].file}:${e.evidence[0].line}`} onClick={() => onOpen(e.evidence[0].file, e.evidence[0].line)}>
                      <span className="who">
                        <button className="link" style={{ textDecoration: "none", color: "inherit" }} onClick={(x) => (x.stopPropagation(), onSelect(t.id))}>
                          {nodeById(map, t.id)?.name ?? t.id}
                        </button>
                      </span>
                      <span className="how">
                        {how}
                        {e.from !== node.id ? `, through ${nodeById(map, e.from)?.name ?? e.from}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {imp.services.length > 0 && (
            <div>
              <div className="label">Outside services · {imp.services.length}</div>
              <div className="edges">
                {imp.services.map((s, i) => (
                  <div key={s.id} className="edge" style={{ ["--i" as string]: i }} onClick={() => onOpen(s.via.evidence[0].file, s.via.evidence[0].line)}>
                    <span className="who">
                      <button className="link" style={{ textDecoration: "none", color: "inherit" }} onClick={(x) => (x.stopPropagation(), onSelect(s.id))}>
                        {nodeById(map, s.id)?.name ?? s.id}
                      </button>
                    </span>
                    <span className="how">through {nodeById(map, s.via.from)?.name ?? s.via.from}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="label">Tests · {imp.tests.length}</div>
            {imp.tests.length ? (
              <div className="edges">
                {imp.tests.map((t, i) => (
                  <div key={t.path} className="edge" style={{ ["--i" as string]: i }} onClick={() => onOpen(t.path, t.line)}>
                    <span className="who mono">{t.path}</span>
                    <span className="how">
                      imports {t.imports.split("/").pop()}
                      {t.direct ? "" : ", which uses it"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="note">None found. {noTests}</p>
            )}
          </div>
        </>
      )}
      <div className="row">
        <button className="ctl compact" onClick={() => onTour(a)}>
          Tour the impact
        </button>
        <button className="ctl compact" onClick={() => onRisks(a)} title="Ask the guide what could break, with these lists">
          Explain the risks
        </button>
      </div>
    </section>
  );
}
