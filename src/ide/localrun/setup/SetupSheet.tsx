"use client";
// "Set up this project": the sheet the top bar's pill grows into (one shared
// surface, so opening is the pill becoming the sheet). One row per service:
// what was checked, the exact commands, and Set up. While a service sets up,
// its steps become an activity feed in the opencode register: each command
// decodes in on its own line, the light (one element, shared across every
// row) sits on the step that is running and hops to the next as each one
// lands, the segments fill from what the installer prints, the package it is
// on ticks past, and the clock runs. A service that lands gets the INSTALLED
// stamp and folds down to its summary; one that fails gets FAILED, a shake,
// the lines that say why (the culprit lit), and "Ask the guide". The status
// line at the bottom always says what is happening now.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { motionOff, springs } from "@/lib/motion";
import type { SetupService } from "@/lib/localrun/setupTypes";
import type { CodeMap } from "@/analyzer/types";
import { useShellOptional } from "@/shell/WorkspaceProvider";
import { useGo } from "@/lib/adapters/nav";
import { Decode, Elapsed, Odometer, Segments, seconds, Stamp, useSettled } from "./kinetic";
import { useFixWithGuide } from "./FixWithGuide";
import NewProject from "./NewProject";
import {
  chooseFolder,
  createProject,
  NEW_ID,
  openNewProject,
  runnable,
  scan,
  setOpen,
  setupStore,
  setUp,
  stopAll,
  toDo,
  type ServiceRun,
  type SetupSnap,
  type StepRun,
} from "./store";

const ORDER = { "needs-setup": 0, "needs-tool": 1, ready: 2 } as const;

export default function SetupSheet({ name }: { name: string }) {
  const s = useSyncExternalStore(
    setupStore.subscribe,
    setupStore.get,
    setupStore.get,
  );
  const todo = toDo(s);
  const c = s.creating;
  // The full app: a project just made opens on the map like any indexed one (WalkMyCode for Claude's page follows its workspace by itself).
  const openWs = c?.phase === "done" ? c.workspace : undefined;
  const go = useGo();
  useEffect(() => {
    if (!openWs) return;
    void (async () => {
      const [r, st] = await Promise.all([
        fetch(`/api/demo?name=${encodeURIComponent(openWs)}`),
        import("@/lib/store"),
      ]);
      const d = (await r.json()) as {
        map?: CodeMap;
        files?: Record<string, string>;
      };
      if (d.map && d.files)
        st.setRepo({
          map: d.map,
          files: d.files,
          source: { kind: "demo", label: openWs },
        });
      // From the home page, on to the map; the sheet stays open over it (the setup carries on).
      if (!window.location.pathname.startsWith("/map")) go("/map");
    })();
  }, [openWs, go]);
  const running = !!s.batch && !s.batch.finishedAt;
  const ready = s.services.filter(
    (x) =>
      runnable(x) &&
      x.id !== NEW_ID &&
      !["done", "running", "queued"].includes(s.runs[x.id]?.status ?? ""),
  );
  const services = useMemo(
    () => [...s.services].sort((a, b) => rank(s, a) - rank(s, b)),
    [s],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const finished = s.batch?.finishedAt ? s.batch : null;
  const failedIds = finished
    ? finished.ids.filter((id) => s.runs[id]?.status === "failed")
    : [];
  const allSet =
    !!finished &&
    !failedIds.length &&
    finished.ids.every((id) => s.runs[id]?.status === "done");

  return (
    <>
      <motion.div
        className="setup-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setOpen(false)}
      />
      <motion.section
        className="setup-sheet"
        layoutId="setup-surface"
        transition={springs.settle}
        role="dialog"
        aria-label="Set up this project"
        style={{ borderRadius: 0 }}
      >
        {/* The surface morphs from the pill; what's on it fades in once it has its size, so no word is ever seen stretched. */}
        <motion.div
          className="setup-inner"
          initial={motionOff() ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          <motion.header
            className={`setup-head${allSet ? " swept" : ""}`}
            layout="position"
          >
            <div>
              <h2>
                <Decode
                  text={
                    c?.phase === "form" || c?.phase === "error"
                      ? "New project"
                      : c?.phase === "making"
                        ? `Making ${c.ask.name}`
                        : c?.phase === "opening"
                          ? `Opening ${c.ask.name}`
                          : allSet
                            ? "All set"
                            : running
                              ? "Setting up"
                              : "Set up this project"
                  }
                />
              </h2>
              <p>
                {c && c.phase !== "done" ? (
                  c.phase === "form" || c.phase === "error" ? (
                    "Made the framework's own way, set up, and opened on the map"
                  ) : (
                    (c.root ?? c.parent)
                  )
                ) : (
                  <>
                    {name} · {s.services.length} service
                    {s.services.length === 1 ? "" : "s"}
                    {todo.length > 0 && !running && (
                      <>
                        {" · "}
                        <Odometer value={todo.length} /> to do
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
            {!c && !running && (
              <button
                type="button"
                className="ctl compact"
                onClick={() => void openNewProject()}
              >
                + New project
              </button>
            )}
            <button
              type="button"
              className="setup-x"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </motion.header>

          <div className="setup-body">
            <NewProject key={`${c?.ask.starter}|${c?.ask.name}|${c?.brief ?? ""}`} />
            {(!c || !(c.phase === "form" || (c.phase === "error" && !s.runs[NEW_ID]))) && (
              <>
                {s.phase === "scanning" && !s.services.length && <ScanLines />}
                {s.phase === "needs-folder" && !c && <FolderAsk name={name} />}
                {s.phase === "error" && (
                  <p className="setup-msg bad">{s.message}</p>
                )}
                {s.phase === "ready" && !s.services.length && (
                  <p className="setup-msg">
                    No package.json, requirements.txt, pubspec.yaml or other
                    project file was found in this workspace, so there is
                    nothing to set up.
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {services
                    .filter((x) => !c || c.phase === "done" || x.id === NEW_ID)
                    .map((svc, i) => (
                      <Row
                        key={svc.id}
                        svc={svc}
                        run={s.runs[svc.id]}
                        index={i}
                        queuedAt={s.queue.indexOf(svc.id)}
                      />
                    ))}
                </AnimatePresence>
              </>
            )}
          </div>

          <StatusLine
            s={s}
            ready={ready}
            running={running}
            allSet={allSet}
            failed={failedIds.length}
          />
        </motion.div>
      </motion.section>
    </>
  );
}

function rank(s: SetupSnap, a: SetupService): number {
  const r = s.runs[a.id]?.status;
  if (r === "running") return -2;
  if (r === "queued" || r === "failed") return -1;
  return ORDER[a.state];
}

/** While the first look runs: three lines that decode, so the wait reads as work. */
function ScanLines() {
  return (
    <div className="setup-scan">
      {[
        "→ reading package files",
        "→ checking the tools on this computer",
        "→ comparing installed packages",
      ].map((t, i) => (
        <motion.p
          key={t}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...springs.settle, delay: motionOff() ? 0 : i * 0.12 }}
        >
          <Decode text={t} ms={420} />
        </motion.p>
      ))}
    </div>
  );
}

/** The full app reads folders in the browser, so the server asks once where this one is on disk. */
function FolderAsk({ name }: { name: string }) {
  const [path, setPath] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="setup-folder"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!path.trim() || busy) return;
        setBusy(true);
        setMsg(await chooseFolder(path));
        setBusy(false);
      }}
    >
      <p>
        Where is <b>{name}</b> on this computer? The page read it through the
        browser, so WalkMyCode&rsquo;s server needs its full path to check and
        install what it needs. It&rsquo;s remembered for this workspace.
      </p>
      <div className="setup-folder-row">
        <input
          className="field mono"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="C:\Users\you\projects\my-app"
          spellCheck={false}
          autoFocus
        />
        <button className="ctl primary" disabled={busy || !path.trim()}>
          {busy ? "Checking…" : "Use this folder"}
        </button>
      </div>
      {msg && <p className="setup-msg bad">{msg}</p>}
    </form>
  );
}

const STATE_LABEL = {
  "needs-setup": "needs setup",
  "needs-tool": "needs a tool",
  ready: "ready",
} as const;

function Row({
  svc,
  run,
  index,
  queuedAt,
}: {
  svc: SetupService;
  run: ServiceRun | undefined;
  index: number;
  queuedAt: number;
}) {
  const shell = useShellOptional();
  const [scope, animate] = useAnimate();
  const [showLog, setShowLog] = useState(false);
  const [stamp, setStamp] = useState<null | "ok" | "fail">(null);
  const status = run?.status ?? "idle";
  const was = useRef(status);
  // Landing: the stamp, then the row folds to its summary. Failing: the stamp and one shake.
  useEffect(() => {
    if (was.current === status) return;
    was.current = status;
    if (status !== "done" && status !== "failed") return;
    const kind = status === "done" ? "ok" : "fail";
    requestAnimationFrame(() => setStamp(kind));
    if (kind === "fail" && !motionOff() && scope.current)
      void animate(
        scope.current,
        { x: [0, -9, 8, -6, 4, -2, 0] },
        { duration: 0.42, ease: "easeOut" },
      );
  }, [status, animate, scope]);
  // The stamp lifts on its own clock, whatever re-renders meanwhile.
  useEffect(() => {
    if (!stamp) return;
    const off = setTimeout(() => setStamp(null), stamp === "ok" ? 1300 : 1500);
    return () => clearTimeout(off);
  }, [stamp]);
  const steps = run?.meta ?? svc.steps;
  const fix = useFixWithGuide(svc, run, steps.find((x) => x.id === run?.error?.step)?.shown);

  const state = status === "done" ? "ready" : svc.state;
  const live = status === "running" || status === "queued";
  const showSteps = status !== "idle";
  const ask = () => {
    const step = steps.find((x) => x.id === run?.error?.step);
    const lines = run?.error?.lines.join("\n") ?? "";
    shell?.askFree(
      `Setting up ${svc.name} (${svc.stack}) failed at \`${step?.shown ?? "a step"}\`. The output ended with:\n\n\`\`\`\n${lines}\n\`\`\`\n\nWhat went wrong, and how do I fix it?`,
    );
    setOpen(false);
  };

  return (
    <motion.article
      ref={scope}
      layout="position"
      className={`setup-row ${state}${status === "running" ? " live" : ""}${status === "failed" ? " failed" : ""}`}
      initial={motionOff() ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{
        ...springs.settle,
        delay: motionOff() ? 0 : Math.min(index, 8) * 0.045,
      }}
    >
      <header className="setup-row-head">
        <b className="mono">{svc.name}</b>
        <span className="setup-chip">{svc.stack}</span>
        <span
          className={`setup-state ${status === "failed" ? "failed" : state}`}
        >
          <Decode
            text={
              status === "failed"
                ? "failed"
                : status === "running"
                  ? "setting up"
                  : status === "queued"
                    ? `waiting · ${ordinal(queuedAt + 1)}`
                    : STATE_LABEL[state]
            }
            ms={260}
          />
        </span>
      </header>

      <AnimatePresence>
        {stamp && (
          <Stamp
            key={stamp}
            kind={stamp}
            text={stamp === "ok" ? "INSTALLED" : "FAILED"}
          />
        )}
      </AnimatePresence>

      {!showSteps && svc.state !== "ready" && (
        <motion.div layout="position" className="setup-detail">
          <ul className="setup-checks">
            {svc.checks.map((c) => (
              <li
                key={c.text}
                className={
                  c.ok === true ? "ok" : c.ok === false ? "no" : "warn"
                }
              >
                <i aria-hidden>
                  {c.ok === true ? "✓" : c.ok === false ? "✕" : "!"}
                </i>
                {c.text}
              </li>
            ))}
          </ul>
          {svc.state === "needs-setup" && (
            <>
              <pre className="setup-cmd">
                {svc.steps.map((st) => (
                  <span key={st.id}>
                    <span className="dim">$ </span>
                    {st.shown}
                    {"\n"}
                  </span>
                ))}
              </pre>
              <p className="setup-fine">
                Installing runs each package&rsquo;s own setup code, in{" "}
                {svc.id === "." ? "the project folder" : `${svc.id}/`}.
              </p>
              <div className="setup-acts">
                <button
                  type="button"
                  className="ctl primary"
                  onClick={() => setUp([svc.id])}
                >
                  Set up {svc.name}
                </button>
              </div>
            </>
          )}
          {svc.state === "needs-tool" &&
            svc.install &&
            svc.steps.length > 0 && (
              <>
                <pre className="setup-cmd">
                  <span className="dim">$ </span>
                  {svc.steps[0].shown}
                </pre>
                <p className="setup-fine">
                  WalkMyCode installs {svc.install.tool} for you, then carries
                  on with {svc.name}&rsquo;s own setup.
                  {svc.install.command.startsWith("winget")
                    ? " Windows may ask you to allow it."
                    : ""}
                </p>
                <div className="setup-acts">
                  <a
                    className="ctl"
                    href={svc.install.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    About {svc.install.tool} ↗
                  </a>
                  <button
                    type="button"
                    className="ctl primary"
                    onClick={() => setUp([svc.id])}
                  >
                    Install {svc.install.tool}
                  </button>
                </div>
              </>
            )}
          {svc.state === "needs-tool" &&
            svc.install &&
            svc.steps.length === 0 && <ToolAsk install={svc.install} />}
        </motion.div>
      )}

      {svc.state === "ready" && status === "idle" && (
        <p className="setup-ready">
          <i aria-hidden>✓</i>{" "}
          {svc.checks
            .filter((c) => c.ok)
            .map((c) => c.text)
            .join(" · ")}
        </p>
      )}

      {showSteps && run && (
        <motion.ol layout="position" className="setup-feed">
          {run.history?.map((h, k) => (
            <li key={`h${k}`} className="step done">
              <span className="step-mark">
                <i aria-hidden>✓</i>
              </span>
              <span className="step-main">
                <span className="step-cmd mono">
                  <span className="dim">→ </span>
                  {h.shown}
                </span>
                <span className="step-sum">{h.summary}</span>
              </span>
              <span className="step-time mono">
                {h.ms ? seconds(h.ms) : ""}
              </span>
            </li>
          ))}
          {steps.map((st) => (
            <StepLine
              key={st.id}
              label={st.label}
              shown={st.shown}
              r={run.steps[st.id]}
              lit={live && run.current === st.id}
              queued={status === "queued"}
            />
          ))}
        </motion.ol>
      )}

      {status === "failed" && run?.error && (
        <motion.div
          className="setup-fail"
          initial={motionOff() ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={springs.settle}
        >
          <pre>
            {run.error.lines.map((l, i) => (
              <span
                key={i}
                className={i === run.error!.hot ? "hot" : undefined}
              >
                {l}
                {"\n"}
              </span>
            ))}
          </pre>
          <div className="setup-acts">
            <button
              type="button"
              className="ctl"
              onClick={() => setShowLog((v) => !v)}
            >
              {showLog ? "Hide the full log" : "Show the full log"}
            </button>
            <button
              type="button"
              className="ctl"
              onClick={() => {
                // A new project starts its rounds again from where the files are now.
                const ask = setupStore.get().creating?.ask;
                if (svc.id === NEW_ID && ask) void createProject(ask);
                else setUp([svc.id]);
              }}
            >
              Try again
            </button>
            {shell && (
              <button type="button" className="ctl" onClick={ask}>
                Ask the guide
              </button>
            )}
            {fix.button}
          </div>
          {fix.panel}
          {showLog && (
            <pre className="setup-log">
              {Object.values(run.steps)
                .map((x) => x.log)
                .join("")}
            </pre>
          )}
        </motion.div>
      )}
    </motion.article>
  );
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"} in line`;

/** One step of the feed: the light while it runs, then ✓ or ✕ and what it came to. */
function StepLine({
  label,
  shown,
  r,
  lit,
  queued,
}: {
  label: string;
  shown: string;
  r: StepRun | undefined;
  lit: boolean;
  queued: boolean;
}) {
  const settledPhase = useSettled(r?.progress.phase ?? "");
  if (!r) return null;
  const p = r.progress;
  // Held a moment before it changes, so output that flips the phase line by line doesn't keep scrambling it.
  const phase = settledPhase.toLowerCase();
  const glyph =
    r.status === "done"
      ? "✓"
      : r.status === "failed"
        ? "✕"
        : r.status === "stopped"
          ? "■"
          : "";
  return (
    <motion.li
      layout="position"
      className={`step ${r.status}`}
      initial={motionOff() ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: queued ? 0.45 : 1, x: 0 }}
      transition={springs.settle}
    >
      <span className="step-mark">
        {lit ? (
          <motion.span
            className="setup-light"
            layoutId="setup-light"
            transition={springs.hop}
          />
        ) : (
          <i aria-hidden>{glyph || "○"}</i>
        )}
      </span>
      <span className="step-main">
        <span className="step-cmd mono">
          <span className="dim">→ </span>
          {r.status === "running" ? <Decode text={shown} ms={360} /> : shown}
        </span>
        {r.status === "running" && (
          <motion.span
            className="step-live"
            initial={motionOff() ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={springs.settle}
          >
            <span className="step-phase">
              <Decode text={phase} ms={220} className="mono" />
              {p.done > 0 && (
                <span className="step-count mono">
                  <Odometer value={p.done} />
                  {p.total ? (
                    <>
                      {" / "}
                      <Odometer value={p.total} />
                    </>
                  ) : null}
                </span>
              )}
              <Ticker name={p.pkg} />
            </span>
            <Segments fraction={p.fraction} />
          </motion.span>
        )}
        {r.status === "done" && (
          <span className="step-sum">{p.summary ?? label}</span>
        )}
        {r.status === "failed" && (
          <span className="step-sum bad">{label} didn&rsquo;t finish</span>
        )}
      </span>
      <span className="step-time mono">
        {r.status === "running" && r.startedAt ? (
          <Elapsed since={r.startedAt} />
        ) : r.ms ? (
          seconds(r.ms)
        ) : (
          ""
        )}
      </span>
    </motion.li>
  );
}

/** The package it's on: each new name slides up into place as the last one leaves. */
function Ticker({ name }: { name: string | null }) {
  return (
    <span className="ticker mono" aria-live="off">
      <AnimatePresence mode="popLayout" initial={false}>
        {name && (
          <motion.span
            key={name}
            initial={motionOff() ? false : { y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
            transition={springs.snap}
          >
            {name}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function ToolAsk({
  install,
}: {
  install: NonNullable<SetupService["install"]>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <pre className="setup-cmd">
        <span className="dim">$ </span>
        {install.command}
      </pre>
      <p className="setup-fine">
        WalkMyCode doesn&rsquo;t install system tools for you. Install{" "}
        {install.tool}, then check again.
      </p>
      <div className="setup-acts">
        <button
          type="button"
          className="ctl"
          onClick={() => {
            void navigator.clipboard?.writeText(install.command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="ctl" href={install.url} target="_blank" rel="noreferrer">
          {install.tool} ↗
        </a>
        <button type="button" className="ctl" onClick={() => void scan()}>
          Check again
        </button>
      </div>
    </>
  );
}

/** The bottom line: what is happening now, or what can happen next. */
function StatusLine({
  s,
  ready,
  running,
  allSet,
  failed,
}: {
  s: SetupSnap;
  ready: SetupService[];
  running: boolean;
  allSet: boolean;
  failed: number;
}) {
  const cur = Object.entries(s.runs).find(([, r]) => r.status === "running");
  const svc = cur ? s.services.find((x) => x.id === cur[0]) : undefined;
  const step = cur
    ? cur[1].meta.find((x) => x.id === cur[1].current)
    : undefined;
  const sr = cur && step ? cur[1].steps[step.id] : undefined;
  const took = s.batch?.finishedAt
    ? seconds(s.batch.finishedAt - s.batch.startedAt)
    : "";
  return (
    <footer className={`setup-status${running ? " on" : ""}`}>
      {running && svc && step && sr ? (
        <>
          <span className="pulse" aria-hidden />
          <span className="mono">
            {svc.name} · {step.shown}
          </span>
          {sr.startedAt && (
            <span className="mono dim">
              <Elapsed since={s.batch!.startedAt} />
            </span>
          )}
          {sr.progress.done > 0 && (
            <span className="mono dim">
              {sr.progress.done} pkg{sr.progress.done === 1 ? "" : "s"}
            </span>
          )}
          <span className="sp" />
          <button type="button" className="ctl" onClick={stopAll}>
            Stop
          </button>
        </>
      ) : (
        <>
          <span className={`mono ${allSet ? "good" : failed ? "bad" : "dim"}`}>
            {allSet
              ? `all set · ${s.batch!.ids.length} service${s.batch!.ids.length === 1 ? "" : "s"} · ${took}`
              : failed
                ? `${failed} failed · ${took}`
                : "esc to close"}
          </span>
          <span className="sp" />
          <button type="button" className="ctl" onClick={() => setOpen(false)}>
            Close
          </button>
          {ready.length > 0 && (
            <button
              type="button"
              className="ctl primary"
              onClick={() => setUp(ready.map((x) => x.id))}
            >
              Set up {ready.length > 1 ? `all ${ready.length}` : ready[0].name}
            </button>
          )}
        </>
      )}
    </footer>
  );
}
