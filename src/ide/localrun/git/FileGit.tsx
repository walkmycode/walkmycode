"use client";
// Who changed this file, and when (mockup: docs/design/git-history.html). In the
// Code panel's header: "Blame" puts a gutter beside the line numbers with the
// author and the exact date and time of the last change to each block of lines
// (hover one for the commit); "History" lists the file's own commits. Both come
// from the user's own git (src/lib/localrun/git.ts: blame, fileLog), so only
// where WalkMyCode can reach the project's folder on this computer: the desktop
// app, which knows the folder it picked, or the full app once Source Control or
// Set up was told where it is. Never in WalkMyCode Lite.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlameMark } from "@/ide/Editor";
import type { GitBlameHunk, GitFileCommit } from "@/lib/localrun/git";
import type { GitOp } from "@/lib/localrun/protocol";
import { useWorkspace } from "@/lib/store";
import { toast } from "@/shell/Toast";
import { gitOp, LOCAL_BUILD, setupRoot, type GitAnswer } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import "./git.css";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const AGO = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/** "2 Nov 2026, 09:14" in this computer's time zone. */
export const shortDate = (d: Date) => DAY.format(d);

const PARTS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** The gutter's date in pieces: "2 Nov", " 2026", "09:14". */
function dateParts(d: Date): { day: string; year: string; time: string } {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.day} ${p.month}`, year: ` ${p.year}`, time: `${p.hour}:${p.minute}` };
}

/** "two weeks ago". */
export function ago(d: Date, now = Date.now()): string {
  const s = (d.getTime() - now) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86_400, "hour"],
    [604_800, "day"],
    [2_629_800, "week"],
    [31_557_600, "month"],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [limit, unit] = steps[i];
    if (Math.abs(s) < limit) return AGO.format(Math.round(s / (i ? steps[i - 1][0] : 1)), unit);
  }
  return AGO.format(Math.round(s / 31_557_600), "year");
}

/** git's blocks of lines as the gutter shows them: the user's own commits as "You", lines not committed in green. */
export function blameMarks(hunks: GitBlameHunk[], me: string, now = Date.now()): BlameMark[] {
  const mine = me.trim().toLowerCase();
  return hunks.map((h) => {
    const range = h.lines > 1 ? `lines ${h.start}–${h.start + h.lines - 1}` : `line ${h.start}`;
    if (!h.hash) return { start: h.start, lines: h.lines, who: "Not committed", when: "your change", tip: `Changed since the last commit (${range}).`, tone: "new" };
    const d = new Date(h.time * 1000);
    const isMe = !!mine && h.email.toLowerCase() === mine;
    return {
      start: h.start,
      lines: h.lines,
      who: isMe ? "You" : h.author,
      when: dateParts(d),
      tip: `${h.author}${isMe ? " (you)" : ""}\n${LONG.format(d)} · ${ago(d, now)}\n${h.summary}\n${h.hash} · ${range}`,
      ...(isMe ? { tone: "me" as const } : {}),
    };
  });
}

/** Files with Blame switched on, for this visit: a panel rebuilt by a layout change keeps it. */
const blamed = new Set<string>();

/** The folder the desktop app picked for this workspace, when it has one (src/lib/localFolder.ts, readPath). */
function pickedFolder(ws: ReturnType<typeof useWorkspace>): string | null {
  return ws?.repos.find((r) => r.path)?.path ?? null;
}

const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="square" aria-hidden>
    {d}
  </svg>
);

/** Blame and History for one open file: the header's buttons, and the gutter's marks for the editor. */
export function useFileGit(path: string, content: string | undefined): { tools: React.ReactNode; blame: BlameMark[] | null } {
  const local = useLocalStatus();
  const ws = useWorkspace();
  const workspace = ws?.name;
  const { ask, dialog } = useConsent();
  const available = LOCAL_BUILD && !!local?.available;

  const [blameOn, setBlameOnState] = useState(() => blamed.has(path));
  const setBlameOn = useCallback(
    (on: boolean) => {
      if (on) blamed.add(path);
      else blamed.delete(path);
      setBlameOnState(on);
    },
    [path],
  );
  const [blame, setBlame] = useState<BlameMark[] | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState<GitFileCommit[] | null>(null);
  const [busy, setBusy] = useState<GitOp | null>(null);
  const box = useRef<HTMLSpanElement>(null);

  /** One op on this file; null (and a toast saying why) when it can't be had. */
  const call = useCallback(
    async (op: "blame" | "file-log"): Promise<GitAnswer | null> => {
      if (!local?.allowed && !(await ask())) return null;
      try {
        let r = await gitOp({ op, path, ...(workspace ? { workspace } : {}) });
        // The desktop app knows the folder it picked: tell the server once, then ask again.
        const folder = pickedFolder(ws);
        if (!r.located && workspace && folder && (await setupRoot(workspace, folder)).ok) r = await gitOp({ op, path, workspace });
        if (!r.located) {
          toast("WalkMyCode doesn't know where this project is on this computer yet: open Source Control in the top bar and give it the project's folder.");
          return null;
        }
        if (!r.ok) {
          toast(r.output || "git couldn't do that.");
          return null;
        }
        return r;
      } catch (e) {
        toast((e as Error).message);
        return null;
      }
    },
    [ask, local?.allowed, path, workspace, ws],
  );

  // Blame on, and again when the file is saved or mapped again.
  useEffect(() => {
    if (!blameOn) return;
    let gone = false;
    void call("blame").then((r) => {
      setBusy(null);
      if (gone) return;
      if (r?.blame) setBlame(blameMarks(r.blame, r.me ?? ""));
      else {
        setBlame(null);
        setBlameOn(false);
      }
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the file's text and the switch
  }, [content, blameOn]);

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

  if (!available) return { tools: null, blame: null };

  const toggleBlame = () => {
    if (blameOn) {
      setBlameOn(false);
      setBlame(null);
    } else {
      setBusy("blame");
      setBlameOn(true);
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
  return { tools, blame: blameOn ? blame : null };
}
