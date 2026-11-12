// "Run this code" from outside the editor: the voice lecturer's run_code
// (src/lib/voice/lecturer/tools.ts). Every IDE (Ide.tsx) registers itself
// here and says when it is used; `codeRoom.run()` runs the one in use now and
// answers with a short summary. Safe by construction: an IDE runs only in the
// page's own sandbox for this (MicroPython in its worker, JavaScript in a
// worker, sql.js), never on the laptop; a run is stopped after a time limit,
// and what comes back is cut short. Pure, so the tests drive it with a fake.
import type { OutPart } from "./python";

/** What an IDE lends the registry. */
export interface RunnableIde {
  /** "python", "sql", … */
  language: string;
  /** The file or room, for the answer. */
  label: string;
  /** Why this IDE cannot run code for the lecturer now, or null when it can. */
  blocked(): string | null;
  /** Run the code in the page's sandbox; resolves with the output once the run is done. */
  run(): Promise<OutPart[]>;
  /** Stop a run that went on too long. */
  stop(): void;
}

export interface CodeRunResult {
  ok: boolean;
  output: string;
  error: string;
  language?: string;
  label?: string;
}

export const RUN_TIMEOUT_MS = 20_000;
export const OUTPUT_LIMIT = 1500;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters cut)` : s);

/** A run's parts as text: what it printed, and its error apart. */
export function summarise(parts: OutPart[], limit = OUTPUT_LIMIT): { output: string; error: string } {
  let output = "";
  let error = "";
  for (const p of parts) {
    if (p.kind === "error") error += p.text;
    else if (p.kind === "image") output += "[a plot was drawn]\n";
    else if (p.kind === "table") output += [p.columns.join(" | "), ...p.rows.slice(0, 10).map((r) => r.join(" | ")), p.rows.length > 10 ? `(${p.rows.length} rows)` : ""].filter(Boolean).join("\n") + "\n";
    else if (p.kind === "value") output += `→ ${p.text}\n`;
    else output += p.text;
  }
  return { output: cut(output.trim(), limit), error: cut(error.trim(), Math.round(limit / 2)) };
}

export function createCodeRoom(o: { timeoutMs?: number; limit?: number } = {}) {
  const timeoutMs = o.timeoutMs ?? RUN_TIMEOUT_MS;
  const limit = o.limit ?? OUTPUT_LIMIT;
  const ides = new Map<string, RunnableIde>();
  let order: string[] = []; // most recently used last

  const touch = (id: string) => {
    order = [...order.filter((x) => x !== id), id];
  };

  return {
    /** An IDE opened; it is the one in use until another is. Returns the undo. */
    register(id: string, ide: RunnableIde) {
      ides.set(id, ide);
      touch(id);
      return () => {
        if (ides.get(id) !== ide) return;
        ides.delete(id);
        order = order.filter((x) => x !== id);
      };
    },
    /** The user ran, clicked or typed in this IDE. */
    use(id: string) {
      if (ides.has(id)) touch(id);
    },
    current(): RunnableIde | null {
      const id = order.at(-1);
      return id ? (ides.get(id) ?? null) : null;
    },
    /** Run the code in the IDE in use now. Never throws. */
    async run(): Promise<CodeRunResult> {
      const ide = this.current();
      if (!ide) return { ok: false, output: "", error: "No code is open: open a file, or the Code room, first." };
      const why = ide.blocked();
      const who = { language: ide.language, label: ide.label };
      if (why) return { ok: false, output: "", error: why, ...who };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), timeoutMs)));
      try {
        const parts = await Promise.race([ide.run(), late]);
        if (parts === "late") {
          ide.stop();
          return { ok: false, output: "", error: `Stopped after ${Math.round(timeoutMs / 1000)} seconds: the code took too long.`, ...who };
        }
        const s = summarise(parts, limit);
        return { ok: !s.error, ...s, ...who };
      } catch (e) {
        return { ok: false, output: "", error: cut(String((e as Error)?.message ?? e), limit), ...who };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The lecturer's answer: short JSON, as its other tools answer. */
export function runAnswer(r: CodeRunResult): string {
  const where = r.label ? { file: r.label, language: r.language } : {};
  return r.ok
    ? JSON.stringify({ ok: true, ...where, output: r.output || "(it printed nothing)" })
    : JSON.stringify({ ok: false, ...where, error: r.error, ...(r.output ? { output: r.output } : {}) });
}

/** The page's one registry. */
export const codeRoom = createCodeRoom();
