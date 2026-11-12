"use client";
/** Recall (docs/LEARNING.md, "Test knowledge"): the cards that are due, one at a
 *  time. Say the answer to yourself, turn the card, and mark it honestly: a
 *  card you knew comes back later each time; one you missed comes back tomorrow.
 *  Space turns the card; 1 is "not yet", 2 is "I knew it". */
import { useEffect, useMemo, useState } from "react";
import { Chalk } from "@/learn/lib/markup";
import { useNow } from "@/learn/lib/now";
import { deckStats, dueCards, dueIn, INTERVALS, type Card } from "@/learn/lib/recall";
import Diagram from "./Diagram";

type Props = {
  cards: Card[];
  /** Only this lesson's cards (the lesson's Recall tab); every due card when left out. */
  lessonId?: string;
  onReview: (card: Card, knew: boolean) => void;
};

export default function Recall({ cards, lessonId, onReview }: Props) {
  const mine = useMemo(() => (lessonId ? cards.filter((c) => c.lessonId === lessonId) : cards), [cards, lessonId]);
  const [turned, setTurned] = useState(false);
  /** Going through the cards again before they are due. */
  const [again, setAgain] = useState<string[] | null>(null);
  const now = useNow();
  const due = dueCards(mine, now);
  const practice = again ? mine.filter((c) => again.includes(c.id)) : [];
  const card = due[0] ?? practice[0];
  const stats = deckStats(mine, now);

  const mark = (knew: boolean) => {
    if (!card) return;
    setTurned(false);
    if (again) setAgain((a) => (a ?? []).filter((id) => id !== card.id));
    onReview(card, knew);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement).closest("textarea, input, select, button, a, [contenteditable], .cm-editor")) return;
      if (!turned && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        setTurned(true);
      } else if (turned && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        mark(e.key === "2");
      }
    };
    // Before the lesson's own Space (play) and arrows.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!mine.length) {
    return (
      <div className="prof-empty">
        <p className="big">No cards yet.</p>
        <p>Each lesson leaves a few cards behind: its key ideas as questions. They come back here just before you would forget them.</p>
      </div>
    );
  }

  if (!card) {
    const next = Math.min(...mine.map((c) => c.due));
    return (
      <div className="prof-empty">
        <p className="big">Nothing due. Well remembered.</p>
        <p>
          {stats.learnt} of {stats.total} card{stats.total === 1 ? "" : "s"} learnt. The next one comes back {dueIn(next, now)}.
        </p>
        <button className="ctl" type="button" onClick={() => setAgain(mine.map((c) => c.id))}>Go through {lessonId ? "this lesson's" : "all"} {mine.length} again</button>
      </div>
    );
  }

  const left = due.length || practice.length;
  return (
    <div className="recall">
      <p className="recall-head">
        <span>{left} to go{due.length ? "" : " · practice"}</span>
        <span className="boxes" aria-label={`Box ${card.box + 1} of ${INTERVALS.length}`}>
          {INTERVALS.map((_, i) => <i key={i} className={i <= card.box ? "on" : ""} />)}
        </span>
      </p>
      <div className={`card${turned ? " turned" : ""}`} aria-live="polite">
        <p className="eyebrow">{card.course}</p>
        <p className="q"><Chalk text={card.q} /></p>
        {turned ? (
          <>
            <p className="a"><Chalk text={card.a} /></p>
            {card.diagram && <div className="diagram-box"><Diagram source={card.diagram} label={card.q} /></div>}
          </>
        ) : (
          <p className="note">Say the answer to yourself first. Then turn the card.</p>
        )}
      </div>
      {turned ? (
        <div className="row">
          <button className="ctl" type="button" onClick={() => mark(false)}>Not yet <kbd>1</kbd></button>
          <button className="ctl primary" type="button" onClick={() => mark(true)}>I knew it <kbd>2</kbd></button>
        </div>
      ) : (
        <div className="row">
          <button className="ctl primary" type="button" onClick={() => setTurned(true)}>Show the answer <kbd>Space</kbd></button>
        </div>
      )}
      <p className="note">Knew it: it comes back after {INTERVALS[Math.min(card.box + 1, INTERVALS.length - 1)]} day{INTERVALS[Math.min(card.box + 1, INTERVALS.length - 1)] === 1 ? "" : "s"}. Not yet: tomorrow.</p>
    </div>
  );
}
