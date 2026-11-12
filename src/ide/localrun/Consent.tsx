"use client";
// The one-time question before WalkMyCode runs anything on this computer:
// "Allow WalkMyCode to run code and open a terminal on this computer", with the
// risk said plainly. A modal <dialog> drawn where it is asked (so it opens in
// a popped-out window too); the answer is saved by the server
// (.walkmycode/config.json) and can be revoked in Settings → This computer.
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { localStatus, setAllowed } from "./client";
import "./localrun.css";

export const CONSENT_TITLE = "Allow WalkMyCode to run code and open a terminal on this computer";

export function ConsentText() {
  return (
    <>
      <p>
        When you press <b>Run</b> on &ldquo;This computer&rdquo;, or type in the terminal, the code and commands run as <b>you</b>, with the programs
        installed here: they can read, change and delete your files, use your network, and see anything your account can.
        It is the same as running them in your own terminal.
      </p>
      <ul>
        <li>Only run code you trust. Code from a repository you don&rsquo;t know can do real harm.</li>
        <li>Nothing runs until you press Run or type in the terminal: WalkMyCode and its AI never start anything by themselves.</li>
        <li>Only this browser, on this computer, can do it: other sites and other machines are refused.</li>
        <li>You can turn it off again at any time in Settings → This computer.</li>
      </ul>
    </>
  );
}

/** `ask()` shows the question and resolves true once the user allowed it (and the server saved it). */
export function useConsent(): { ask: () => Promise<boolean>; dialog: ReactNode } {
  const ref = useRef<HTMLDialogElement>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const ask = useCallback(() => {
    answer.current?.(false);
    setErr("");
    return new Promise<boolean>((done) => {
      answer.current = done;
      const d = ref.current;
      if (!d) return done(false);
      if (!d.open) d.showModal();
    });
  }, []);

  const finish = (ok: boolean) => {
    const f = answer.current;
    answer.current = null;
    if (ref.current?.open) ref.current.close();
    f?.(ok);
  };

  const allow = async () => {
    setBusy(true);
    const s = await setAllowed(true);
    setBusy(false);
    if (s?.allowed) finish(true);
    // Why it failed, when known: the server's own words, or that it isn't running at all.
    else setErr(s?.reason ?? (localStatus.get().error || "WalkMyCode's server did not save it. Try again."));
  };

  const dialog = (
    <dialog ref={ref} className="lr-consent" aria-labelledby={titleId} onClose={() => finish(false)} onCancel={() => finish(false)}>
      <h2 id={titleId}>{CONSENT_TITLE}?</h2>
      <ConsentText />
      {err && <p className="lr-err">{err}</p>}
      <div className="lr-actions">
        <button type="button" className="lr-btn" onClick={() => finish(false)} autoFocus>
          Not now
        </button>
        <button type="button" className="lr-btn primary" onClick={() => void allow()} disabled={busy}>
          {busy ? "Allowing…" : "Allow on this computer"}
        </button>
      </div>
    </dialog>
  );
  return { ask, dialog };
}
