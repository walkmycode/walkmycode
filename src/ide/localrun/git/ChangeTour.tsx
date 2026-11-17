"use client";
// "Tour a change" in the top bar (docs/GIT.md; mockup: DiffTour): pick what to compare, this branch
// against main (or another branch, or the commit before), or the changes not committed yet, and the
// change is walked in order with its blast radius on the map (src/lib/diffTour.ts). Beside it, the
// change's size: +62 −9 · 4 files.
//
// git only reads here. In the desktop app, from the folder it opened, through the read-only route
// (POST /api/git/read), with no "run code on this computer" needed. In the full app, through the
// local-run socket, behind the same consent as Source Control. Never in WalkMyCode Lite.
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktop } from "@/lib/desktop";
import type { ChangeBases, RangeChange } from "@/lib/diffParse";
import { tourChange } from "@/lib/diffTour";
import { useWorkspace } from "@/lib/store";
import { useShell } from "@/shell/WorkspaceProvider";
import { gitOp, LOCAL_BUILD, setupRoot } from "../client";
import { useConsent } from "../Consent";
import { useLocalStatus } from "../OutputArea";
import { pickedFolder } from "./FileGit";
import { readChange } from "./readGit";
import "@/components/changeTour.css";

const NOT_LOCATED = "WalkMyCode doesn't know where this project is on this computer yet: open Source Control in the top bar and give it the project's folder.";

type Got<T> = { ok: true; value: T } | { ok: false; why: string };

export default function ChangeTour() {
  const s = useShell();
  const ws = useWorkspace();
  const local = useLocalStatus();
  const { ask, dialog } = useConsent();
  const desktop = useDesktop();
  const folder = desktop ? pickedFolder(ws) : null;
  const workspace = ws?.name;
  const viaSocket = LOCAL_BUILD && !!local?.available;
  const available = !!folder || viaSocket;
  const allowed = !!local?.allowed;

  const [open, setOpen] = useState(false);
  const [bases, setBases] = useState<ChangeBases | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /** One read: the desktop app's route, else the socket (asking first, as Source Control does). */
  const read = useCallback(
    async <T,>(base: string | null | undefined, pick: (r: { bases?: ChangeBases; change?: RangeChange }) => T | undefined): Promise<Got<T>> => {
      try {
        if (folder) {
          const r = await readChange(folder, base);
          const v = r.ok ? pick(r) : undefined;
          return v === undefined ? { ok: false, why: r.output || "git had no answer." } : { ok: true, value: v };
        }
        if (!allowed && !(await ask())) return { ok: false, why: "" };
        const op = base === undefined ? "bases" : "change";
        const q = { op, ...(base ? { base } : {}), ...(workspace ? { workspace } : {}) } as const;
        let r = await gitOp(q);
        // The desktop app knows the folder it picked: tell the server once, then ask again.
        const known = pickedFolder(ws);
        if (!r.located && workspace && known && (await setupRoot(workspace, known)).ok) r = await gitOp(q);
        if (!r.located) return { ok: false, why: NOT_LOCATED };
        const v = r.ok ? pick(r) : undefined;
        return v === undefined ? { ok: false, why: r.output || "git had no answer." } : { ok: true, value: v };
      } catch (e) {
        return { ok: false, why: (e as Error).message };
      }
    },
    [folder, allowed, ask, workspace, ws],
  );

  const show = async () => {
    if (open) return setOpen(false);
    setNote(null);
    setOpen(true);
    setBusy("bases");
    const r = await read(undefined, (x) => x.bases);
    setBusy(null);
    if (r.ok) setBases(r.value);
    else if (r.why) setNote(r.why);
    else setOpen(false);
  };

  const pick = async (base: string | null) => {
    setBusy(base ?? "");
    setNote(null);
    const r = await read(base, (x) => x.change);
    setBusy(null);
    if (!r.ok) return r.why ? setNote(r.why) : setOpen(false);
    const c = r.value;
    if (!c.files.length) {
      const what = base === null ? "Nothing here has changed since the last commit." : `No differences: ${c.head ?? "this folder"} and ${base} are the same.`;
      return setNote(what);
    }
    const t = tourChange(s.map, s.repo.files, c);
    if (!t.plan.steps.length) return setNote("Only files WalkMyCode can't show changed (taken out, or not text): nothing to walk through.");
    s.startChange(t);
    setOpen(false);
  };

  // The menu: arrow keys move, Escape closes, a click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  // Once the choices are in, the keyboard starts on the one on screen (or the first).
  useEffect(() => {
    if (open && bases) (menu.current?.querySelector<HTMLElement>("[aria-checked='true']") ?? menu.current?.querySelector<HTMLElement>("[role^='menuitem']"))?.focus();
  }, [open, bases]);
  const onKey = (e: React.KeyboardEvent) => {
    const list = [...(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };

  if (!available) return null;
  const c = s.change;
  const here = bases?.current ?? "This folder";
  const item = (key: string, base: string | null, label: React.ReactNode, hint: string) => (
    <button key={key} type="button" role="menuitemradio" tabIndex={-1} disabled={busy !== null} onClick={() => void pick(base)} aria-checked={!!c && c.base === base}>
      <span className="tick" aria-hidden>
        {busy === (base ?? "") ? "…" : c && c.base === base ? "●" : ""}
      </span>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );

  return (
    <div className="change-pick">
      <button ref={button} type="button" className={`ctl compact${c ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => void show()} title="Walk through a change, in order, with what it touches on the map">
        {c ? c.label : "Tour a change"} ▾
      </button>
      {c && (
        <span className="change-chip" title={`${c.totals.added} lines added and ${c.totals.removed} taken out, in ${c.totals.files} files`}>
          <span className="plus">+{c.totals.added}</span> <span className="minus">−{c.totals.removed}</span> · {c.totals.files === 1 ? "1 file" : `${c.totals.files} files`}
        </span>
      )}
      {open && (
        <div ref={menu} role="menu" aria-label="Tour a change" className="panel menu change-menu" onKeyDown={onKey}>
          {/* What git said (nothing changed, no repo, no git): first, where a long list of branches can't hide it. */}
          {note && (
            <p className="note menu-note change-why" role="status">
              {note}
            </p>
          )}
          {busy === "bases" ? (
            <p className="note menu-note">Asking git…</p>
          ) : bases ? (
            <>
              {item("uncommitted", null, "Uncommitted changes", "What you changed since the last commit, new files too")}
              {bases.bases.length > 0 && (
                <>
                  <hr />
                  <p className="note menu-note">
                    <b>{here}</b> as it is now, against where it left:
                  </p>
                </>
              )}
              {bases.bases.map((b) => (b === "HEAD~1" ? item(b, b, "→ the commit before", "Your last commit, and anything not committed yet") : item(b, b, `→ ${b}`, "")))}
            </>
          ) : null}
          {c && (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  s.startChange(null);
                  setOpen(false);
                }}
              >
                <span className="tick" aria-hidden />
                <span>Stop touring this change</span>
              </button>
            </>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
