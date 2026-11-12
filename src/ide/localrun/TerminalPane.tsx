"use client";
// The terminals in the Output area: a strip of tabs (one per shell, "+" opens
// another, with the shell to use), and the one shown, drawn by xterm.js. The
// shells live in ./client.ts, not here: this view can be unmounted and mounted
// again (docked, popped out, the Output tab chosen) and finds the shell still
// running, with what it printed so far. Resizing follows the panel.
import { LOOK_EVENT, textScale } from "@/lib/look";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { closeTerminal, localStatus, MIN_COLS, openTerminal, selectTerminal, termInput, termResize, terminals } from "./client";
import "./localrun.css";

/** Whether the first terminal was opened by showing this tab (so closing them all does not open another). */
let opened = false;

export default function TerminalPane() {
  const { terms, active } = useSyncExternalStore(terminals.subscribe, terminals.get, terminals.get);
  const shells = useSyncExternalStore(localStatus.subscribe, localStatus.get, localStatus.get).status?.shells ?? [];
  const [shell, setShell] = useState("");

  useEffect(() => {
    if (!opened && terminals.get().terms.length === 0) {
      opened = true;
      openTerminal(undefined, 100, 24);
    }
  }, []);

  const info = terms.find((t) => t.id === active) ?? null;
  return (
    <div className="lr-terms">
      <div className="lr-term-tabs" role="tablist" aria-label="Terminals">
        {terms.map((t, i) => (
          <span key={t.id} className={`lr-term-tab${t.id === active ? " on" : ""}`} role="presentation">
            <button type="button" role="tab" aria-selected={t.id === active} onClick={() => selectTerminal(t.id)} title={t.exited ? "This shell has ended" : t.label}>
              {i + 1}: {t.label}
              {t.exited ? " (ended)" : ""}
            </button>
            <button type="button" className="x" aria-label={`Close terminal ${i + 1}`} title="Close this terminal (its shell is killed)" onClick={() => closeTerminal(t.id)}>
              ×
            </button>
          </span>
        ))}
        <span className="sp" />
        {shells.length > 1 && (
          <select aria-label="Shell for a new terminal" value={shell} onChange={(e) => setShell(e.target.value)}>
            <option value="">{shells[0]?.label} (default)</option>
            {shells.slice(1).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="add" title="Open another terminal" aria-label="Open another terminal" onClick={() => openTerminal(shell || undefined, 100, 24)}>
          +
        </button>
      </div>
      {info?.mode === "line" && (
        <p className="lr-term-note">
          Line mode: a real terminal could not start here{info.why ? ` (${info.why})` : ""}. Each line is sent when you press Enter; programs that draw the screen will not work.
        </p>
      )}
      {info ? (
        <XtermView key={info.id} id={info.id} />
      ) : (
        <div className="lr-term-empty">
          <button type="button" className="lr-btn" onClick={() => openTerminal(shell || undefined, 100, 24)}>
            Open a terminal
          </button>
        </div>
      )}
    </div>
  );
}

/** How long a size must hold before the shell is told it (a panel opening is done by then). */
const SETTLE_MS = 250;

const THEME = {
  background: "#0f1512",
  foreground: "#e6e1d6",
  cursor: "#f3d77a",
  selectionBackground: "#f3d77a55",
};
/** The terminal's colours with its background and text from the theme (Settings → Motion & look). */
function themed(el: HTMLElement) {
  const css = getComputedStyle(el);
  return { ...THEME, background: css.getPropertyValue("--out").trim() || THEME.background, foreground: css.getPropertyValue("--ui-text").trim() || THEME.foreground };
}

function XtermView({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let term: Terminal | null = null;
    let gone = false;
    const undo: (() => void)[] = [];
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (gone) return;
      const t = new Terminal({
        fontFamily: getComputedStyle(el).getPropertyValue("--mono").trim() || "ui-monospace, Consolas, monospace",
        fontSize: Math.round(13 * textScale()),
        cursorBlink: true,
        scrollback: 5000,
        theme: themed(el),
        allowProposedApi: false,
      });
      term = t;
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.open(el);
      // Text & icon size (Settings → Motion & look): the terminal's text follows it.
      const onLook = () => {
        t.options.fontSize = Math.round(13 * textScale());
        t.options.theme = themed(el);
        try {
          fit.fit();
        } catch {
          /* not laid out yet */
        }
      };
      window.addEventListener(LOOK_EVENT, onLook);
      undo.push(() => window.removeEventListener(LOOK_EVENT, onLook));
      // What it printed while this view was not there.
      const before = terminals.info(id)?.history;
      if (before) t.write(before);
      undo.push(terminals.onData(id, (d) => t.write(d)));

      // Line mode keeps the line here, echoes it, and sends it on Enter.
      let line = "";
      const sub = t.onData((d) => {
        const info = terminals.info(id);
        if (!info || info.exited) return;
        if (info.mode !== "line") return termInput(id, d);
        for (const ch of d) {
          if (ch === "\r") {
            t.write("\r\n");
            termInput(id, `${line}\n`);
            line = "";
          } else if (ch === "\x7f" || ch === "\b") {
            if (line) {
              line = line.slice(0, -1);
              t.write("\b \b");
            }
          } else if (ch === "\x03") {
            t.write("^C\r\n");
            line = "";
          } else if (ch >= " ") {
            line += ch;
            t.write(ch);
          }
        }
      });
      undo.push(() => sub.dispose());

      // The view fits at once; the shell hears the size only once it has held for a moment. A panel
      // opening (the dock laying it out, sliding in) passes through narrow widths, and a shell told it is
      // 40 columns wide keeps what it printed then wrapped at 40 (the prompt, a typed line) for good.
      let told = "";
      let settle = 0;
      const size = () => {
        if (!el.isConnected || el.clientWidth < 20 || el.clientHeight < 20) return;
        const d = fit.proposeDimensions();
        if (!d || d.cols < MIN_COLS || d.rows < 2) return;
        try {
          fit.fit();
        } catch {
          return;
        }
        clearTimeout(settle);
        settle = window.setTimeout(() => {
          const now = `${t.cols}x${t.rows}`;
          if (now === told) return;
          told = now;
          termResize(id, t.cols, t.rows);
        }, SETTLE_MS);
      };
      size();
      let frame = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(size);
      });
      ro.observe(el);
      undo.push(() => {
        clearTimeout(settle);
        cancelAnimationFrame(frame);
        ro.disconnect();
      });
      t.focus();
    })();
    return () => {
      gone = true;
      undo.forEach((f) => f());
      term?.dispose();
    };
  }, [id]);
  return <div className="lr-term-body" ref={host} aria-label="Terminal" />;
}
