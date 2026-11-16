"use client";
// The desktop app's update (docs/DESKTOP.md, "Updates"; mockup docs/design/update-modal.html): what the
// new version brings, how big it is and what happens next, then the download and install as they go.
// "Later" closes it and leaves UpdateChip in the title bar; "Skip this version" stays quiet until a newer
// one. The state is lib/update.ts; the app (src-tauri/src/lib.rs) checks, downloads, installs, restarts.
import { useEffect } from "react";
import Sheet from "./Sheet";
import { megabytes, releaseNotes, type NoteKind } from "@/lib/releaseNotes";
import { checkForUpdateOnce, closeUpdate, openUpdate, skipUpdate, startInstall, useUpdate } from "@/lib/update";
import "./update.css";

const KIND: Record<NoteKind, string> = { new: "New", fixed: "Fixed", better: "Better", changed: "Changed" };
const SHOWN = 5;
const PUBLIC_REPO = "https://github.com/walkmycode/walkmycode";

const day = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
};

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <path d="M14 3v4M11 25h6" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="7" width="12" height="14" stroke="currentColor" strokeWidth="2" />
      <rect x="12" y="11" width="4" height="6" fill="currentColor" />
    </svg>
  );
}

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
);

/** The title bar's reminder after "Later": an update waiting, or the one downloading. */
export function UpdateChip() {
  const u = useUpdate();
  useEffect(() => checkForUpdateOnce(), []);
  if (!u.info || u.open) return null;
  const busy = u.phase === "downloading" || u.phase === "installing";
  const pct = u.total ? Math.min(100, Math.round((u.got / u.total) * 100)) : null;
  return (
    <button type="button" className="update-chip" onClick={openUpdate} title={`WalkMyCode ${u.info.version} is ready to install`} data-testid="update-chip">
      <i aria-hidden />
      {busy ? `Updating${pct === null ? "" : ` ${pct}%`}` : `Update ${u.info.version}`}
    </button>
  );
}

export default function UpdateModal() {
  const u = useUpdate();
  if (!u.info || !u.open) return null;
  const { info, phase } = u;
  const notes = releaseNotes(info.notes);
  const busy = phase === "downloading" || phase === "installing";
  const pct = phase === "installing" ? 100 : u.total ? Math.min(100, (u.got / u.total) * 100) : 0;
  const releaseUrl = `${PUBLIC_REPO}/releases/tag/v${info.version}`;

  return (
    <Sheet labelledBy="update-title" onClose={closeUpdate} className={`update ${phase}`}>
      <header className="update-hero">
        {phase !== "installing" && (
          <button type="button" className="update-x" aria-label="Later" onClick={closeUpdate}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        )}
        <div className="update-mark">
          <Mark />
        </div>
        <div>
          <div className={`update-eyebrow ${phase}`}>
            <i aria-hidden />
            {phase === "available" ? "Update available" : phase === "downloading" ? "Updating" : phase === "installing" ? "Almost there" : "Update didn't finish"}
          </div>
          <h2 className="update-title" id="update-title">
            WalkMyCode <b>{info.version}</b>
          </h2>
        </div>
      </header>

      {phase === "available" && (
        <>
          <dl className="update-facts">
            <div>
              <dt>Version</dt>
              <dd>
                {info.current} <span className="arrow">→</span> <span className="new">{info.version}</span>
              </dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{day(info.date)}</dd>
            </div>
            <div>
              <dt>Download</dt>
              <dd>{info.size ? megabytes(info.size) : "—"}</dd>
            </div>
          </dl>
          <div className="update-notes">
            <h3>What&apos;s new</h3>
            {notes.length ? (
              <ul>
                {notes.slice(0, SHOWN).map((n, i) => (
                  <li key={i}>
                    <span className={`update-kind ${n.kind}`}>{KIND[n.kind]}</span>
                    <span className="update-what">
                      {n.area && <span className="area">{n.area}</span>}
                      {n.text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="update-none">Fixes and improvements.</p>
            )}
            <a className="update-all" href={releaseUrl} target="_blank" rel="noopener noreferrer">
              {notes.length > SHOWN ? `All ${notes.length} changes` : "Release notes"} <span aria-hidden>↗</span>
            </a>
          </div>
          <p className="update-safe">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M8 1.5l5.5 2v4.2c0 3.3-2.3 5.7-5.5 6.8-3.2-1.1-5.5-3.5-5.5-6.8V3.5z" />
              <path d="M5.5 8l1.8 1.8L10.8 6.3" />
            </svg>
            <span>Signed by WalkMyCode and checked before it installs. Your projects, keys and settings stay as they are. WalkMyCode closes, installs and opens again in about a minute.</span>
          </p>
          <footer className="update-foot">
            <button type="button" className="update-link" onClick={skipUpdate}>
              Skip this version
            </button>
            <span className="sp" />
            <button type="button" className="ctl" onClick={closeUpdate}>
              Later
            </button>
            <button type="button" className="ctl primary" data-autofocus onClick={() => void startInstall()} data-testid="update-install">
              Install and restart
            </button>
          </footer>
        </>
      )}

      {busy && (
        <div className="update-progress">
          <div className="update-stage">
            <b>{phase === "installing" ? "Installing, then WalkMyCode opens again" : "Downloading the update"}</b>
            <span>
              {phase === "installing"
                ? u.total
                  ? megabytes(u.total)
                  : ""
                : `${megabytes(u.got)}${u.total ? ` of ${megabytes(u.total)}` : ""}${u.speed ? ` · ${megabytes(u.speed)}/s` : ""}`}
            </span>
          </div>
          <div className="update-bar" role="progressbar" aria-label="Update progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <i style={{ width: `${pct}%` }} className={u.total || phase === "installing" ? "" : "unknown"} />
          </div>
          <ol className="update-steps">
            <li className="done">
              <Tick />
              Found and verified
            </li>
            <li className={phase === "downloading" ? "now" : "done"}>
              {phase === "downloading" ? <span className="spin" aria-hidden /> : <Tick />}
              {phase === "downloading" ? "Downloading" : "Downloaded"}
            </li>
            <li className={phase === "installing" ? "now" : ""}>
              {phase === "installing" ? <span className="spin" aria-hidden /> : <span className="dot" aria-hidden />}
              Install and reopen
            </li>
          </ol>
          <p className="update-small">
            {phase === "installing" ? "Don't turn off the computer. This window closes and comes back on its own." : "You can keep working while it downloads: close this and the title bar shows how it's going."}
          </p>
        </div>
      )}

      {phase === "failed" && (
        <>
          <div className="update-err" role="alert">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 4.5v4.2M8 11v.5" />
            </svg>
            <div>
              <b>The download stopped.</b> Your WalkMyCode is unchanged and still {info.current}. Check the connection and try again, or get the installer from walkmycode.com.
              {u.error && <code>{u.error}</code>}
            </div>
          </div>
          <footer className="update-foot">
            <a className="update-link" href="https://walkmycode.com/#install" target="_blank" rel="noopener noreferrer">
              Get it from walkmycode.com ↗
            </a>
            <span className="sp" />
            <button type="button" className="ctl" onClick={closeUpdate}>
              Later
            </button>
            <button type="button" className="ctl primary" data-autofocus onClick={() => void startInstall()}>
              Try again
            </button>
          </footer>
        </>
      )}
    </Sheet>
  );
}
