"use client";
// The top bar's "Set up" pill (./SetupSheet.tsx is what it grows into). It
// appears only when something needs doing: "Set up · 2 to do". While setup
// runs (the sheet open or not) it carries a ring that fills with the whole
// job's progress, the service on, and the percentage rolling; when it lands,
// "all set" for a moment, then it goes. Before the user has allowed running
// code on this computer it can't look at the project, so it's a quiet icon
// that asks first. Only where code can run here (the app, WalkMyCode for
// Claude; never Lite).
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { motionOff, springs } from "@/lib/motion";
import { useWorkspace } from "@/lib/store";
import { LOCAL_BUILD } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import { Decode, Odometer } from "./kinetic";
import SetupSheet from "./SetupSheet";
import { overall, scan, setOpen, setupStore, setWorkspace, toDo } from "./store";
import "./setup.css";

/** How long "all set" stays in the top bar before the pill goes. */
const ALL_SET_MS = 4000;

export default function SetupPill() {
  const status = useLocalStatus();
  const ws = useWorkspace();
  const name = ws?.name ?? "this project";
  const s = useSyncExternalStore(setupStore.subscribe, setupStore.get, setupStore.get);
  const { ask, dialog } = useConsent();
  const allowed = !!status?.allowed;
  const ready = LOCAL_BUILD && !!status?.available;

  // The first look, once allowed, and again for another workspace.
  useEffect(() => {
    if (!ready || !allowed) return;
    setWorkspace(ws?.name);
    void scan();
  }, [ready, allowed, ws?.name]);

  // "all set" stays a moment after the job lands, then the pill leaves.
  const finishedAt = s.batch?.finishedAt ?? null;
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!finishedAt) return;
    const t = setTimeout(() => setExpired(finishedAt), ALL_SET_MS);
    return () => clearTimeout(t);
  }, [finishedAt]);
  const recent = finishedAt !== null && expired !== finishedAt;

  if (!ready) return null;
  const running = !!s.batch && !s.batch.finishedAt;
  const todo = toDo(s);
  const failed = s.batch?.finishedAt ? s.batch.ids.filter((id) => s.runs[id]?.status === "failed").length : 0;
  const allSet = recent && !failed;
  // Always there where code can run: a quiet icon when nothing needs doing (it still opens "New project").
  const idle = allowed && !running && !todo.length && !recent && s.phase !== "needs-folder" && !failed;

  const open = async () => {
    if (!allowed && !(await ask())) return;
    setOpen(true);
    if (s.phase === "idle" || s.phase === "error") void scan();
  };

  const cur = running ? s.services.find((x) => s.runs[x.id]?.status === "running") : undefined;
  const frac = overall(s) ?? 0;
  const label = !allowed ? "" : running ? `setting up · ${cur?.name ?? "…"}` : allSet ? "all set" : failed ? `${failed} failed` : s.phase === "needs-folder" ? "set up · find the folder" : "set up";

  return (
    <>
      <AnimatePresence>
        {!s.open && (
          <motion.button
            key="pill"
            type="button"
            layoutId="setup-surface"
            className={`ctl compact setup-pill${running ? " running" : ""}${allSet ? " good" : ""}${failed ? " bad" : ""}${!allowed || idle ? " quiet" : ""}`}
            onClick={() => void open()}
            initial={motionOff() ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={springs.settle}
            style={{ borderRadius: 0 }}
            data-tip={!allowed ? "Check what this project needs to run" : idle ? "Set up · new project" : undefined}
            aria-label={!allowed ? "Check what this project needs to run" : `Set up this project: ${label}`}
            title={allowed && !idle ? `Set up this project: ${label}` : undefined}
          >
            <Ring fraction={running ? frac : allSet ? 1 : 0} spinning={running && frac === 0} />
            {allowed && !idle && (
              <span className="setup-pill-text mono">
                {/* On a narrower bar the ring and the count stay; the words go to the tooltip. */}
                <span className="setup-pill-label">
                  <Decode text={label} ms={300} />
                </span>
                {running ? (
                  <span className="dim">
                    {" "}
                    <Odometer value={Math.round(frac * 100)} />%
                  </span>
                ) : !allSet && !failed && todo.length > 0 ? (
                  <span className="setup-pill-n">
                    <Odometer value={todo.length} />
                  </span>
                ) : null}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
      {/* At the app's root (where the fonts are set), so no panel or bar can sit over it or clip it. */}
      {typeof document !== "undefined" && createPortal(<AnimatePresence>{s.open && <SetupSheet key="sheet" name={name} />}</AnimatePresence>, document.querySelector(".root") ?? document.body)}
      {dialog}
    </>
  );
}

/** A ring that fills with progress (and turns slowly while there's no figure yet); a wrench-like mark inside. */
function Ring({ fraction, spinning }: { fraction: number; spinning: boolean }) {
  const C = 2 * Math.PI * 7;
  return (
    <svg className={`setup-ring${spinning ? " spin" : ""}`} viewBox="0 0 18 18" width="18" height="18" aria-hidden>
      <circle cx="9" cy="9" r="7" className="track" />
      <circle cx="9" cy="9" r="7" className="fill" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.04, Math.min(1, fraction)))} />
      <path d="M6.6 9.2l1.6 1.6 3.3-3.6" className="tick" style={{ opacity: fraction >= 1 ? 1 : 0 }} />
      <circle cx="9" cy="9" r="1.6" className="dot" style={{ opacity: fraction >= 1 ? 0 : 1 }} />
    </svg>
  );
}
