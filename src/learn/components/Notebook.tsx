"use client";
/** The notebook (docs/LEARNING.md, "Sporadic journaling"): one place for every
 *  thought and every answer worth keeping, from any course, newest first. */
import { useState } from "react";
import { ago, searchNotes, type Note } from "@/learn/lib/notebook";
import { useNow } from "@/learn/lib/now";
import Markdown from "./Markdown";

type Props = {
  notes: Note[];
  onAdd: (text: string) => void;
  onDrop: (id: string) => void;
  /** The lesson open now: its notes are marked "this lesson". */
  lessonId?: string;
};

export default function Notebook({ notes, onAdd, onDrop, lessonId }: Props) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const shown = searchNotes(notes, query);
  const now = useNow();
  const add = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText("");
  };
  return (
    <div className="notebook">
      <form
        className="jot"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="sr" htmlFor="jot">Jot a thought</label>
        <textarea
          id="jot"
          rows={2}
          value={text}
          placeholder="Jot a thought, a question, a connection…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              add();
            }
          }}
        />
        <div className="row">
          <span className="keys"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> keeps it</span>
          <button className="ctl primary" type="submit" disabled={!text.trim()}>Keep</button>
        </div>
      </form>
      {notes.length > 4 && (
        <input className="find" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in your notebook" aria-label="Find in your notebook" />
      )}
      {notes.length === 0 ? (
        <div className="prof-empty">
          <p className="big">One notebook for everything.</p>
          <p>Leonardo kept one notebook for every idea, whatever the subject, because ideas from different places connect when they sit on the same page. Jot a thought above, or press <b>Save to notebook</b> under any answer.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="note">Nothing in your notebook mentions that.</p>
      ) : (
        <ul className="notes">
          {shown.map((n) => (
            <li key={n.id} className={n.from}>
              <p className="who">
                <span>{n.from === "prof" ? "The professor" : "You"} · {ago(n.at, now)}{n.lessonTitle ? ` · ${n.lessonId === lessonId ? "this lesson" : n.lessonTitle}` : ""}</span>
                <button type="button" onClick={() => onDrop(n.id)} aria-label="Remove this note">Remove</button>
              </p>
              {n.from === "prof" ? <Markdown text={n.text} /> : <p className="said">{n.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
