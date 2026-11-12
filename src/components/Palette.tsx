"use client";
// The go-to bar (Ctrl+K), grown from the search palette: type or say where to
// go and the map travels there (docs/PLAN.md "Fly-through").
// - A plain name (a page, a component, a route, a table, a service, a file) is
//   found here, in the browser, with no AI, and the map flies to it at once.
// - "A to B" flies the real arrows between two cards, also with no AI.
// - A how / why / what-happens question goes to the guide, which answers by
//   flying the map hop by hop along real arrows (fly_step).
// It still searches everything as before: names, files, paths, hostnames and
// env settings (USERS_URL finds the users service), grouped by service.
// Prefixes narrow it: svc:, route:, table:, chan:. Where voice is on, holding
// the mic button turns speech into the bar's text.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeMap } from "@/analyzer/types";
import { resolveGoTo, type GoTo } from "@/lib/flyPath";
import { canListen, listen, type Listening } from "@/lib/listen";
import { searchMap, type Hit } from "@/lib/mapSearch";
import { unlockAudio } from "@/lib/voice/view";

export { searchMap, type Hit, type HitGroup } from "@/lib/mapSearch";

/** What the bar can hand on besides a card: two cards, or a question. */
export type GoOn = Extract<GoTo, { kind: "path" } | { kind: "ask" }>;

interface Props {
  map: CodeMap;
  initial?: string;
  onClose: () => void;
  /** A card, a service or a file, by name. */
  onPick: (hit: Hit) => void;
  /** Two cards ("A to B"), or a question for the guide; `spoken` when it was said aloud. */
  onGo?: (go: GoOn, spoken: boolean) => void;
  /** The guide can answer here (an AI is set up, or Claude in WalkMyCode Lite). */
  canAsk?: boolean;
  /** Offer the microphone (where voice is on and the browser can listen). */
  mic?: boolean;
}

type Row = { kind: "hit"; hit: Hit } | { kind: "go"; go: GoOn };

const sameHit = (a: Hit, b: Hit) => a.kind === b.kind && a.id === b.id;

export default function Palette({ map, initial = "", onClose, onPick, onGo, canAsk = false, mic = false }: Props) {
  const [q, setQ] = useState(initial);
  const [at, setAt] = useState(0);
  const [hearing, setHearing] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listening = useRef<Listening | null>(null);
  const groups = useMemo(() => searchMap(map, q), [map, q]);
  const go = useMemo(() => resolveGoTo(map, q), [map, q]);
  const canMic = useMemo(() => mic && canListen(), [mic]);

  // First what the words mean (a card, two cards, a question), then every match, then "ask".
  const { lead, tail } = useMemo(() => {
    const lead: Row[] = [];
    const tail: Row[] = [];
    const first = groups[0]?.hits[0];
    if (go.kind === "path") lead.push({ kind: "go", go });
    else if (go.kind === "hit" && !(first && sameHit(first, go.hit))) lead.push({ kind: "hit", hit: go.hit });
    else if (go.kind === "ask" && canAsk) lead.push({ kind: "go", go });
    if (q.trim() && canAsk && go.kind !== "ask") tail.push({ kind: "go", go: { kind: "ask", question: q.trim() } });
    return { lead, tail };
  }, [go, groups, q, canAsk]);
  const flat = useMemo<Row[]>(() => [...lead, ...groups.flatMap((g) => g.hits.filter((h) => !lead.some((r) => r.kind === "hit" && sameHit(r.hit, h))).map((hit) => ({ kind: "hit" as const, hit }))), ...tail], [lead, groups, tail]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => () => listening.current?.cancel(), []);

  const run = (r: Row | undefined, spoken = false) => {
    if (!r) return;
    unlockAudio(); // a click or a key: the narrator may speak later in this fly-through
    if (r.kind === "hit") onPick(r.hit);
    else onGo?.(r.go, spoken);
    onClose();
  };

  /** Words heard through the mic: go where they say, or leave them in the bar. */
  const heard = (text: string) => {
    setHearing(null);
    listening.current = null;
    const t = text.trim();
    if (!t) return;
    setQ(t);
    setAt(0);
    const g = resolveGoTo(map, t);
    if (g.kind === "hit") run({ kind: "hit", hit: g.hit }, true);
    else if (g.kind === "path" || (g.kind === "ask" && canAsk)) run({ kind: "go", go: g }, true);
  };
  const press = () => {
    if (listening.current) return;
    unlockAudio();
    setMicError(null);
    const l = listen({ onText: (t) => setHearing(t), onDone: heard, onError: (why) => setMicError(why) });
    if (!l) return setMicError("This browser cannot hear speech.");
    listening.current = l;
    setHearing("");
  };
  const release = () => listening.current?.stop();

  const label = (r: Row): { main: string; sub: string; mono: boolean } => {
    if (r.kind === "hit") return { main: r.hit.label, sub: r.hit.sub, mono: r.hit.kind === "file" || r.hit.label.includes("/") };
    if (r.go.kind === "path") return { main: `Fly from ${r.go.from.label} to ${r.go.to.label}`, sub: "along the real arrows on the map, right here (no AI)", mono: false };
    return { main: `Show me the way: “${r.go.question}”`, sub: "the guide flies the map hop by hop, on real arrows only", mono: false };
  };

  let i = -1;
  const item = (r: Row, key: string) => {
    i++;
    const me = i;
    const l = label(r);
    return (
      <button key={key} className={`${me === at ? "on" : ""}${r.kind === "go" ? " go" : ""}`} onMouseEnter={() => setAt(me)} onClick={() => run(r)}>
        <span className={l.mono ? "mono" : ""}>{l.main}</span>
        <small>{l.sub}</small>
      </button>
    );
  };
  const question = go.kind === "ask";

  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette panel" role="dialog" aria-label="Go to" data-goto="">
        <div className="goto-row">
          <input
            ref={input}
            className="field"
            placeholder={hearing !== null ? "Listening…" : "Go to a page, route, table… or ask how something works"}
            value={hearing ?? q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Only the bar closes: a fly-through under it keeps going.
                e.preventDefault();
                onClose();
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(flat[at]);
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setAt((a) => (e.key === "ArrowDown" ? Math.min(flat.length - 1, a + 1) : Math.max(0, a - 1)));
              }
            }}
            aria-label="Where to go, or what to ask"
          />
          {canMic && (
            <button
              type="button"
              className={`ctl mic${hearing !== null ? " on" : ""}`}
              title="Hold to say where to go; let go and the map flies there"
              aria-pressed={hearing !== null}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                press();
              }}
              onPointerUp={release}
              onPointerCancel={release}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  press();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") release();
              }}
            >
              <i className="talk-dot" aria-hidden />
              {hearing !== null ? "listening" : "hold to speak"}
            </button>
          )}
        </div>
        {micError && <p className="note goto-why">{micError}</p>}
        <div className="palette-list">
          {lead.length > 0 && (
            <div>
              <div className="label">{question ? "Ask" : "Go"}</div>
              {lead.map((r, k) => item(r, `lead:${k}`))}
            </div>
          )}
          {!flat.length && (
            <p className="note">
              {q.trim()
                ? question && !canAsk
                  ? "Questions need an AI to answer them: set one up in Settings. Names of pages, routes and tables work without one."
                  : "Nothing on the map matches that."
                : "Type a name (the login page, the users table), two names (cart to orders table), or ask how something works."}
            </p>
          )}
          {groups.map((g) => {
            const hits = g.hits.filter((h) => !lead.some((r) => r.kind === "hit" && sameHit(r.hit, h)));
            if (!hits.length) return null;
            return (
              <div key={g.group}>
                <div className="label">{g.group}</div>
                {hits.map((h) => item({ kind: "hit", hit: h }, `${h.kind}:${h.id}`))}
              </div>
            );
          })}
          {tail.length > 0 && <div>{tail.map((r, k) => item(r, `tail:${k}`))}</div>}
        </div>
      </div>
    </div>
  );
}
