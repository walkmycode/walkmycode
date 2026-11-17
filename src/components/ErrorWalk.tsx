"use client";
// "Walk an error" on the guide's board (docs/SHELL.md §4): paste an error or a stack
// trace, or take the last one the Run panel printed, and walk the path it took. The
// frames in the project are numbered steps from where it threw outwards; a click opens
// one at its line. The map lights the path and the first frame opens in the Code panel
// (the workspace does both, src/shell/WorkspaceProvider.tsx walkError). The likely cause
// is the guide's answer, drawn by the Guide into the box below the steps; "Tour the
// path" plays the frames as a tour. Reading the trace is src/lib/stackTrace.ts.
import { useId, useState, useSyncExternalStore } from "react";
import { outputs } from "@/ide/outputStore";
import { frameName, lastError, type WalkState } from "@/lib/stackTrace";

interface Props {
  walk: WalkState | null;
  files: Record<string, string>;
  onWalk: (text: string) => void;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
  onTourPath: () => void;
  /** The likely cause, as the Guide draws an answer (or why there is none). */
  cause: React.ReactNode;
  /** "Explain a fix": shown once the cause is in. */
  onFix?: () => void;
  busy: boolean;
}

const subscribe = (f: () => void) => outputs.subscribe(f);
const noError = () => null;

/** The frame's own line of code, trimmed, as a hint under its name. */
const lineOf = (files: Record<string, string>, path: string, line: number) => files[path]?.split("\n")[line - 1]?.trim().slice(0, 120) ?? "";

export default function ErrorWalk({ walk, files, onWalk, onClose, onOpen, onTourPath, cause, onFix, busy }: Props) {
  const [text, setText] = useState(walk?.text ?? "");
  // Which step is open in the Code panel (the first, where it threw, until another is clicked).
  const [open, setOpen] = useState<{ walk: number; i: number } | null>(null);
  const runError = useSyncExternalStore(subscribe, outputs.lastError, noError);
  const box = useId();
  const result = walk?.result;
  const at = open && walk && open.walk === walk.id ? open.i : 0;

  const fromRun = () => {
    if (!runError) return;
    // Its last trace when it printed one, else the end of what it printed.
    const t = lastError(runError) ?? runError.trimEnd().split("\n").slice(-40).join("\n");
    setText(t);
    onWalk(t);
  };

  return (
    <section className="walk" aria-label="Walk an error">
      <div className="walk-head">
        <h2>Walk an error</h2>
        <button type="button" className="ctl compact ghost" onClick={onClose} title="Put the walk away">
          Close
        </button>
      </div>
      <form
        className="walk-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onWalk(text);
        }}
      >
        <label htmlFor={box} className="note">
          Paste an error or stack trace
        </label>
        <textarea
          id={box}
          className="field walk-text"
          rows={result ? 4 : 7}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"TypeError: fetch failed\n    at sendAssignedEmail (lib/email.ts:4:9)\n    at createTask (lib/tasks.ts:26:28)"}
        />
        <div className="walk-actions">
          <button type="submit" className="ctl primary" disabled={!text.trim()}>
            Walk it
          </button>
          <button type="button" className="ctl" onClick={fromRun} disabled={!runError} title={runError ? "Walk the last error the Run panel printed" : "Nothing in the Run panel has failed yet"}>
            Read from the Run panel
          </button>
        </div>
      </form>

      {result && (
        <>
          {result.message && <p className="walk-message">{result.message}</p>}
          {result.frames.length ? (
            <ol className="walk-steps">
              {result.frames.map((f, i) => (
                <li key={`${f.file}:${f.line}:${i}`}>
                  <button
                    type="button"
                    className={`walk-step${i === at ? " on" : ""}`}
                    onClick={() => {
                      setOpen({ walk: walk!.id, i });
                      onOpen(f.file, f.line);
                    }}
                    title={`Open ${f.file} at line ${f.line}`}
                  >
                    <span className={`walk-num${i === 0 ? " threw" : ""}`}>{i + 1}</span>
                    <span className="walk-what">
                      <b>{frameName(f)}</b> <span className="walk-at">{f.file}:{f.line}</span>
                      {i === 0 && <span className="walk-threw"> · threw here</span>}
                      {lineOf(files, f.file, f.line) && <code className="walk-line">{lineOf(files, f.file, f.line)}</code>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="note" role="status">
              None of these lines point at a file in this project, so there is no path to walk. Paste the whole trace, with its <code>at …</code> or <code>File …</code> lines.
            </p>
          )}
          {result.outside > 0 && result.frames.length > 0 && (
            <p className="note walk-outside">
              {result.outside} {result.outside === 1 ? "step" : "steps"} outside your code (libraries, the runtime) left out.
            </p>
          )}
          {result.frames.length > 0 && (
            <>
              <div className="walk-cause">
                <p className="walk-label">Likely cause</p>
                {cause}
              </div>
              <div className="walk-actions">
                <button type="button" className="ctl" onClick={onTourPath}>
                  ▶ Tour the path
                </button>
                {onFix && (
                  <button type="button" className="ctl" onClick={onFix} disabled={busy}>
                    Explain a fix
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
