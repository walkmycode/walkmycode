"use client";
// "How did this line get here?" (./FileGit.tsx opens it, from the note at the end of the cursor's
// line or a click on a block's blame): the commits that changed one line, oldest first and the
// newest marked, each with who, when, its message, its PR and the lines it took out and put in
// (src/lib/localrun/lineStory.ts, from git log -L). From here the guide can tell the line's story
// from those commits, and the popover can follow the whole function the line is in instead. A PR is
// a link only when the repo's remote is a GitHub one; otherwise it is just its number.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { storyCommand, withoutPr, type LineChange, type LineStory, type StoryOf } from "@/lib/localrun/lineStory";
import { ago, LONG } from "./blameMarks";

/** Where it stands: reading, a plain message (no git, not in a repo…), or the changes. */
export type StoryState = { busy: true } | { message: string } | { story: LineStory };

export interface LineStoryProps {
  /** Where the line's note or blame was on the screen when it was clicked. */
  at: { top: number; bottom: number; left: number };
  /** What git was asked for (the line, or the lines of the function it is in), and what to call it. */
  of: StoryOf;
  title: string;
  state: StoryState;
  onClose: () => void;
  /** "Explain this history": the guide tells the story. */
  onExplain?: () => void;
  /** "Show the whole function's history", or back to the one line. */
  other?: { label: string; open: () => void };
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

const prLink = (web: string | null, pr: string) => (web ? `${web}/pull/${pr}` : null);

function Change({ c, web, now }: { c: LineChange; web: string | null; now: boolean }) {
  const d = new Date(c.date);
  const valid = !Number.isNaN(d.getTime());
  const link = c.pr ? prLink(web, c.pr) : null;
  return (
    <li className={now ? "now" : undefined}>
      <span className="dot" aria-hidden />
      <div>
        <div className="head" title={valid ? `${LONG.format(d)} · ${ago(d)}` : undefined}>
          <strong>
            {valid ? DAY.format(d) : c.date} · {c.author}
          </strong>{" "}
          <code>{c.hash}</code>
          {c.pr && (
            <span className="pr">
              {" · "}
              {link ? (
                <a href={link} target="_blank" rel="noreferrer">
                  PR {c.pr}
                </a>
              ) : (
                `PR ${c.pr}`
              )}
            </span>
          )}
          {now && <span className="tag">now</span>}
        </div>
        <div className="subj">{withoutPr(c.subject) || "(no message)"}</div>
        {(c.removed.length > 0 || c.added.length > 0) && (
          <div className="mini" aria-label="What it changed">
            {c.removed.map((l, i) => (
              <div key={`d${i}`} className="del">
                − {l}
              </div>
            ))}
            {c.added.map((l, i) => (
              <div key={`a${i}`} className="add">
                + {l}
              </div>
            ))}
            {c.more > 0 && <div className="more">… and {c.more === 1 ? "1 more line" : `${c.more} more lines`}</div>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function LineStoryPop({ at, of, title, state, onClose, onExplain, other }: LineStoryProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Beside the line: below it, or above it when there's no room below; inside the panel either way.
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const p = parent.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    let top = at.bottom - p.top + 6;
    if (top + h > p.height - 8) top = Math.max(8, Math.min(at.top - p.top - h - 6, p.height - h - 8));
    const left = Math.max(8, Math.min(at.left - p.left, p.width - w - 8));
    setPos({ top, left });
  }, [at, state]);

  // Closes on Escape, or a click outside it.
  useEffect(() => {
    const doc = box.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    // Escape is heard first, wherever the focus is (the guide's box, after "Explain this history").
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDown);
    box.current?.focus({ preventScroll: true });
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const story = "story" in state ? state.story : null;
  const n = story?.changes.length ?? 0;
  // Oldest first, as a story is told; git gives newest first.
  const told = story ? [...story.changes].reverse() : [];
  const web = story?.web ?? null;
  const lastPr = story?.changes.find((c) => c.pr)?.pr;
  const lastPrLink = lastPr ? prLink(web, lastPr) : null;

  return (
    <div className="line-story" ref={box} role="dialog" aria-label={`How ${title} got here`} tabIndex={-1} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
      <header>
        <p className="label">How {title} got here</p>
        <span className="sp" />
        {story && (
          <span className="faint">
            {n === 1 ? "1 change" : `${n} changes`} · {storyCommand(of)}
          </span>
        )}
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {"busy" in state && <p className="note">Reading its history from git…</p>}
      {"message" in state && <p className="note">{state.message}</p>}
      {story && n === 0 && <p className="note">No commits have touched {"from" in of && of.from === of.to ? "this line" : "these lines"} yet.</p>}
      {story && n > 0 && (
        <>
          {story.cut && <p className="note small">Older changes are left out: these are the last {n}.</p>}
          <ol>
            {told.map((c, i) => (
              <Change key={c.hash} c={c} web={web} now={i === told.length - 1} />
            ))}
          </ol>
        </>
      )}
      <footer>
        {onExplain && (
          <button type="button" className="ctl compact" disabled={!n} onClick={onExplain}>
            Explain this history
          </button>
        )}
        {lastPr && lastPrLink && (
          <a className="ctl compact" href={lastPrLink} target="_blank" rel="noreferrer">
            Open PR {lastPr}
          </a>
        )}
        {other && (
          <button type="button" className="ctl compact" disabled={"busy" in state} onClick={other.open}>
            {other.label}
          </button>
        )}
      </footer>
    </div>
  );
}
