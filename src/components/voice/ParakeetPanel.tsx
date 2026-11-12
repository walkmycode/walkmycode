"use client";
// Settings → Voice → Speech to text → "On this computer (Parakeet)": where
// the speech model stands on this computer, and getting or removing it
// (GET/POST /api/voice/parakeet). A copy iReliabee already downloaded is used
// where it lies and is never removed from here; only WalkMyCode's own copy
// (~/.walkmycode/models) can be. The credit line is the model licence's
// (CC-BY-4.0) attribution.
import { useCallback, useEffect, useState } from "react";
import { PARAKEET_CREDIT } from "@/lib/voice/catalogue";
import { parakeetLine, parakeetPercent, parakeetUsable, type ParakeetStatus } from "@/lib/voice/parakeet/status";
import { announceVoiceSaved } from "@/lib/voice/view";

export default function ParakeetPanel({ onStatus }: { onStatus?: (s: ParakeetStatus) => void }) {
  const [s, setS] = useState<ParakeetStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback(
    (next: ParakeetStatus) => {
      setS((was) => {
        // The model arrived or went: Talk and the Learn mic read the choice again.
        if (was && (was.state === "installed") !== (next.state === "installed")) announceVoiceSaved();
        return next;
      });
      onStatus?.(next);
    },
    [onStatus],
  );

  const load = useCallback(
    () =>
      fetch("/api/voice/parakeet")
        .then((res) => (res.ok ? (res.json() as Promise<ParakeetStatus>) : Promise.reject(new Error(String(res.status)))))
        .then(take)
        .catch(() => setErr("The WalkMyCode server couldn't say where the speech model stands.")),
    [take],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While it downloads, the numbers move.
  const installing = s?.state === "installing";
  useEffect(() => {
    if (!installing) return;
    const t = setInterval(() => void load(), 700);
    return () => clearInterval(t);
  }, [installing, load]);

  const act = async (action: "install" | "cancel" | "remove") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/voice/parakeet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const body = (await res.json().catch(() => ({}))) as ParakeetStatus & { error?: string };
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `The WalkMyCode server answered ${res.status}.`);
      take(body);
    } catch (e) {
      setErr((e as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <p className="sv-hint">{err ?? "Looking for the speech model on this computer…"}</p>;
  const pct = parakeetPercent(s);
  return (
    <div className="sv-device" data-testid="parakeet-panel" data-state={s.refusal ? "refused" : s.state}>
      {s.install.phase === "failed" && s.install.error && (
        <p className="sv-warn" role="alert">
          <b>The speech model wasn&apos;t set up.</b> {s.install.error}
        </p>
      )}
      <div className="sv-device-row">
        <span className={`mark ${parakeetUsable(s) ? "ok" : "bad"}`} aria-hidden>
          {parakeetUsable(s) ? "✓" : "✕"}
        </span>
        <p className="sv-text" role="status" data-testid="parakeet-line">
          {parakeetLine(s)}
        </p>
        {!s.refusal && (
          <span className="sv-device-acts">
            {s.state === "missing" && (
              <button type="button" className="hbtn small primary" disabled={busy} onClick={() => void act("install")} data-testid="parakeet-install">
                {s.install.phase === "failed" ? "Try again" : "Get the speech model"}
              </button>
            )}
            {s.state === "installing" && (
              <button type="button" className="sv-link quiet" disabled={busy} onClick={() => void act("cancel")} data-testid="parakeet-cancel">
                Cancel
              </button>
            )}
            {s.state === "installed" && s.removable && (
              <button type="button" className="sv-link quiet" disabled={busy} onClick={() => void act("remove")} data-testid="parakeet-remove" title="Removes WalkMyCode's own copy only, from .walkmycode/models in your home folder">
                {s.source === "ireliabee" ? "Remove WalkMyCode's own copy" : "Remove"}
              </button>
            )}
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="sv-bar" role="progressbar" aria-label="Downloading the speech model" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {s.engine.state === "ready" && s.engine.loadMs !== null && (
        <p className="sv-hint">
          In memory now: it loaded in {(s.engine.loadMs / 1000).toFixed(1)} s and uses {s.engine.threads} processor thread{s.engine.threads === 1 ? "" : "s"}.
        </p>
      )}
      {s.engine.state === "failed" && s.engine.error && (
        <p className="sv-warn" role="alert">
          {s.engine.error}
        </p>
      )}
      {err && (
        <p className="sv-warn" role="alert">
          {err}
        </p>
      )}
      <p className="sv-hint" data-testid="parakeet-credit">
        Speech model:{" "}
        <a href={PARAKEET_CREDIT.model} target="_blank" rel="noreferrer">
          NVIDIA Parakeet-TDT 0.6B v2
        </a>
        , used under the{" "}
        <a href={PARAKEET_CREDIT.licence} target="_blank" rel="noreferrer">
          CC-BY-4.0 licence
        </a>
        , run with{" "}
        <a href={PARAKEET_CREDIT.engine} target="_blank" rel="noreferrer">
          sherpa-onnx
        </a>
        .
      </p>
    </div>
  );
}
