"use client";
// "Fix with guide" on a failed setup step: the guide reads the error and comes
// back with why it failed and the one command that fixes it
// (src/lib/localrun/fixGuide.ts). The command goes into the terminal, in the
// step's folder, for the user to read and run with Enter, then Try again. The
// page never runs it itself. A command that can do damage says so first.
import { useState } from "react";
import { motion } from "motion/react";
import { motionOff, springs } from "@/lib/motion";
import type { SetupService } from "@/lib/localrun/setupTypes";
import { fixPrompt, inFolder, osName, readFix, risk, type Fix } from "@/lib/localrun/fixGuide";
import { useShellOptional } from "@/shell/WorkspaceProvider";
import { outputs } from "../../outputStore";
import { typeInTerminal } from "../client";
import { useLocalStatus } from "../OutputArea";
import type { ServiceRun } from "./store";

type State = { phase: "idle" } | { phase: "thinking" } | { phase: "ready"; fix: Fix } | { phase: "error"; message: string };

/** The button for the row's actions, and the panel that shows what the guide came back with. */
export function useFixWithGuide(svc: SetupService, run: ServiceRun | undefined, stepShown: string | undefined) {
  const shell = useShellOptional();
  const local = useLocalStatus();
  const [s, setS] = useState<State>({ phase: "idle" });
  const [typed, setTyped] = useState(false);
  const [copied, setCopied] = useState(false);

  const go = async () => {
    if (!shell || !run?.error) return;
    setS({ phase: "thinking" });
    setTyped(false);
    const os = osName(navigator.userAgent);
    const prompt = fixPrompt({ service: svc.name, stack: svc.stack, step: stepShown ?? "a step", output: run.steps[run.error.step]?.log || run.error.lines.join("\n"), os, shell: local?.shells[0]?.label ?? (os === "Windows" ? "PowerShell" : "bash") });
    try {
      const { ask, emptyConversation, AskError } = await import("@/lib/claude/client");
      const once = () => ask({ repo: shell.repoView, conversation: emptyConversation(), user: prompt, mode: "ask", request: { kind: "deep", payload: { text: prompt.slice(0, 20_000) } } });
      // Some models (Groq's GPT-OSS) now and then "call" a tool named json that
      // was never offered, and the provider rejects it. A second try usually lands.
      const r = await once().catch((e) => {
        if (e instanceof AskError && /tool call validation|not in request\.tools/i.test(e.info.detail ?? "")) return once();
        throw e;
      });
      const fix = readFix(r.text);
      setS(fix ? { phase: "ready", fix } : { phase: "error", message: "The guide didn't come back with a fix. Try Ask the guide for a longer answer." });
    } catch (e) {
      const detail = (e as { info?: { detail?: string } }).info?.detail;
      setS({ phase: "error", message: `The guide couldn't look at it: ${(e as Error).message}${detail ? ` (${detail.slice(0, 300)})` : ""}` });
    }
  };

  const toTerminal = async (command: string) => {
    try {
      await typeInTerminal((shellId) => inFolder(shellId, run?.cwd, command), () => outputs.show());
      setTyped(true);
    } catch (e) {
      setS({ phase: "error", message: (e as Error).message });
    }
  };

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no clipboard: the command is on screen to select
    }
  };

  const button = shell ? (
    <button type="button" className="ctl primary" onClick={() => void go()} disabled={s.phase === "thinking"}>
      {s.phase === "thinking" ? "The guide is looking…" : s.phase === "ready" ? "Ask again" : "Fix with guide"}
    </button>
  ) : null;

  const panel =
    s.phase === "ready" || s.phase === "error" ? (
      <motion.div className="setup-fix" initial={motionOff() ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle} role="status">
        {s.phase === "error" ? (
          <p className="bad">{s.message}</p>
        ) : (
          <>
            {s.fix.why && <p>{withCode(s.fix.why)}</p>}
            {s.fix.command ? (
              <>
                <code className="setup-fix-cmd mono">{s.fix.command}</code>
                {risk(s.fix.command) && <p className="setup-fix-risk">Read this one carefully before you run it: it {risk(s.fix.command)}.</p>}
                <div className="setup-acts">
                  <button type="button" className="ctl primary" onClick={() => void toTerminal(s.fix.command!)}>
                    Put it in the terminal
                  </button>
                  <button type="button" className="ctl" onClick={() => void copy(s.fix.command!)}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="dim">{typed ? "It's in the terminal, in this project's folder. Press Enter there to run it, then Try again." : "Nothing runs until you press Enter in the terminal."}</p>
              </>
            ) : (
              <p className="dim">That one isn&apos;t a command: do the above, then Try again.</p>
            )}
          </>
        )}
      </motion.div>
    ) : null;

  return { button, panel };
}

/** The reason's `code` and **bold** as such, not as raw marks. */
function withCode(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+?\*\*)/g)
    .filter(Boolean)
    .map((p, i) => (p.length > 2 && p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p.length > 4 && p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));
}
