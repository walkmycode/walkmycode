"use client";
// Settings → This computer: "Run on: This computer" and the terminal
// (src/lib/localrun). Off until the user allows it; here it is allowed,
// revoked (every run and shell is killed at once), and the time limit set.
// Once allowed: the toolchains found on PATH with their versions, or exactly
// what to install, and the shells the terminal can open. Not in Lite (no
// server of its own) and refused in hosted mode, which this pane says.
import { useState } from "react";
import { useConsent, ConsentText } from "@/ide/localrun/Consent";
import { loadLocalStatus, setAllowed, setTimeoutS } from "@/ide/localrun/client";
import { useLocalStatus } from "@/ide/localrun/OutputArea";
import { Box, Cols, Status } from "./parts";
import "@/ide/localrun/localrun.css";

export default function ComputerPane() {
  const status = useLocalStatus();
  const { ask, dialog } = useConsent();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [limit, setLimit] = useState<string | null>(null);

  if (!status) return <p className="sv-loading">Loading…</p>;
  if (!status.available) {
    return (
      <Box label="Running code on this computer">
        <p className="sv-text">{status.reason ?? "Not available here."}</p>
      </Box>
    );
  }

  const revoke = async () => {
    setBusy(true);
    const s = await setAllowed(false);
    setBusy(false);
    setNote(s && !s.allowed ? { ok: true, text: "Turned off. Every run and terminal was stopped." } : { ok: false, text: "Could not turn it off: try again." });
  };
  const allow = async () => {
    if (await ask()) setNote({ ok: true, text: "Allowed on this computer." });
  };
  const saveLimit = async () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 3600) return setNote({ ok: false, text: "Give a whole number of seconds, 1 to 3600." });
    const s = await setTimeoutS(n);
    setLimit(null);
    setNote(s ? { ok: true, text: `Runs now stop after ${s.timeout_s} s.` } : { ok: false, text: "Not saved." });
  };

  return (
    <Cols>
      <div>
        <Box label="Running code on this computer">
          <div className="sv-row" style={{ marginTop: 0 }}>
            <span className={`lr-state${status.allowed ? " on" : ""}`}>{status.allowed ? "Allowed" : "Off"}</span>
            {status.allowed ? (
              <button type="button" className="lr-btn" onClick={() => void revoke()} disabled={busy}>
                Revoke
              </button>
            ) : (
              <button type="button" className="lr-btn primary" onClick={() => void allow()}>
                Allow…
              </button>
            )}
            <Status s={note} />
          </div>
          {status.allowed && status.allowed_at && <p className="sv-hint">Allowed on {new Date(status.allowed_at).toLocaleString()}. Saved in .walkmycode/config.json.</p>}
          <div className="sv-text lr-pane" style={{ marginTop: 12 }}>
            <ConsentText />
          </div>
        </Box>
        <Box label="Time limit">
          <div className="sv-row lr-pane" style={{ marginTop: 0 }}>
            <label className="sv-text" htmlFor="lr-limit">
              A run is stopped after
            </label>
            <input id="lr-limit" type="number" min={1} max={3600} value={limit ?? String(status.timeout_s)} onChange={(e) => setLimit(e.target.value)} />
            <span className="sv-text">seconds.</span>
            {limit !== null && (
              <button type="button" className="lr-btn" onClick={() => void saveLimit()}>
                Save
              </button>
            )}
          </div>
          <p className="sv-hint">Stop kills a run at once, with everything it started. The terminal has no time limit.</p>
        </Box>
      </div>
      <div>
        <Box label="Toolchains on PATH">
          {!status.allowed ? (
            <p className="sv-text">Shown once it is allowed: finding them runs each one&rsquo;s --version.</p>
          ) : (
            <>
              <table className="lr-tools">
                <thead>
                  <tr>
                    <th>Language</th>
                    <th>Runs with</th>
                  </tr>
                </thead>
                <tbody>
                  {status.toolchains.map((t) => (
                    <tr key={t.lang}>
                      <td>{t.label}</td>
                      <td>
                        {t.path ? (
                          <span className="ok" title={t.path}>
                            <code>{t.cmd}</code> {t.version}
                          </span>
                        ) : (
                          <span className="missing">
                            Not installed. {t.note ? `${t.note} ` : ""}
                            {t.install}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sv-row">
                <button type="button" className="lr-btn" onClick={() => void loadLocalStatus({ detect: true })}>
                  Look again
                </button>
                <span className="sv-hint" style={{ margin: 0 }}>
                  After installing one, look again (or restart WalkMyCode if PATH changed).
                </span>
              </div>
            </>
          )}
        </Box>
        {status.allowed && (
          <Box label="Terminal">
            <p className="sv-text">
              {status.shells.length ? `Shells: ${status.shells.map((s, i) => (i === 0 ? `${s.label} (default)` : s.label)).join(", ")}.` : "No shell was found."}
            </p>
            {status.terminal?.mode === "line" && (
              <p className="sv-warn">
                A real terminal could not start here{status.terminal.why ? ` (${status.terminal.why})` : ""}, so the terminal is in line mode: each line is sent on Enter, and programs that draw the screen do not work.
              </p>
            )}
          </Box>
        )}
      </div>
      {dialog}
    </Cols>
  );
}
