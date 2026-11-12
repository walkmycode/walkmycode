"use client";
// The pieces every Settings pane is made of (docs/design/home-redesign.html,
// screen 3): a box with a small caps label, two columns that become one when
// the pane is narrow, and one key on this computer.
import { useRef, useState } from "react";
import { removeKey, saveKey, copyFoundKey, type KeyStanding } from "@/lib/aiConfig";

export function Box({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`sv-box${className ? ` ${className}` : ""}`}>
      {label && <h3 className="sv-lbl">{label}</h3>}
      {children}
    </section>
  );
}

/** The pane's two columns (wide panes), one under the other otherwise. */
export function Cols({ children }: { children: React.ReactNode }) {
  return <div className="sv-cols">{children}</div>;
}

export function Status({ s }: { s: { ok: boolean; text: string } | null }) {
  if (!s) return null;
  return (
    <span key={s.text} className={`sv-status${s.ok ? "" : " bad"}`} role="status">
      {s.text}
    </span>
  );
}

interface KeyLineProps {
  envVar: string;
  label: string;
  /** null = not known (the local server's optional token). */
  standing: KeyStanding | null;
  /** How the provider's keys start ("sk-ant-"), shown masked when a key is set. */
  prefix?: string;
  url?: string;
  hint?: string;
  onChanged: (now: KeyStanding) => void;
}

/** One key: where it stands, Add or Replace (a password field, sent once to
 * POST /api/config/key and emptied as soon as the server has it), and Remove
 * when Settings saved it; when another WalkMyCode on this computer already saved
 * it, "Use the one in …" copies it server-side. The value never comes back from the server. */
export function KeyLine({ envVar, label, standing, prefix = "", url, hint, onChanged }: KeyLineProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const has = !!standing?.has_key;

  async function save() {
    const value = input.current?.value.trim() ?? "";
    if (busy || !value) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveKey(envVar, value);
      if (input.current) input.current.value = "";
      setTyped(false);
      setOpen(false);
      setMsg({ ok: true, text: "Saved" });
      onChanged({ has_key: true, source: "settings" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function takeFound() {
    setBusy(true);
    setMsg(null);
    try {
      await copyFoundKey(envVar);
      setOpen(false);
      setMsg({ ok: true, text: "Saved" });
      onChanged({ has_key: true, source: "settings" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      const { has_key } = await removeKey(envVar);
      setMsg({ ok: true, text: has_key ? "Removed; the one in .env.local still counts" : "Removed" });
      onChanged({ has_key, source: has_key ? "env" : null });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const where = standing === null ? "optional" : has ? `${prefix}•••• · ${standing.source === "settings" ? "saved here" : "from .env.local"}` : "not set";
  return (
    <div className="sv-key">
      <div className="sv-key-row">
        <b>{label}</b>
        <span className={`sv-key-where${has ? " set" : ""}`} title={envVar}>
          {where}
        </span>
        <span className="sv-key-acts">
          {!has && standing?.found && !open && (
            <button type="button" className="sv-link" onClick={() => void takeFound()} disabled={busy} title={`Copy the ${label} key already saved in ${standing.found} on this computer`}>
              Use the one in {standing.found}
            </button>
          )}
          {!open && (
            <button type="button" className={`sv-link${!has && standing?.found ? " quiet" : ""}`} onClick={() => setOpen(true)} disabled={busy}>
              {has ? "Replace" : "Add"}
            </button>
          )}
          {standing?.source === "settings" && !open && (
            <button type="button" className="sv-link quiet" onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          )}
        </span>
      </div>
      {open && (
        <form
          className="sv-key-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            ref={input}
            className="sv-input mono"
            type={shown ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder={has ? "Paste the new key" : "Paste the key"}
            aria-label={`${label} key`}
            onInput={(e) => setTyped(!!e.currentTarget.value.trim())}
          />
          <button type="button" className="hbtn small ghost" onClick={() => setShown((v) => !v)}>
            {shown ? "Hide" : "Show"}
          </button>
          <button type="submit" className="hbtn small primary" disabled={busy || !typed}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="hbtn small ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      )}
      {(open || msg) && (
        <p className="sv-key-note">
          {msg && <Status s={msg} />} {open && hint}
          {open && url && (
            <>
              {" "}
              <a href={url} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
