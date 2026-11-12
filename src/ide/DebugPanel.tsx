"use client";
/**
 * Stepping through a recorded run: where the program is, its variables (with
 * what just changed), the call stack and the output so far, forwards and
 * backwards, jumping between breakpoints, with the professor to explain any
 * step.
 */
import { useEffect, useRef, useState } from "react";
import { sampleMessage, type Sample } from "@/learn/lib/claude";
import { stepPrompt } from "@/learn/lib/professor";
import type { DebugRun, DebugStep } from "@/ide/python";
import type { Profile } from "@/learn/lib/types";

type Props = {
  run: DebugRun;
  index: number;
  onIndex: (i: number) => void;
  breakpoints: number[];
  onExit: () => void;
  code: string;
  engine: "page" | "laptop";
  sample: Sample | null;
  profile: Profile;
};

type Vars = Record<string, [string, string]>;

function changes(now: Vars, before: Vars | undefined) {
  const out = new Set<string>();
  for (const k of Object.keys(now)) if (!before || !before[k] || before[k][0] !== now[k][0]) out.add(k);
  return out;
}

/** The variables to show for a step: its function's locals when it is in a
 *  function and they can be seen; otherwise the program's globals. */
function scope(s: DebugStep): { title: string; vars: Vars } {
  const fn = s.stack.at(-1) ?? "<module>";
  if (fn !== "<module>" && s.locals) return { title: `Variables in ${fn}()`, vars: s.locals };
  return { title: "Variables", vars: s.globals };
}

export default function DebugPanel({ run, index, onIndex, breakpoints, onExit, code, engine, sample, profile }: Props) {
  const steps = run.steps;
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)];
  const [help, setHelp] = useState<{ text: string; busy: boolean; err: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const next = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i <= last; i += dir) if (breakpoints.includes(steps[i].line) && steps[i].event === "line") return i;
    return dir === 1 ? last : 0;
  };

  // F10 steps, Shift+F10 steps back, F5 runs to the next breakpoint.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        onIndex(e.shiftKey ? Math.max(0, index - 1) : Math.min(last, index + 1));
      } else if (e.key === "F5") {
        e.preventDefault();
        onIndex(next(index, e.shiftKey ? -1 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!step) {
    return (
      <div className="debug">
        <p className="hint">Nothing ran: the code has no lines to step through.</p>
        {run.error && <pre className="error">{run.error}</pre>}
        <button className="ctl" type="button" onClick={onExit}>Stop debugging</button>
      </div>
    );
  }

  const { title, vars } = scope(step);
  const prev = index > 0 ? scope(steps[index - 1]) : undefined;
  const changed = prev && prev.title === title ? changes(vars, prev.vars) : new Set<string>();
  const showGlobals = step.locals && title !== "Variables" && Object.keys(step.globals).length > 0;
  const output = run.output.slice(0, step.out);
  const atEnd = index === last;
  const fn = step.stack.at(-1) ?? "<module>";

  const explain = async () => {
    if (!sample) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setHelp({ text: "", busy: true, err: "" });
    const fmt = (v: Vars) => Object.entries(v).map(([k, [r]]) => `${k} = ${r}`).join(", ");
    try {
      const { text } = await sample(
        stepPrompt(code, step, fmt(vars), [...changed].map((k) => `${k} = ${vars[k][0]}`).join(", "), output, profile),
        { signal: c.signal, onText: ({ text }) => setHelp({ text, busy: true, err: "" }) },
      );
      setHelp({ text, busy: false, err: "" });
    } catch (e) {
      setHelp({ text: (e as { text?: string }).text ?? "", busy: false, err: sampleMessage(e) });
    }
  };

  return (
    <div className="debug" aria-label="Debugger">
      <div className="debug-bar" role="toolbar" aria-label="Debugger controls">
        <button className="ctl" type="button" disabled={index === 0} onClick={() => onIndex(0)} title="Back to the start">⏮</button>
        <button className="ctl" type="button" disabled={index === 0} onClick={() => onIndex(index - 1)} title="Step back (Shift+F10)">◀ Back</button>
        <button className="ctl primary" type="button" disabled={atEnd} onClick={() => onIndex(index + 1)} title="Step (F10)">Step ▶</button>
        <button className="ctl" type="button" disabled={atEnd} onClick={() => onIndex(next(index, 1))} title="Run to the next breakpoint (F5)">
          {breakpoints.length ? "Continue ⏭" : "To the end ⏭"}
        </button>
        <button className="ctl" type="button" onClick={onExit}>■ Stop debugging</button>
      </div>

      <input
        className="scrub"
        type="range"
        min={0}
        max={last}
        value={index}
        onChange={(e) => onIndex(+e.target.value)}
        aria-label="Step through the run"
      />
      <p className="where">
        Step <b>{index + 1}</b> of {steps.length} · line <b>{step.line}</b>
        {fn !== "<module>" && <> · in <b>{fn}()</b></>}
        {step.event === "return" && step.ret !== null && <> · returning <code>{step.ret}</code></>}
      </p>
      {step.stack.length > 1 && <p className="stack">Call stack: {step.stack.map((s) => (s === "<module>" ? "your program" : `${s}()`)).join(" → ")}</p>}

      <div className="vars">
        <p className="vars-title">{title}</p>
        {Object.keys(vars).length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <table>
            <tbody>
              {Object.entries(vars).map(([k, [r, type]]) => (
                <tr key={k} className={changed.has(k) ? "changed" : ""}>
                  <th scope="row">{k}</th>
                  <td><code>{r}</code></td>
                  <td className="type">{type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showGlobals && (
          <p className="hint">Outside the function: {Object.entries(step.globals).map(([k, [r]]) => `${k} = ${r}`).join(", ")}</p>
        )}
        {fn !== "<module>" && !step.locals && engine === "page" && (
          <p className="hint">This page&rsquo;s Python cannot see a function&rsquo;s own variables. Debug on your laptop to see them.</p>
        )}
      </div>

      <div className="output small" aria-label="Output so far">
        <p className="vars-title">Printed so far</p>
        {output ? <pre className="out">{output}</pre> : <p className="hint">Nothing yet.</p>}
        {atEnd && run.error && <pre className="error">{run.error}</pre>}
        {atEnd && run.truncated && <p className="hint">The recording stopped after {run.maxSteps} steps (is there a loop that never ends?).</p>}
        {atEnd && !run.error && !run.truncated && <p className="hint">The program finished.</p>}
      </div>

      {sample && (
        <div className="ask">
          <button className="ctl" type="button" disabled={help?.busy} onClick={explain}>Explain this step</button>
          {help && (
            <div className="help">
              <p>{help.text || (help.busy ? "The professor is looking at this line…" : "")}</p>
              {help.err && <p className="err">{help.err}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
