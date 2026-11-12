"use client";
// What is open, in the top bar: the name and its main stack ("Next.js +2"), one
// button that opens a card with all of it: every stack, and the map's numbers
// (repos, services, files, routes, tables, links). The numbers used to be a
// sentence across the bar; this keeps the bar short at every width.
import { useEffect, useId, useRef, useState } from "react";
import StackChips from "./StackChips";

export interface Metric {
  n: number;
  label: string;
}

interface Props {
  name: string;
  stack: string[];
  metrics: Metric[];
  /** A line under the numbers, e.g. "one app + 2 shared packages". */
  note?: string;
  /** Everything in one line, for the tooltip. */
  summary: string;
}

export default function ProjectChip({ name, stack, metrics, note, summary }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cardId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="proj" ref={box}>
      <button type="button" className="proj-chip" aria-expanded={open} aria-controls={cardId} title={summary} onClick={() => setOpen((v) => !v)}>
        <span className="proj-name">{name}</span>
        {stack[0] && <span className="stack-chip">{stack[0]}</span>}
        {stack.length > 1 && <span className="proj-more">+{stack.length - 1}</span>}
        <svg className="proj-caret" viewBox="0 0 10 10" width="10" height="10" aria-hidden>
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={cardId} className="proj-card" role="dialog" aria-label={`About ${name}`}>
          <div className="proj-card-head">
            <b>{name}</b>
            <StackChips words={stack} />
          </div>
          <dl className="proj-stats">
            {metrics.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.n.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          {note && <p className="proj-note">{note}</p>}
        </div>
      )}
    </div>
  );
}
