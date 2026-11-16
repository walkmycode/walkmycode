"use client";
// The live debugger's panel (docs/DEBUG.md; mockup docs/design/debug-native.html): the program on this computer,
// stopped at a breakpoint or a step. A toolbar (Continue F5, Over F10, Into F11, Out Shift+F11, Stop
// Shift+F5), the variables of the frame on show (a Vec's items or a struct's fields open a level at a time;
// a value that changed since the last stop flashes), and the call stack (the user's own frames first-class,
// the standard library's dimmed). Shown above the Output while debugging; the session is src/ide/localrun/client.ts.
import { useEffect, useRef, useState } from "react";
import type { AdapterOffer, DebugCommand, PausedView, VarView } from "@/lib/localrun/protocol";

interface Props {
  paused: PausedView | null;
  frame: number;
  vars: VarView[];
  /** The variables at the stop before: a value that differs now flashes. */
  prev: VarView[];
  adapter: string;
  onCmd: (c: DebugCommand) => void;
  onStop: () => void;
  onFrame: (index: number) => void;
  loadVars: (ref: number) => Promise<VarView[]>;
}

const REASON: Record<string, string> = { breakpoint: "breakpoint", step: "step", pause: "paused", exception: "panic", entry: "start" };

function Ico({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function LiveDebug({ paused, frame, vars, prev, adapter, onCmd, onStop, onFrame, loadVars }: Props) {
  const top = paused?.frames[frame];
  // The keys, while the program is being debugged (not while typing elsewhere).
  const latest = useRef({ paused, onCmd, onStop });
  useEffect(() => {
    latest.current = { paused, onCmd, onStop };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { paused: p, onCmd: cmd, onStop: stop } = latest.current;
      if (e.key === "F5" && e.shiftKey) return void (e.preventDefault(), stop());
      if (!p) return;
      const c: DebugCommand | null = e.key === "F5" ? "continue" : e.key === "F10" ? "next" : e.key === "F11" ? (e.shiftKey ? "stepOut" : "stepIn") : null;
      if (!c) return;
      e.preventDefault();
      cmd(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // What each variable was at the last stop: a changed one flashes.
  const was = new Map(prev.map((v) => [v.name, v.value]));
  const changed = new Set(vars.filter((v) => was.has(v.name) && was.get(v.name) !== v.value).map((v) => v.name));

  const step = (c: DebugCommand, label: string, key: string, d: string, fill = false) => (
    <button type="button" className="dbtn" disabled={!paused} onClick={() => onCmd(c)} title={`${label} (${key})`} aria-label={label}>
      <Ico d={d} fill={fill} />
      <span className="lbl">{label}</span>
      <kbd>{key}</kbd>
    </button>
  );

  return (
    <section className="live-debug" aria-label="Debugger">
      <div className="dbar">
        <span className={`dstate${paused ? "" : " run"}`} role="status">
          <i aria-hidden />
          {paused ? `Paused${top ? ` at ${top.mine ? "line" : `${top.file ?? "?"}:`} ${top.line}` : ""}: ${REASON[paused.reason] ?? paused.reason}` : "Running…"}
        </span>
        {step("continue", "Continue", "F5", "M4.5 3l8 5-8 5z", true)}
        {step("next", "Over", "F10", "M2.5 9a5.5 5.5 0 0 1 10.2-2.6M13 3v3.6H9.4M8 12.5v.01")}
        {step("stepIn", "Into", "F11", "M8 1.5v7.5M5 6l3 3 3-3M8 13v.01")}
        {step("stepOut", "Out", "⇧F11", "M8 10V2.5M5 5.5l3-3 3 3M8 13v.01")}
        {!paused && (
          <button type="button" className="dbtn" onClick={() => onCmd("pause")} title="Pause" aria-label="Pause">
            <Ico d="M5 3.5v9M11 3.5v9" />
            <span className="lbl">Pause</span>
          </button>
        )}
        <button type="button" className="dbtn stop" onClick={onStop} title="Stop (Shift+F5)" aria-label="Stop">
          <Ico d="M3.5 3.5h9v9h-9z" fill />
          <span className="lbl">Stop</span>
        </button>
        <span className="sp" />
        <span className="dtool">{adapter}</span>
      </div>
      {paused && (
        <div className="dpanes">
          <div className="dsec">
            <h3>
              Variables <b>{top?.name ?? ""}</b>
            </h3>
            {vars.length ? (
              <ul className="dvars" role="tree" aria-label="Variables">
                {vars.map((v) => (
                  <VarRow key={`${frame}:${v.name}`} v={v} depth={0} changed={changed.has(v.name)} loadVars={loadVars} />
                ))}
              </ul>
            ) : (
              <p className="dnone">{top?.mine === false ? "In the standard library: step out to get back to your code." : "No variables here."}</p>
            )}
          </div>
          <div className="dsec">
            <h3>Call stack</h3>
            <ol className="dstack">
              {paused.frames.slice(0, 30).map((f, i) => (
                <li key={i}>
                  <button type="button" className={`${i === frame ? "on" : ""}${f.mine ? "" : " ext"}`} onClick={() => onFrame(i)} title={f.file ? `${f.file}:${f.line}` : f.name}>
                    <span className="fn">{f.name}</span>
                    <span className="at">{f.file ? `${f.file.split("/").pop()}:${f.line}` : ""}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

function VarRow({ v, depth, changed, loadVars }: { v: VarView; depth: number; changed: boolean; loadVars: (ref: number) => Promise<VarView[]> }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<VarView[] | null>(null);
  const toggle = () => {
    if (!v.ref) return;
    if (!open && !kids) void loadVars(v.ref).then(setKids);
    setOpen((o) => !o);
  };
  const str = /^"/.test(v.value);
  return (
    <li role="treeitem" aria-selected={false} aria-expanded={v.ref ? open : undefined}>
      <button type="button" className={`dvar${changed ? " changed" : ""}`} style={{ "--d": depth } as React.CSSProperties} onClick={toggle} disabled={!v.ref} title={`${v.name}: ${v.type} = ${v.value}`}>
        <span className="tw" aria-hidden>
          {v.ref ? (open ? "▾" : "▸") : ""}
        </span>
        <span className="nm">{v.name}</span>
        {v.type && <span className="ty">{v.type}</span>}
        <span className={`vl${str ? " str" : ""}`}>{v.value}</span>
      </button>
      {open && kids && (
        <ul role="group">
          {kids.map((k) => (
            <VarRow key={k.name} v={k} depth={depth + 1} changed={false} loadVars={loadVars} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The first Debug in a language: what fetching its debugger means, and the yes. */
export function GetDebugger({ offer, progress, error, onGet, onCancel }: { offer: AdapterOffer; progress: { got: number; total: number; phase: string } | null; error: string; onGet: () => void; onCancel: () => void }) {
  const mb = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;
  return (
    <section className="get-debugger" role="dialog" aria-labelledby="getdbg-title">
      <header>
        <span className="eb">First debug in this language</span>
        <h3 id="getdbg-title">Get {offer.label}, the debugger?</h3>
      </header>
      <p>
        WalkMyCode debugs this code with <b>{offer.label}</b>, an open-source debugger. It runs on this computer, as Run does, and is kept for next time.
      </p>
      <dl>
        <dt>From</dt>
        <dd>
          {offer.source} · v{offer.version}
        </dd>
        <dt>Size</dt>
        <dd>{mb(offer.bytes)}, checked against its published SHA-256</dd>
        <dt>Licence</dt>
        <dd>{offer.licence}</dd>
        <dt>Kept in</dt>
        <dd>{offer.dir}</dd>
      </dl>
      {progress && (
        <div className="getdbg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress.got / Math.max(1, progress.total)) * 100)}>
          <i style={{ width: `${Math.min(100, (progress.got / Math.max(1, progress.total)) * 100)}%` }} />
          <span>{progress.phase === "download" ? `${mb(progress.got)} of ${mb(progress.total)}` : progress.phase === "check" ? "Checking it…" : "Unpacking…"}</span>
        </div>
      )}
      {error && <p className="err">{error}</p>}
      <footer>
        <button type="button" className="ctl" onClick={onCancel} disabled={!!progress && !error}>
          Not now
        </button>
        <span className="sp" />
        <button type="button" className="ctl primary" onClick={onGet} disabled={!!progress && !error}>
          {error ? "Try again" : "Get it and debug"}
        </button>
      </footer>
    </section>
  );
}
