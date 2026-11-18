"use client";
// Who changed this file, and when (mockup: docs/design/git-history.html). Line
// history is on by default (Settings → Editor, src/lib/editorSettings.ts): a
// faint note at the end of the line the cursor is on, and the details (author,
// date, the commit's message, "How did this line get here?") when the pointer
// rests on a line or a line is clicked, in reading and editing alike
// (src/ide/lineHistory.ts keeps each line's history right through edits). In the
// Code panel's header, two icon buttons: Blame shows a gutter beside the line
// numbers with the author and the exact date and time of the last change to each
// block of lines; it is off until pressed, and the choice lasts for this session
// in this browser. History lists the file's own commits. By default it is quiet:
// it never asks to be allowed and says nothing when git has no answer; pressing
// Blame asks and explains. Both come from the user's own git
// (src/lib/localrun/git.ts: blame, fileLog), so only where WalkMyCode can reach
// the project's folder on this computer: the desktop app, which knows the folder
// it picked, or the full app once Source Control or Set up was told where it is.
// Never in WalkMyCode Lite.
//
// In the desktop app, for the folder it opened, both are read-only git with no
// "run code on this computer" needed (POST /api/git/read, ./readGit.ts): they
// only read the repo. Everywhere else they go through the local-run socket and
// its consent, as before.
//
// "How did this line get here?" (./LineStory.tsx), from the cursor line's note, a
// line's details or a click on a block's blame, reads one line's history (git log
// -L) the same two ways, and shows it in a popover beside the line.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { markAt, type BlameMark, type OnLineStory } from "@/ide/lineHistory";
import { useEditorSettings } from "@/ide/useEditorSettings";
import { useDesktop } from "@/lib/desktop";
import type { GitFileCommit } from "@/lib/localrun/git";
import { storyPrompt, type StoryOf } from "@/lib/localrun/lineStory";
import type { GitOp } from "@/lib/localrun/protocol";
import { useWorkspace } from "@/lib/store";
import { toast } from "@/shell/Toast";
import { gitOp, LOCAL_BUILD, setupRoot, type GitAnswer } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import { ago, blameMarks, LONG, shortDate } from "./blameMarks";
import LineStoryPop, { type StoryState } from "./LineStory";
import { readGit } from "./readGit";
import "./git.css";

export { shortDate };

/** The Blame gutter: off until the user presses Blame, then on in every file for the rest of this
 * session in this browser (sessionStorage), and off again on a fresh start. */
export const GUTTER_KEY = "walkmycode.blameGutter";
let gutterNow: boolean | null = null;
const gutterListeners = new Set<() => void>();
const onGutter = (f: () => void) => {
  gutterListeners.add(f);
  return () => {
    gutterListeners.delete(f);
  };
};
function gutterOn(): boolean {
  if (gutterNow === null) {
    try {
      gutterNow = window.sessionStorage.getItem(GUTTER_KEY) === "on";
    } catch {
      gutterNow = false;
    }
  }
  return gutterNow;
}
function setGutter(on: boolean) {
  gutterNow = on;
  try {
    window.sessionStorage.setItem(GUTTER_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  gutterListeners.forEach((f) => f());
}

/** The folder the desktop app picked for this workspace, when it has one (src/lib/localFolder.ts, readPath). */
export function pickedFolder(ws: ReturnType<typeof useWorkspace>): string | null {
  return ws?.repos.find((r) => r.path)?.path ?? null;
}

const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

/** What the Code panel lends a line's history: the guide, and the map's function around a line. */
export interface FileGitOptions {
  /** "Explain this history": ask the guide (WorkspaceProvider's explainHistory). */
  explain?: (o: { from: number; shown: string; question: string }) => void;
  /** The function (or card) the line is in, as the map has it: its name and its lines. */
  fnAt?: (line: number) => { name: string; from: number; to: number } | null;
}

type Spot = { top: number; bottom: number; left: number };

/** Blame and History for one open file: the header's buttons, the blame for the editor (`gutter`: show
 * the Blame gutter), and a line's history (`lineStory` opens it; `storyPop` is the popover, for the
 * panel to place). */
export function useFileGit(
  path: string,
  content: string | undefined,
  o: FileGitOptions = {},
): { tools: React.ReactNode; blame: BlameMark[] | null; gutter: boolean; lineStory: OnLineStory | undefined; storyPop: React.ReactNode } {
  const local = useLocalStatus();
  const ws = useWorkspace();
  const workspace = ws?.name;
  const { ask, dialog } = useConsent();
  const available = LOCAL_BUILD && !!local?.available;

  // The desktop app reads line history straight from the folder it opened: no consent needed.
  const desktop = useDesktop();
  const folder = desktop ? pickedFolder(ws) : null;
  const allowed = !!local?.allowed || !!folder;
  // Read when Settings has line history on, or the Blame gutter is wanted. Blame pressed here asks to be
  // allowed and explains what went wrong (`asked`); otherwise it is quiet.
  const settings = useEditorSettings();
  const gutter = useSyncExternalStore(onGutter, gutterOn, () => false);
  const [asked, setAsked] = useState(0);
  const explicit = asked > 0;
  const want = settings.lineHistory || gutter;
  const [gitMarks, setBlame] = useState<BlameMark[] | null>(null);
  // Both switched off: nothing shown, though what was read is kept for when one is on again.
  const blame = want ? gitMarks : null;
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState<GitFileCommit[] | null>(null);
  const [busy, setBusy] = useState<GitOp | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  /** The line's history, open beside it: the line, what git was asked for (`of`: the line as the commit
   * that last changed it numbers it, or the function `fn` it is in), the line's own ask (`base`, for
   * "Back to line"), where the line was on the screen, and what git said. */
  const [story, setStory] = useState<{ line: number; of: StoryOf; base: StoryOf; fn?: string; at: Spot; state: StoryState } | null>(null);

  /** One op on this file; null (and a toast saying why, unless `quiet`; or to `onWhy`) when it can't be had. */
  const call = useCallback(
    async (op: "blame" | "file-log" | "line-log", quiet = false, of?: StoryOf, onWhy?: (why: string) => void): Promise<Pick<GitAnswer, "ok" | "blame" | "me" | "history" | "story" | "output"> | null> => {
      const say = (why: string) => (onWhy ? onWhy(why) : !quiet && toast(why));
      if (folder) {
        // Desktop: read-only, from the folder the app opened; never asks to run code.
        try {
          const r = await readGit(op, folder, path, of);
          if (!r.ok) {
            if (r.output) say(r.output);
            return null;
          }
          return r;
        } catch (e) {
          say((e as Error).message);
          return null;
        }
      }
      if (!local?.allowed && (quiet || !(await ask()))) return null;
      try {
        let r = await gitOp({ op, path, ...(workspace ? { workspace } : {}), ...of });
        // The desktop app knows the folder it picked: tell the server once, then ask again.
        const folder = pickedFolder(ws);
        if (!r.located && workspace && folder && (await setupRoot(workspace, folder)).ok) r = await gitOp({ op, path, workspace, ...of });
        if (!r.located) {
          say("WalkMyCode doesn't know where this project is on this computer yet: open Source Control in the top bar and give it the project's folder.");
          return null;
        }
        if (!r.ok) {
          say(r.output || "git couldn't do that.");
          return null;
        }
        return r;
      } catch (e) {
        say((e as Error).message);
        return null;
      }
    },
    [ask, folder, local?.allowed, path, workspace, ws],
  );

  // Line history on, and again when the file is saved or mapped again. By default only once
  // running on this computer is allowed, and quietly; Blame pressed, it asks and says what went wrong.
  useEffect(() => {
    if (!available || !want || (!explicit && !allowed)) return;
    let gone = false;
    void call("blame", !explicit).then((r) => {
      setBusy(null);
      if (gone) return;
      setBlame(r?.blame ? blameMarks(r.blame, r.me ?? "") : null);
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the file's text, the switches, a press, and being allowed
  }, [content, want, asked, available, allowed]);

  // History closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!histOpen) return;
    const doc = box.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHistOpen(false);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setHistOpen(false);
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onDown);
    return () => {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onDown);
    };
  }, [histOpen]);

  // "How did this line get here?": open beside the line at once, then ask git for its history (or the function's).
  const read = useCallback(
    (line: number, of: StoryOf, base: StoryOf, at: Spot, fn?: string) => {
      setStory({ line, of, base, ...(fn ? { fn } : {}), at, state: { busy: true } });
      let why = "";
      void call("line-log", false, of, (w) => (why = w)).then((r) => {
        // Asked to be allowed and told no: nothing to show, so it closes.
        const state: StoryState | null = r?.story ? { story: r.story } : why ? { message: why } : null;
        setStory((s) => (s && s.line === line && s.of === of ? (state ? { ...s, state } : null) : s));
      });
    },
    [call],
  );
  // The line as the commit that last changed it numbers it (git blame's), so lines added or taken out
  // above it, and edits not saved, don't move git onto another line. The editor says which commit and
  // line (`from`, kept through edits); lines not committed have no button.
  const lineStory = useCallback<OnLineStory>(
    (line, anchor, from) => {
      let at = from;
      if (!at) {
        const mark = blame ? markAt(blame, line) : null;
        const orig = mark?.at?.orig[line - mark.start];
        if (mark?.at && orig) at = { sha: mark.at.sha, orig };
      }
      if (!at) return;
      const r = anchor.getBoundingClientRect();
      const of: StoryOf = { from: at.orig, to: at.orig, at: at.sha };
      read(line, of, of, { top: r.top, bottom: r.bottom, left: r.left });
    },
    [blame, read],
  );
  const closeStory = useCallback(() => setStory(null), []);
  const { explain, fnAt } = o;
  const storyPop = useMemo(() => {
    if (!story) return null;
    const { line, of, base, fn, at, state } = story;
    // The function the line is in, from the map: its whole history is one press away. The map's lines
    // are the file's on disk, which are the last commit's only while nothing in the file is uncommitted
    // (git says, `changed`); otherwise the line's own history is all that can be followed.
    const around = fn || !("story" in state) || state.story.changed ? null : (fnAt?.(line) ?? null);
    const name = path.split("/").pop() ?? path;
    // The lines as the editor shows them: the function's (the map's), or the one line.
    const from = fn && "from" in of ? of.from : line;
    const to = fn && "from" in of ? of.to : line;
    const what = fn ? `the function ${fn}` : `line ${line}`;
    return (
      <LineStoryPop
        at={at}
        of={of}
        title={fn ?? `line ${line}`}
        state={state}
        onClose={closeStory}
        onExplain={
          explain && "story" in state
            ? () =>
                explain({
                  from,
                  shown: fn ? `How did ${fn} in ${name} get here?` : `How did line ${line} of ${name} get here?`,
                  question: storyPrompt(path, what, state.story, (content ?? "").split(/\r?\n/).slice(from - 1, Math.min(to, from + 59)).join("\n")),
                })
            : undefined
        }
        other={
          fn
            ? { label: `Back to line ${line}`, open: () => read(line, base, base, at) }
            : around && around.to > around.from
              ? { label: "Show the whole function's history", open: () => read(line, { from: around.from, to: around.to }, base, at, around.name) }
              : undefined
        }
      />
    );
  }, [story, fnAt, explain, path, content, closeStory, read]);

  if (!available) return { tools: null, blame: null, gutter: false, lineStory: undefined, storyPop: null };

  // The gutter shows as on only when it is: wanted, and git had an answer for this file.
  const blameOn = gutter && !!blame;
  const toggleBlame = () => {
    if (blameOn) return setGutter(false);
    setGutter(true);
    if (!blame) {
      setBusy("blame");
      setAsked((n) => n + 1);
    }
  };
  const toggleHistory = async () => {
    if (histOpen) return setHistOpen(false);
    setBusy("file-log");
    const r = await call("file-log");
    setBusy(null);
    if (!r) return;
    setHistory(r.history ?? []);
    setHistOpen(true);
  };
  const name = path.split("/").pop() ?? path;

  const tools = (
    <span className="file-git" ref={box}>
      {/* Icons, to keep the header short: the name is the label and the tooltip. */}
      <button
        type="button"
        className="ctl icon"
        aria-label="Blame"
        aria-pressed={blameOn}
        aria-busy={busy === "blame"}
        disabled={busy === "blame"}
        onClick={toggleBlame}
        data-tip="Blame: who changed each line"
        data-testid="file-blame"
      >
        {/* A person beside lines of code: who wrote which line. */}
        <Icon d={<><circle cx="4.5" cy="5" r="2" /><path d="M1.5 12.5c.4-2.2 1.6-3.4 3-3.4s2.6 1.2 3 3.4M9.5 4h5M9.5 7.3h5M9.5 10.6h3.5" /></>} />
      </button>
      <button
        type="button"
        className="ctl icon"
        aria-label="History"
        aria-pressed={histOpen}
        aria-expanded={histOpen}
        aria-busy={busy === "file-log"}
        disabled={busy === "file-log"}
        onClick={() => void toggleHistory()}
        data-tip="History: this file's commits"
        data-testid="file-history"
      >
        {/* A clock with an arrow going back round it. */}
        <Icon d={<><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" /><path d="M2.2 2.4v2.4h2.4" /><path d="M8 5v3.2l2.2 1.4" /></>} />
      </button>
      {histOpen && history && (
        <div className="file-hist" role="dialog" aria-label={`History of ${name}`}>
          <header>
            <b>History of {name}</b>
            <span>{history.length === 1 ? "1 commit" : `${history.length} commits`}</span>
          </header>
          {history.length ? (
            <ol>
              {history.map((c) => {
                const d = new Date(c.date);
                return (
                  <li key={c.hash} title={`${LONG.format(d)} · ${ago(d)}`}>
                    <span className="subj">{c.subject}</span>
                    <code>{c.hash}</code>
                    <span className="meta">
                      {c.author} · {shortDate(d)}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="note">No commits have touched this file yet.</p>
          )}
        </div>
      )}
      {dialog}
    </span>
  );
  return { tools, blame, gutter: blameOn, lineStory: blame ? lineStory : undefined, storyPop };
}
