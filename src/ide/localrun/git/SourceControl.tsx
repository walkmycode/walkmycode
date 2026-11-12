"use client";
// Source Control: the workspace's git repo, from the top bar. The button shows
// the branch and how many files changed; it grows into a sheet (as the Set up
// pill does). Changes: tick files, read a file's diff, discard one, write the
// message (or have the guide write it from the diff), Commit or Commit & push.
// History: the last commits. The branch name opens the branches: switch, or
// make one. A merge in progress shows its conflicts with "keep mine", "keep
// theirs" or "I fixed it", then Finish or Abort. It all runs through the
// user's own git and sign-in (src/lib/localrun/git.ts), so no GitHub token is
// kept. Only where code can run on this computer (the full app, WalkMyCode for
// Claude; never Lite), behind the same consent as the terminal.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { motionOff, springs } from "@/lib/motion";
import { useWorkspace } from "@/lib/store";
import { useShellOptional } from "@/shell/WorkspaceProvider";
import type { GitBranch, GitCommit, GitFile, GitStatus } from "@/lib/localrun/git";
import type { GitAsk } from "@/lib/localrun/protocol";
import { cleanDraft, draftPrompt } from "@/lib/localrun/gitDraft";
import { gitOp, LOCAL_BUILD, setupRoot, type GitAnswer } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import "./git.css";

const LETTER: Record<GitFile["change"], string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflicted: "!", type: "T" };
const WORD: Record<GitFile["change"], string> = { modified: "changed", added: "new (staged)", deleted: "deleted", renamed: "renamed", untracked: "new", conflicted: "has a conflict", type: "type changed" };

type Run = (a: Omit<GitAsk, "workspace">) => Promise<GitAnswer | null>;

interface Repo {
  located: boolean;
  status: GitStatus | null;
}

export default function SourceControl() {
  const local = useLocalStatus();
  const ws = useWorkspace();
  const workspace = ws?.name;
  const { ask, dialog } = useConsent();
  const ready = LOCAL_BUILD && !!local?.available;
  const allowed = !!local?.allowed;

  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run: Run = useCallback(
    async (a) => {
      const quiet = a.op === "status" || a.op === "diff" || a.op === "branches" || a.op === "log" || a.op === "draft";
      if (!quiet) setBusy(a.op === "pull" && a.merge ? "merge" : a.op);
      try {
        const r = await gitOp({ ...a, ...(workspace ? { workspace } : {}) });
        setRepo({ located: r.located, status: r.status });
        if (!quiet || !r.ok) setNote(r.output || !r.ok ? { ok: r.ok, text: r.output ?? "" } : null);
        return r;
      } catch (e) {
        setNote({ ok: false, text: (e as Error).message });
        return null;
      } finally {
        if (!quiet) setBusy(null);
      }
    },
    [workspace],
  );

  // A look when allowed and for each workspace, and again whenever the window comes back (an edit, a commit in the terminal).
  useEffect(() => {
    if (!ready || !allowed) return;
    const again = () => void run({ op: "status" });
    const first = setTimeout(again, 0);
    window.addEventListener("focus", again);
    return () => {
      clearTimeout(first);
      window.removeEventListener("focus", again);
    };
  }, [ready, allowed, run]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  if (!ready) return null;
  const st = repo?.status ?? null;
  const count = st?.files.length ?? 0;
  const conflicts = st?.files.filter((f) => f.change === "conflicted").length ?? 0;

  const show = async () => {
    if (!allowed && !(await ask())) return;
    setOpen(true);
    setNote(null);
    void run({ op: "status" });
  };

  return (
    <>
      {!open && (
        <motion.button
          type="button"
          layoutId="git-surface"
          transition={springs.settle}
          className={`ctl compact git-btn${conflicts ? " conflict" : ""}`}
          onClick={() => void show()}
          data-tip={st ? `Source control · ${st.branch ?? "detached"}${count ? ` · ${count} changed` : ""}${conflicts ? ` · ${conflicts} in conflict` : ""}` : "Source control"}
          aria-label={`Source control${count ? `, ${count} changed files` : ""}`}
          style={{ borderRadius: 0 }}
        >
          <BranchIcon />
          {st?.branch && <span className="git-branch">{st.branch}</span>}
          {count > 0 && <span className="git-n">{count}</span>}
          {!!st?.ahead && (
            <span className="git-ahead" title={`${st.ahead} commit${st.ahead === 1 ? "" : "s"} to push`}>
              ↑{st.ahead}
            </span>
          )}
        </motion.button>
      )}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>{open && <Sheet key="git" repo={repo} busy={busy} note={note} setNote={setNote} run={run} close={() => setOpen(false)} workspace={workspace} />}</AnimatePresence>,
          document.querySelector(".root") ?? document.body,
        )}
      {dialog}
    </>
  );
}

function Sheet(p: {
  repo: Repo | null;
  busy: string | null;
  note: { ok: boolean; text: string } | null;
  setNote(n: { ok: boolean; text: string } | null): void;
  run: Run;
  close(): void;
  workspace: string | undefined;
}) {
  const shell = useShellOptional();
  const st = p.repo?.status ?? null;
  const files = useMemo(() => st?.files ?? [], [st]);
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [message, setMessage] = useState("");
  /** Files the user unticked (so a file that turns up later is ticked). */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);

  const committable = files.filter((f) => f.change !== "conflicted");
  const picked = committable.filter((f) => !off.has(f.path));
  const all = !!committable.length && picked.length === committable.length;
  const canCommit = !!picked.length && !!message.trim() && !p.busy && !st?.merging;
  const pathsOf = (fs: GitFile[]) => fs.flatMap((f) => (f.from ? [f.path, f.from] : [f.path]));

  const toggle = (path: string) => {
    const next = new Set(off);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOff(next);
  };

  const showDiff = async (path: string) => {
    if (diff?.path === path) return setDiff(null);
    const r = await p.run({ op: "diff", path });
    setDiff(r?.ok ? { path, text: r.output ?? "" } : null);
  };

  const commit = async (thenPush: boolean) => {
    if (!canCommit) return;
    const r = await p.run({ op: "commit", paths: pathsOf(picked), message });
    if (!r?.ok) return;
    setMessage("");
    setOff(new Set());
    setDiff(null);
    if (thenPush) await p.run({ op: "push" });
  };

  const discard = async (f: GitFile) => {
    setConfirm(null);
    if (diff?.path === f.path) setDiff(null);
    await p.run({ op: "discard", paths: [f.path] });
  };

  // "Write it for me": the guide, through whichever AI is set up, writes the message from the ticked files' diff.
  const draft = async () => {
    if (!shell || !picked.length || drafting) return;
    setDrafting(true);
    p.setNote(null);
    try {
      const d = await p.run({ op: "draft", paths: picked.map((f) => f.path) });
      if (!d?.ok || !d.output) return;
      const { ask, emptyConversation } = await import("@/lib/claude/client");
      const prompt = draftPrompt(d.output);
      const r = await ask({
        repo: shell.repoView,
        conversation: emptyConversation(),
        user: prompt,
        mode: "ask",
        request: { kind: "deep", payload: { text: prompt.slice(0, 20_000) } },
        onText: (t) => setMessage(cleanDraft(t)),
      });
      setMessage(cleanDraft(r.text));
    } catch (e) {
      p.setNote({ ok: false, text: `The guide couldn't write it: ${(e as Error).message}` });
    } finally {
      setDrafting(false);
    }
  };

  // A file that left the list (committed, discarded, resolved) takes its diff with it.
  const shown = diff && files.some((f) => f.path === diff.path) ? diff : null;
  const behindAndAhead = !!st && st.ahead > 0 && st.behind > 0;
  const anyConflict = files.some((f) => f.change === "conflicted");

  return (
    <>
      <motion.div className="setup-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={p.close} />
      <motion.section className="git-sheet" layoutId="git-surface" transition={springs.settle} role="dialog" aria-label="Source control" style={{ borderRadius: 14 }}>
        <motion.div
          className="git-inner"
          initial={motionOff() ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          <header className="git-head">
            <div>
              {st ? (
                <button type="button" className="git-title" onClick={() => setBranchesOpen((v) => !v)} aria-expanded={branchesOpen} title="Switch branch or make one">
                  <BranchIcon /> <span>{st.branch ?? "detached HEAD"}</span> <span className="git-caret">▾</span>
                </button>
              ) : (
                <h2>
                  <BranchIcon /> Source control
                </h2>
              )}
              <p>
                {!p.repo
                  ? p.note && !p.note.ok
                    ? p.note.text
                    : "Looking at the repo…"
                  : !p.repo.located
                    ? "WalkMyCode doesn't know where this project is on this computer yet."
                    : !st
                      ? "This folder isn't a git repo yet."
                      : st.upstream
                        ? `${st.ahead ? `${st.ahead} to push` : "nothing to push"}${st.behind ? ` · ${st.behind} to pull` : ""} · ${st.upstream}`
                        : st.fresh
                          ? "No commits yet."
                          : "Not on GitHub yet: Push sends this branch to origin."}
              </p>
            </div>
            {st && (
              <div className="git-actions">
                <button
                  type="button"
                  className="ctl compact"
                  disabled={!!p.busy || !!st.merging}
                  onClick={() => void p.run({ op: "pull", merge: behindAndAhead })}
                  title={behindAndAhead ? "Both sides have new commits: git pull --no-rebase (conflicts, if any, show here)" : "git pull --ff-only"}
                >
                  {p.busy === "pull" || p.busy === "merge" ? "Pulling…" : behindAndAhead ? "Pull & merge" : `Pull${st.behind ? ` ${st.behind}` : ""}`}
                </button>
                <button type="button" className={`ctl compact${st.ahead || !st.upstream ? " primary" : ""}`} disabled={!!p.busy || st.fresh || !!st.merging} onClick={() => void p.run({ op: "push" })} title="git push">
                  {p.busy === "push" ? "Pushing…" : `Push${st.ahead ? ` ${st.ahead}` : ""}`}
                </button>
              </div>
            )}
            <button type="button" className="git-x" onClick={p.close} aria-label="Close">
              ×
            </button>
          </header>

          <AnimatePresence>{st && branchesOpen && <Branches key="br" run={p.run} busy={p.busy} done={() => setBranchesOpen(false)} />}</AnimatePresence>

          {p.repo && !p.repo.located && <FindFolder workspace={p.workspace} found={() => void p.run({ op: "status" })} />}
          {p.repo?.located && !st && (
            <p className="git-empty">
              Make it one in the terminal (Ctrl+`): <code>git init</code>, then <code>git remote add origin &lt;your GitHub repo&apos;s URL&gt;</code>.
            </p>
          )}

          {st?.merging && (
            <div className="git-merge" role="status">
              <span>
                <b>{st.merging === "rebase" ? "Rebasing." : "Merging."}</b> {anyConflict ? "Settle each file marked ! below, then finish." : "Nothing left in conflict."}
              </span>
              <button type="button" className="ctl compact" disabled={!!p.busy} onClick={() => void p.run({ op: "finish", abort: true })}>
                Abort
              </button>
              <button type="button" className="ctl compact primary" disabled={!!p.busy || anyConflict} onClick={() => void p.run({ op: "finish" })}>
                {st.merging === "rebase" ? "Continue rebase" : "Finish merge"}
              </button>
            </div>
          )}

          {st && (
            <nav className="git-tabs" aria-label="Source control views">
              <button type="button" className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")}>
                Changes{files.length ? ` · ${files.length}` : ""}
              </button>
              <button type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")} disabled={st.fresh}>
                History
              </button>
            </nav>
          )}

          {st && tab === "history" && <History run={p.run} />}

          {st && tab === "changes" && (
            <div className="git-body">
              <div className="git-files">
                <div className="git-files-head">
                  <label>
                    <input type="checkbox" checked={all} disabled={!committable.length} onChange={() => setOff(all ? new Set(committable.map((f) => f.path)) : new Set())} />
                    {files.length ? `${files.length} changed file${files.length === 1 ? "" : "s"}` : "No changes"}
                  </label>
                  <button type="button" className="git-link" onClick={() => void p.run({ op: "status" })}>
                    Refresh
                  </button>
                </div>
                <ul>
                  {files.map((f) => {
                    const slash = f.path.lastIndexOf("/");
                    const conflicted = f.change === "conflicted";
                    return (
                      <li key={f.path} className={`${shown?.path === f.path ? "on" : ""}${conflicted ? " conflicted" : ""}`}>
                        {conflicted ? <span className="git-box-gap" aria-hidden /> : <input type="checkbox" checked={!off.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Include ${f.path}`} />}
                        <button type="button" className="git-file" onClick={() => void showDiff(f.path)} title={`${f.path} · ${WORD[f.change]}${f.from ? ` from ${f.from}` : ""}`}>
                          <span className="git-name">{f.path.slice(slash + 1)}</span>
                          {slash > 0 && <span className="git-dir">{f.path.slice(0, slash)}</span>}
                        </button>
                        {conflicted ? (
                          <span className="git-resolve">
                            <button type="button" disabled={!!p.busy} onClick={() => void p.run({ op: "resolve", path: f.path, how: "ours" })} title="Keep your version of this file">
                              Mine
                            </button>
                            <button type="button" disabled={!!p.busy} onClick={() => void p.run({ op: "resolve", path: f.path, how: "theirs" })} title="Keep the incoming version of this file">
                              Theirs
                            </button>
                            <button type="button" disabled={!!p.busy} onClick={() => void p.run({ op: "resolve", path: f.path, how: "done" })} title="I edited the file and took the <<<<<<< ======= >>>>>>> markers out">
                              Fixed
                            </button>
                          </span>
                        ) : confirm === f.path ? (
                          <span className="git-confirm">
                            {f.change === "untracked" ? "Delete it?" : "Undo changes?"}
                            <button type="button" className="yes" onClick={() => void discard(f)}>
                              Yes
                            </button>
                            <button type="button" onClick={() => setConfirm(null)}>
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="git-discard"
                            disabled={!!p.busy || (st.fresh && f.change !== "untracked")}
                            onClick={() => setConfirm(f.path)}
                            title={f.change === "untracked" ? "Delete this new file" : "Throw away this file's changes (back to the last commit)"}
                            aria-label={`Discard ${f.path}`}
                          >
                            ↺
                          </button>
                        )}
                        <span className={`git-letter c-${f.change}`}>{LETTER[f.change]}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {shown && <Diff path={shown.path} text={shown.text} />}
            </div>
          )}

          {st && tab === "changes" && (
            <footer className="git-foot">
              <div className="git-msg">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void commit(false);
                    }
                  }}
                  placeholder={st.merging ? "Finish the merge first" : "What does this change do? (Ctrl+Enter commits)"}
                  rows={2}
                  maxLength={10_000}
                  disabled={!!st.merging}
                />
                {shell && (
                  <button type="button" className="git-write" disabled={!picked.length || drafting || !!st.merging} onClick={() => void draft()} title="The guide reads the ticked files' changes and writes the message">
                    {drafting ? "Writing…" : "✦ Write it for me"}
                  </button>
                )}
              </div>
              <div className="git-foot-row">
                {p.note ? (
                  <pre className={`git-note${p.note.ok ? " ok" : " bad"}`}>{p.note.text || (p.note.ok ? "Done." : "Git said no.")}</pre>
                ) : (
                  <span className="dim">{picked.length ? `${picked.length} of ${committable.length} ticked` : files.length ? "Tick the files to commit" : ""}</span>
                )}
                <button type="button" className="ctl compact" disabled={!canCommit} onClick={() => void commit(false)}>
                  {p.busy === "commit" ? "Committing…" : "Commit"}
                </button>
                <button type="button" className="ctl compact primary" disabled={!canCommit} onClick={() => void commit(true)}>
                  Commit &amp; push
                </button>
              </div>
            </footer>
          )}
          {st && tab === "history" && p.note && (
            <footer className="git-foot">
              <pre className={`git-note${p.note.ok ? " ok" : " bad"}`}>{p.note.text}</pre>
            </footer>
          )}
        </motion.div>
      </motion.section>
    </>
  );
}

/** The branches: switch to one, or make one from here. */
function Branches({ run, busy, done }: { run: Run; busy: string | null; done(): void }) {
  const [list, setList] = useState<GitBranch[] | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    void run({ op: "branches" }).then((r) => setList(r?.branches ?? []));
  }, [run]);
  const go = async (n: string, create: boolean) => {
    const r = await run({ op: "switch", name: n, create });
    if (r?.ok) done();
  };
  return (
    <motion.div className="git-branches" initial={motionOff() ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}>
      <ul>
        {list === null && <li className="dim">Looking…</li>}
        {list?.map((b) => (
          <li key={b.name}>
            <button type="button" disabled={b.current || !!busy} onClick={() => void go(b.name, false)}>
              <span className={b.current ? "cur" : ""}>
                {b.current ? "● " : ""}
                {b.name}
              </span>
              {b.upstream && <span className="dim">{b.upstream}</span>}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void go(name.trim(), true);
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new-branch-name" spellCheck={false} aria-label="New branch name" />
        <button type="submit" className="ctl compact" disabled={!name.trim() || !!busy}>
          Make branch
        </button>
      </form>
    </motion.div>
  );
}

/** The last commits on this branch. */
function History({ run }: { run: Run }) {
  const [log, setLog] = useState<GitCommit[] | null>(null);
  useEffect(() => {
    void run({ op: "log" }).then((r) => setLog(r?.log ?? []));
  }, [run]);
  if (log === null) return <p className="git-empty">Reading the history…</p>;
  if (!log.length) return <p className="git-empty">No commits yet.</p>;
  return (
    <ol className="git-log">
      {log.map((c) => (
        <li key={c.hash}>
          <span className="git-subject">{c.subject}</span>
          <span className="git-meta">
            <code>{c.hash}</code> · {c.author} · {c.when}
            {c.refs && <span className="git-refs">{c.refs.replace(/^HEAD -> /, "")}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The full app: where this workspace is on this computer (remembered for Set up too). */
function FindFolder({ workspace, found }: { workspace: string | undefined; found(): void }) {
  const [path, setPath] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const save = async () => {
    if (!workspace || !path.trim()) return;
    const r = await setupRoot(workspace, path.trim());
    if (r.ok) found();
    else setWhy(r.message ?? "That folder can't be used.");
  };
  return (
    <form
      className="git-find"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p>Where is this project on your computer? Paste its folder and WalkMyCode will find its git repo.</p>
      <div>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\you\projects\my-app" spellCheck={false} aria-label="The project's folder" />
        <button type="submit" className="ctl compact primary" disabled={!path.trim() || !workspace}>
          Use this folder
        </button>
      </div>
      {why && <p className="bad">{why}</p>}
    </form>
  );
}

/** A unified diff, its lines coloured: headers dim, hunks blue, added green, removed pink. */
function Diff({ path, text }: { path: string; text: string }) {
  const lines = text.split("\n").filter((l) => !/^(diff --git|index |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l));
  return (
    <div className="git-diff" aria-label={`Changes in ${path}`}>
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith("+++") || l.startsWith("---") ? "h" : l.startsWith("@@") ? "k" : l.startsWith("+") ? "a" : l.startsWith("-") ? "d" : l.startsWith("\\") ? "h" : ""}>
          {l || " "}
        </div>
      ))}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg className="git-ico" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="12.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.5" cy="5.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 5.25v5.5M11.5 7.25c0 2.5-3 2.5-5.5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
