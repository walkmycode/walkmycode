"use client";
// The guide's board while a change is toured ("Tour a change", docs/GIT.md; mockup: DiffTour): the
// change, in order, from the data up to the screen, one step per changed file, the one on screen open
// with what it says (the facts, or the guide's words once it has told the change). Under the steps,
// the cards that didn't change but use something that did. Then "Explain and review": the guide tells
// the change as a story and reviews it, grounded in the diff and the code (its answer comes in as
// `children`, drawn by the Guide). The tour player under the board plays it as any tour.
import type { MapEdge } from "@/analyzer/types";
import type { Tour } from "@/lib/claude/tools";
import { countLabel } from "@/lib/diffParse";
import type { TouredChange } from "@/lib/diffTour";
import { useRepo } from "@/lib/store";
import "./changeTour.css";

/** How an affected card uses the one that changed. */
const USES: Partial<Record<MapEdge["kind"], string>> = {
  imports: "imports",
  calls: "calls",
  "calls-route": "sends requests to",
  "calls-rpc": "calls",
  consumes: "picks up messages from",
  reads: "reads",
  writes: "writes to",
  "uses-service": "talks to",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Props {
  change: TouredChange;
  tour: Tour;
  step: number;
  onStep(i: number): void;
  onCite(path: string, start: number, end?: number, from?: HTMLElement): void;
  onExplain?: () => void;
  busy: boolean;
  /** Something can answer here (not WalkMyCode Lite outside Claude). */
  canAsk: boolean;
  /** The guide's review, when it has been asked. */
  children?: React.ReactNode;
}

export default function ChangeBoard({ change, tour, step, onStep, onCite, onExplain, busy, canAsk, children }: Props) {
  const map = useRepo()?.map;
  const name = (id: string) => map?.nodes.find((n) => n.id === id)?.name ?? id;
  const { plan, totals } = change;
  const steps = plan.steps;
  const extra = [
    plan.gone.length ? `${plural(plan.gone.length, "file")} taken out (${plan.gone.slice(0, 3).join(", ")}${plan.gone.length > 3 ? "…" : ""})` : "",
    plan.binary.length ? `${plural(plan.binary.length, "file")} that isn't text (${plan.binary.slice(0, 3).join(", ")}${plan.binary.length > 3 ? "…" : ""})` : "",
  ].filter(Boolean);

  return (
    <div className="change-board">
      <p className="change-label">The change, in order</p>
      <p className="change-sum">
        <b>{change.label}</b>: {plural(totals.files, "file")}, <span className="plus">+{totals.added}</span> <span className="minus">−{totals.removed}</span>.{" "}
        {steps.length > 1 ? `${steps.length} steps, from the data up to the screen.` : steps.length === 1 ? "One step." : ""}
        {change.cut && " This change is very big: only its first part is shown."}
      </p>
      <ol className="change-steps">
        {steps.map((s, i) => {
          const on = i === step;
          const say = tour.steps[i]?.say ?? s.say;
          return (
            <li key={s.file} className={on ? "on" : i < step ? "done" : undefined}>
              <button type="button" className="change-step" aria-current={on ? "step" : undefined} onClick={() => onStep(i)}>
                <span className="n" aria-hidden>
                  {i + 1}
                </span>
                <span className="what">
                  <strong>{s.title}</strong>
                  <span className="where">
                    {s.file} <span className={s.removed && !s.added ? "minus" : "plus"}>{countLabel(s.added, s.removed)}</span>
                    {s.added_file && <span className="new"> new</span>}
                  </span>
                </span>
              </button>
              {on && (
                <p key={`say-${i}`} data-say className="change-say wipe-para">
                  {say}{" "}
                  <button type="button" className="cite" onClick={(e) => onCite(s.file, s.start, s.end, e.currentTarget)}>
                    {s.file}:{s.start}
                    {s.end !== s.start ? `–${s.end}` : ""}
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {extra.length > 0 && <p className="note">Also in the change: {extra.join("; ")}.</p>}

      <section className="change-box" aria-label="Not changed, but affected">
        <p className="change-label">Not changed, but affected</p>
        {plan.affected.length ? (
          <ul>
            {plan.affected.slice(0, 12).map((a) => {
              const ev = a.via.evidence[0];
              return (
                <li key={a.id}>
                  <strong>{name(a.id)}</strong>{" "}
                  <span className="dim">
                    {USES[a.via.kind] ?? "uses"} {name(a.uses)}
                  </span>{" "}
                  {ev && (
                    <button type="button" className="cite" onClick={(e) => onCite(ev.file, ev.line, ev.line, e.currentTarget)}>
                      {ev.file}:{ev.line}
                    </button>
                  )}
                </li>
              );
            })}
            {plan.affected.length > 12 && <li className="dim">and {plan.affected.length - 12} more, ringed on the map.</li>}
          </ul>
        ) : (
          <p className="dim">Nothing else on the map uses what changed.</p>
        )}
      </section>

      <section className="change-box change-ai" aria-label="The guide's review">
        <div className="change-ai-head">
          <p className="change-label">{tour.told ? "Told by the guide" : "Ask the guide"}</p>
          <button type="button" className="ctl compact primary" onClick={onExplain} disabled={busy || !canAsk || !onExplain}>
            {tour.told ? "Explain and review again" : "Explain and review"}
          </button>
        </div>
        {!children && (
          <p className="dim">
            {canAsk
              ? "The guide reads the change and the code around it, tells each step as a story, and notes anything a reviewer would raise, with the lines."
              : "Explaining a change needs an AI: open WalkMyCode Lite inside Claude to ask. The steps above work without one."}
          </p>
        )}
        {children}
      </section>
    </div>
  );
}
