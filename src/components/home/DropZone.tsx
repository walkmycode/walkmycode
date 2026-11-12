"use client";
// The home page's one door (docs/design/home-redesign.html): drop a project
// folder, choose one, or put several together into one workspace. While a drag
// with files is over the page the zone glows; while a map is being made it shows
// how far it got. The page (src/app/page.tsx) owns what happens; this draws it.
import { DROP_TIP } from "@/lib/folderPrompt";
import { defaultName } from "@/lib/workspace";
import { FolderIcon, LampArt, LockIcon } from "./icons";
import type { RepoRow } from "./types";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

interface Props {
  mode: "door" | "several";
  /** A drag carrying files is over the page. */
  over: boolean;
  lite: boolean;
  busy: string | null;
  progress: number;
  repos: RepoRow[];
  name: string;
  /** Maps indexed on the command line, which can join the workspace being put together. */
  indexed: string[];
  onName: (v: string) => void;
  onChoose: () => void;
  onSeveral: () => void;
  onAdd: () => void;
  onAddIndexed: (name: string) => void;
  onRefresh: (i: number) => void;
  onRemove: (i: number) => void;
  onMap: () => void;
  onCancel: () => void;
  onHow: () => void;
  /** Say that dropping the folder skips the browser's question (the fallback folder input only). */
  dropTip?: boolean;
}

/** The analysis progress bar. Only transforms move, so it keeps gliding while
 * the parser holds the main thread; the dot is the fill's sibling, never
 * inside it, so the fill's scaleX never squashes it. */
function ProgressBar({ value }: { value: number }) {
  const p = Math.max(0, Math.min(1, value));
  return (
    <div className="progressbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} style={{ ["--p" as string]: p }}>
      <div className="fill">
        <i />
      </div>
      <div className="rail">
        <span className="pdot" />
      </div>
    </div>
  );
}

function Lamp() {
  return (
    <div className="drop-lamp" aria-hidden>
      <div className="drop-halo" />
      <LampArt />
    </div>
  );
}

export default function DropZone(p: Props) {
  const busy = p.busy && (
    <div className="drop-busy">
      <ProgressBar value={p.progress} />
      <p className="drop-step" role="status">
        {p.busy}
      </p>
    </div>
  );
  const cls = `drop${p.mode === "several" ? " several" : ""}${p.over ? " over" : ""}${p.busy ? " busy" : ""}`;

  if (p.mode === "several") {
    const labels = p.repos.map((r) => r.label);
    const total = p.repos.reduce((s, r) => s + r.files.length, 0);
    return (
      <section id="door" className={cls} aria-labelledby="door-h">
        <div className="build">
          <div className="build-h">
            <Lamp />
            <div>
              <h2 id="door-h">{p.over ? "Let go to add them" : "Several folders, one map"}</h2>
              <p>A web app and its API, say. Add each folder; WalkMyCode draws one map of them all and follows calls from one to the other.</p>
            </div>
          </div>
          {p.repos.length ? (
            <ul className="build-list">
              {p.repos.map((r, i) => (
                <li key={`${r.label}-${i}`} className="build-row">
                  <FolderIcon />
                  <div className="nm">
                    <b title={r.label}>{r.label}</b>
                    <span className="meta">
                      {plural(r.files.length, "file")}
                      {r.kind === "demo" ? " · indexed" : ""}
                      {r.capped ? " · only the first part" : ""}
                    </span>
                  </div>
                  <div className="acts">
                    {r.handle && (
                      <button type="button" className="hbtn small ghost" disabled={!!p.busy} onClick={() => p.onRefresh(i)} title="Read this folder again from disk">
                        Refresh
                      </button>
                    )}
                    <button type="button" className="hbtn small ghost" disabled={!!p.busy} onClick={() => p.onRemove(i)} aria-label={`Remove ${r.label}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="build-empty">No folders yet. Add them one by one, or drop them all on this box.</p>
          )}
          <div className="build-add">
            <button type="button" className="hbtn small" disabled={!!p.busy} onClick={p.onAdd}>
              <FolderIcon size={16} />
              Add a folder
            </button>
            {p.indexed.length > 0 && (
              <>
                <span className="lbl">or an indexed repo:</span>
                {p.indexed.map((n) => (
                  <button key={n} type="button" className="build-chip" disabled={!!p.busy || labels.includes(n)} onClick={() => p.onAddIndexed(n)} title="Add its files to this workspace">
                    + {n}
                  </button>
                ))}
              </>
            )}
          </div>
          {p.repos.length > 1 && (
            <label className="build-name">
              <span>Name this workspace</span>
              <input value={p.name} placeholder={defaultName(labels)} onChange={(e) => p.onName(e.target.value)} spellCheck={false} />
            </label>
          )}
          {busy}
          <div className="build-foot">
            <span className="count">{p.repos.length ? `${plural(total, "file")} in ${plural(p.repos.length, "folder")}` : ""}</span>
            <button type="button" className="hbtn ghost" disabled={!!p.busy} onClick={p.onCancel}>
              Cancel
            </button>
            <button type="button" className="hbtn primary" disabled={!!p.busy || !p.repos.length} onClick={p.onMap}>
              {p.repos.length > 1 ? `Map ${p.repos.length} folders` : "Map it"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="door" className={cls} aria-labelledby="door-h">
      <Lamp />
      <h2 id="door-h">{p.busy ? "Drawing your map" : p.over ? "Let go to map it" : "Drop a project folder here"}</h2>
      {busy || (
        <>
          <div className="drop-or">or</div>
          <div className="drop-row">
            <button type="button" className="hbtn primary" onClick={p.onChoose}>
              <FolderIcon />
              Choose a folder
            </button>
            <button type="button" className="hbtn ghost" onClick={p.onSeveral}>
              Add several (web + API)
            </button>
          </div>
          {p.dropTip && <p className="drop-tip">{DROP_TIP}</p>}
        </>
      )}
      <p className="drop-trust">
        <LockIcon />
        {p.lite ? "Read in this browser. Only the lines you ask about go to Claude, on your own plan." : "Read on this computer. Only the lines you ask about go to your AI."}
        <button type="button" onClick={p.onHow}>
          How it works
        </button>
      </p>
    </section>
  );
}
