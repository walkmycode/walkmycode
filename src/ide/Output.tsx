"use client";
/**
 * One IDE's output (./outputStore.ts), drawn under the editor or in Explore's
 * Output dock panel: the same entry either way. The header carries the
 * "Pop out" / "Dock back" switch when there is a dock to pop into, and
 * "Output | Terminal" (`tabs`) where code can run on this computer: then the
 * body (`children`) is the terminal instead of the output.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { OutputState } from "./outputStore";

export default function Output({ state, action, title, tabs, children }: { state: OutputState; action?: ReactNode; title?: string; tabs?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { parts, status, running, ran, hint, empty, tip } = state;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [parts]);
  return (
    <div className={`out-wrap${action || tabs ? " headed" : ""}`}>
      {(action || tabs) && (
        <div className="out-head">
          {tabs ?? <span className="out-title">Output</span>}
          {title && <span className="out-of" title={title}>{title}</span>}
          <span className="sp" />
          {action}
        </div>
      )}
      {children ?? (
        <div className="output" ref={ref} aria-live="polite" aria-label="Output">
          {status && <p className="status">{status}</p>}
          {!ran && !status && hint && <p className="hint">{hint}</p>}
          {parts.map((p, i) =>
            p.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={`data:image/png;base64,${p.data}`} alt="A plot drawn by the code" />
            ) : p.kind === "table" ? (
              <ResultTable key={i} columns={p.columns} rows={p.rows} />
            ) : (
              <pre key={i} className={p.kind}>{p.kind === "value" ? `→ ${p.text}` : p.text}</pre>
            ),
          )}
          {ran && !running && !parts.some((p) => p.kind !== "meta") && empty && <p className="hint">{empty}</p>}
          {!ran && !status && tip && <p className="hint">{tip}</p>}
        </div>
      )}
    </div>
  );
}

/** Rows returned by SQL (or console.table), capped so a huge result cannot freeze the page. */
function ResultTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const shown = rows.slice(0, 500);
  return (
    <div className="result-table">
      <table>
        <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{shown.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
      </table>
      <p className="hint">{rows.length} row{rows.length === 1 ? "" : "s"}{rows.length > shown.length ? `, first ${shown.length} shown` : ""}</p>
    </div>
  );
}
