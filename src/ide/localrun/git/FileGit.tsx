"use client";
// Who changed this file, and when (mockup: docs/design/git-history.html). Line
// history is on by default (Settings → Editor, src/lib/editorSettings.ts): a
// gutter beside the line numbers with the author and the exact date and time of
// the last change to each block of lines (hover one for the commit), and a faint
// note at the end of the line the cursor is on. In the Code panel's header,
// "Blame" switches it for this file, for this visit; "History" lists the file's
// own commits. By default it is quiet: it never asks to be allowed and says
// nothing when git has no answer; pressing Blame asks and explains. Both come
// from the user's own git (src/lib/localrun/git.ts: blame, fileLog), so only
// where WalkMyCode can reach the project's folder on this computer: the desktop
// app, which knows the folder it picked, or the full app once Source Control or
// Set up was told where it is. Never in WalkMyCode Lite.
//
// In the desktop app, for the folder it opened, both are read-only git with no
// "run code on this computer" needed (POST /api/git/read, ./readGit.ts): they
// only read the repo. Everywhere else they go through the local-run socket and
// its consent, as before.
//
// "How did this line get here?" (./LineStory.tsx), from the cursor line's note or
// a click on a block's blame, reads one line's history (git log -L) the same two
// ways, and shows it in a popover beside the line.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { markAt, type BlameMark, type OnLineStory } from "@/ide/lineHistory";
import { useEditorSettings } from "@/ide/useEditorSettings";
import { useDesktop } from "@/lib/desktop";
import { editorSettings, onEditorSettings } from "@/lib/editorSettings";
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

/** Files where Blame was pressed, for this visit (true on, false off): a panel rebuilt by a layout
 * change keeps it. A file not here follows Settings → Editor. */
const picked = new Map<string, boolean>();
const pickedListeners = new Set<() => void>();
const onPicked = (f: () => void) => {
  pickedListeners.add(f);
  return () => {
    pickedListeners.delete(f);
  };
};
function pick(path: string, on: boolean) {
  picked.set(path, on);
  pickedListeners.forEach((f) => f());
}
// The switch in Settings is the newer wish: when it changes, every open file follows it again.
let wasDefault = typeof window === "undefined" ? true : editorSettings().lineHistory;
onEditorSettings(() => {
  const d = editorSettings().lineHistory;
  if (d === wasDefault) return;
  wasDefault = d;
  picked.clear();
  pickedListeners.forEach((f) => f());
});

/** The folder the desktop app picked for this workspace, when it has one (src/lib/localFolder.ts, readPath). */
export function pickedFolder(ws: ReturnType<typeof useWorkspace>): string | null {
  return ws?.repos.find((r) => r.path)?.path ?? null;
}

const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" aria-hidden>
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

/** Blame and History for one open file: the header's buttons, the gutter's marks for the editor, and a
 * line's history (`lineStory` opens it; `storyPop` is the popover, for the panel to place). */
export function useFileGit(
  path: string,
  content: string | undefined,
  o: FileGitOptions = {},
): { tools: React.ReactNode; blame: BlameMark[] | null; lineStory: OnLineStory | undefined; storyPop: React.ReactNode } {
  const local = useLocalStatus();
  const ws = useWorkspace();
  const workspace = ws?.name;
  const { ask, dialog } = useConsent();
  const available = LOCAL_BUILD && !!local?.available;

  // The desktop app reads line history straight from the folder it opened: no consent needed.
  const desktop = useDesktop();
  const folder = desktop ? pickedFolder(ws) : null;
  const allowed = !!local?.allowed || !!folder;
  // On because Settings says so, or because Blame was pressed here (then it may ask and explain).
  const settings = useEditorSettings();
  const pickedHere = useSyncExternalStore(
    onPicked,
    () => picked.get(path),
    () => undefined,
  );
  const explicit = pickedHere === true;
  const want = pickedHere ?? settings.lineHistory;
  const [blame, setBlame] = useState<BlameMark[] | null>(null);
  /** Asked for by default and git had no answer: Blame shows as off, and pressing it says why. */
  const [missed, setMissed] = useState(false);
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
  // running on this computer is allowed, and quietly; pressed, it asks and says what went wrong.
  useEffect(() => {
    if (!available || !want || (!explicit && !allowed)) return;
    let gone = false;
    void call("blame", !explicit).then((r) => {
      setBusy(null);
      if (gone) return;
      if (r?.blame) {
        setBlame(blameMarks(r.blame, r.me ?? ""));
        setMissed(false);
      } else {
        setBlame(null);
        if (explicit) pick(path, false);
        else setMissed(true);
      }
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the file's text, the switch, and being allowed
  }, [content, want, explicit, available, allowed]);

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
  // above it and not committed yet don't move git onto another line. Lines not committed have no button.
  const lineStory = useCallback<OnLineStory>(
    (line, anchor) => {
      const mark = blame ? markAt(blame, line) : null;
      const orig = mark?.at?.orig[line - mark.start];
      if (!mark?.at || !orig) return;
      const r = anchor.getBoundingClientRect();
      const of: StoryOf = { from: orig, to: orig, at: mark.at.sha };
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

  if (!available) return { tools: null, blame: null, lineStory: undefined, storyPop: null };

  // Shown as on only when it can be: wanted, allowed (or asked for here), and git had an answer.
  const blameOn = want && !missed && (explicit || allowed);
  const toggleBlame = () => {
    if (blameOn) {
      pick(path, false);
      setBlame(null);
    } else {
      setBusy("blame");
      setMissed(false);
      pick(path, true);
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
      <button type="button" className="ctl" aria-pressed={blameOn} disabled={busy === "blame"} onClick={toggleBlame} title="Who last changed each line, and when">
        <Icon d={<><circle cx="5" cy="4" r="1.6" /><circle cx="5" cy="12" r="1.6" /><circle cx="11" cy="8" r="1.6" /><path d="M5 5.6v4.8M6.4 4.6l3.2 2.4" /></>} />
        {busy === "blame" ? "Blame…" : "Blame"}
      </button>
      <button type="button" className="ctl" aria-pressed={histOpen} aria-expanded={histOpen} disabled={busy === "file-log"} onClick={() => void toggleHistory()} title="This file's commits">
        <Icon d={<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>} />
        History
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
  return { tools, blame: blameOn ? blame : null, lineStory: blameOn && blame ? lineStory : undefined, storyPop };
}
