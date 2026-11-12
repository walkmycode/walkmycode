"use client";
// "Pick up where you left off" and "Or try an example" (docs/design/home-redesign.html):
// one card per map, with what it is made of, its five lanes in small, and when it was
// last opened. The cards fill the row at every width (auto-fit), and rise in a short
// stagger; the lanes' blocks stack up after them. Only whole rows show (at most two,
// three cards on a phone), so no row is left half empty; "Show all" lists the rest.
import { useLayoutEffect, useRef, useState } from "react";
import { cardMeta, exampleTitle, LANES, laneBlocks, timeAgo, wholeRows, type MapCard } from "@/lib/mapCard";
import type { CardView } from "./types";

/** The number of columns the grid can hold right now (auto-fit keeps its unused tracks, at 0 px). */
function useColumns(el: React.RefObject<HTMLElement | null>, on: boolean): number {
  const [cols, setCols] = useState(0);
  useLayoutEffect(() => {
    const g = el.current;
    if (!on || !g) return;
    const read = () => setCols(getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(g);
    return () => ro.disconnect();
  }, [el, on]);
  return cols;
}

const LANE_WORD = { ui: "screens", api: "routes", logic: "logic", data: "data", external: "outside" } as const;

/** "Opened 2 h ago", "Indexed yesterday". */
function whenText(w: CardView["when"]): string {
  const ago = timeAgo(w.iso);
  return ago ? `${w.verb} ${ago === "Yesterday" ? "yesterday" : ago}` : w.verb;
}

function Lanes({ card }: { card: MapCard }) {
  const blocks = laneBlocks(card.lanes);
  return (
    <div className="mcard-mini" aria-hidden title={LANES.map((l) => `${card.lanes[l].toLocaleString("en-GB")} ${LANE_WORD[l]}`).join(" · ")}>
      {LANES.map((l, li) => (
        <div key={l} className="mcard-lane">
          {Array.from({ length: blocks[li] }, (_, j) => (
            <div key={j} className="mcard-blk" style={{ ["--lane" as string]: `var(--lane-${l})`, ["--j" as string]: j, opacity: 0.45 + 0.5 * (j / 8) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface PickUpProps {
  cards: CardView[];
  /** The key of the card being opened. */
  opening: string | null;
  error: string | null;
  onOpen: (c: CardView) => void;
  onEdit: (c: CardView) => void;
}

export function PickUp({ cards, opening, error, onOpen, onEdit }: PickUpProps) {
  const grid = useRef<HTMLDivElement>(null);
  const cols = useColumns(grid, cards.length > 0);
  const [all, setAll] = useState(false);
  if (!cards.length) return null;
  const fits = wholeRows(cards.length, cols);
  const shown = all ? cards : cards.slice(0, fits);
  return (
    <section className="home-sect" aria-labelledby="pickup-h">
      <div className="home-sect-h">
        <h3 id="pickup-h">Pick up where you left off</h3>
        {fits < cards.length && (
          <button type="button" className="home-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${cards.length}`}
          </button>
        )}
      </div>
      {error && (
        <p key={error} className="home-err" role="alert" style={{ margin: "0 0 14px" }}>
          {error}
        </p>
      )}
      <div ref={grid} className="home-grid">
        {shown.map((c, i) => {
          const { tag, line } = cardMeta(c.card);
          const isOpening = opening === c.key;
          return (
            <article key={c.key} className={`mcard${isOpening ? " opening" : ""}`} style={{ ["--i" as string]: i }} aria-busy={isOpening || undefined}>
              <button type="button" className="mcard-hit" onClick={() => onOpen(c)} disabled={!!opening} aria-label={`Open the map of ${c.card.name}`} />
              {c.editable && (
                <button type="button" className="hbtn small mcard-edit" onClick={() => onEdit(c)} disabled={!!opening} title="Add, remove or refresh its folders, then map it again">
                  Edit
                </button>
              )}
              <div className="mcard-name">
                <span title={c.card.name}>{c.card.name}</span>
                {tag && <span className="mcard-tag">{tag}</span>}
              </div>
              <div className="mcard-meta">{line}</div>
              <Lanes card={c.card} />
              <div className="mcard-foot">
                <span>{whenText(c.when)}</span>
                <span className="mcard-open">
                  {isOpening ? (
                    "Opening…"
                  ) : (
                    <>
                      Open map <i>→</i>
                    </>
                  )}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Examples({ cards, opening, onOpen }: { cards: MapCard[]; opening: string | null; onOpen: (name: string) => void }) {
  if (!cards.length) return null;
  return (
    <section className="home-sect" aria-labelledby="examples-h">
      <div className="home-sect-h">
        <h3 id="examples-h">Or try an example</h3>
      </div>
      <div className="home-examples">
        {cards.map((c, i) => {
          const title = exampleTitle(c.name);
          return (
            <button key={c.name} type="button" className="ex" style={{ ["--i" as string]: i }} onClick={() => onOpen(c.name)} disabled={!!opening}>
              <span className="ex-ic" aria-hidden>
                {title[0]}
              </span>
              <span className="ex-txt">
                <b>{title}</b>
                <span>{opening === `map:${c.name}` ? "Opening…" : cardMeta(c).line}</span>
              </span>
              <span className="ex-go" aria-hidden>
                →
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
