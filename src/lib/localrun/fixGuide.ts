// "Fix with guide" on a failed setup step (src/ide/localrun/setup/SetupSheet.tsx):
// what the guide is asked, its reply read as one reason and at most one
// command, a warning on commands that can do damage, and that command put in
// the step's folder for the shell the terminal opens. The command is only ever
// typed into the terminal for the user to read and run with Enter: the page
// never runs a command itself (src/lib/localrun/hub.ts runs planned steps only).

export interface FixAsk {
  service: string;
  stack: string;
  /** The command that failed, as the feed showed it. */
  step: string;
  /** The last lines it printed. */
  output: string;
  /** "Windows", "macOS", "Linux". */
  os: string;
  /** The terminal's shell, as the user sees it ("PowerShell 7", "zsh"). */
  shell: string;
}

export interface Fix {
  why: string;
  /** One command to run, or null when the fix isn't a command (edit a file, install something by hand). */
  command: string | null;
}

/** A long output, cut to its start and its end: tools often name the cause first (npm's
 * ERESOLVE lists the clashing packages at the top) and say how they ended last. */
export function keepEnds(output: string, head = 2000, tail = 4000): string {
  if (output.length <= head + tail) return output;
  const start = output.slice(0, head).replace(/\n[^\n]*$/, "");
  const end = output.slice(-tail).replace(/^[^\n]*\n/, "");
  const cut = output.length - start.length - end.length;
  return `${start}\n… (${cut} characters cut) …\n${end}`;
}

export function fixPrompt(a: FixAsk): string {
  return [
    `Setting up ${a.service} (${a.stack}) on ${a.os} failed while running \`${a.step}\`. Its output (the middle cut when long):`,
    "",
    "```",
    keepEnds(a.output),
    "```",
    "",
    "Go by this output: the package names and versions in it win over anything you remember about the code.",
    `Find the cause and give the single command that fixes it, for ${a.shell} on ${a.os}, run in the project's folder.`,
    "Prefer the smallest safe fix: no sudo or admin unless there is no other way, nothing that deletes outside the project.",
    "If the fix is not a command (edit a file, install something by hand), give no command and say what to do.",
    // Plain lines, not JSON: asked for JSON while tools are offered, some models
    // (Groq's GPT-OSS) "call" a tool named json, and the provider rejects the turn.
    "Answer as two plain lines, as your reply text:",
    "WHY: one or two plain sentences a beginner understands",
    "COMMAND: the command, or NONE",
  ].join("\n");
}

/** The model's reply as a fix; null when it isn't one. Takes WHY:/COMMAND: lines, or JSON (fenced or among other words). */
export function readFix(text: string): Fix | null {
  const body = text.replace(/```(?:json|\w+)?/gi, "");
  const lines = fromLines(body) ?? fromJson(body);
  if (!lines) return null;
  const why = lines.why.trim();
  const raw = lines.command?.trim().replace(/^`+|`+$/g, "").replace(/^\$\s+/, "") ?? "";
  const command = raw && !/^(none|null|n\/a)$/i.test(raw) ? raw : null;
  if (!why && !command) return null;
  // One line only: a line break would run the first part the moment it is typed.
  if (command && /[\r\n]/.test(command)) return { why: why || "The guide's fix is several commands.", command: command.split(/\r?\n/).map((l) => l.trim().replace(/^\$\s+/, "")).filter(Boolean).join(" && ") };
  return { why, command };
}

function fromLines(body: string): { why: string; command: string | null } | null {
  const m = /^\s*\**WHY\**\s*:\**\s*([\s\S]*?)^\s*\**COMMAND\**\s*:\**\s*([\s\S]*)$/im.exec(body);
  return m ? { why: m[1].replace(/\s+/g, " "), command: m[2].trim().split(/\r?\n\s*\r?\n/)[0] } : null; // stop at a blank line: prose after it isn't the command
}

function fromJson(body: string): { why: string; command: string | null } | null {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1)) as { why?: unknown; command?: unknown };
    return { why: typeof v.why === "string" ? v.why : "", command: typeof v.command === "string" ? v.command : null };
  } catch {
    return null;
  }
}

const RISKY: [RegExp, string][] = [
  [/\brm\s+(-\w*r\w*f|-\w*f\w*r)\b|\brm\s+-rf?\b/i, "deletes files"],
  [/\bRemove-Item\b.*-Recurse/i, "deletes files"],
  [/\b(del|erase|rd|rmdir)\b.*\/s\b/i, "deletes files"],
  [/\bsudo\b|\brunas\b|Start-Process\b.*-Verb\s+RunAs/i, "runs as administrator"],
  [/\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b.*\|\s*(sh|bash|zsh|iex|Invoke-Expression)\b/i, "downloads a script and runs it"],
  [/\bformat\b\s+[a-z]:|\bmkfs\b|\bdd\s+if=/i, "can wipe a disk"],
  [/\bchmod\s+-R\s+777\b|\bchown\s+-R\b/i, "changes permissions widely"],
  [/\bgit\s+(reset\s+--hard|clean\s+-\w*f|push\s+(-f|--force))/i, "throws away work"],
  [/Set-ExecutionPolicy\b|\breg\s+(add|delete)\b|\bsetx\b/i, "changes system settings"],
];

/** Why this command deserves a careful read before Enter, or null. */
export function risk(command: string): string | null {
  for (const [re, why] of RISKY) if (re.test(command)) return why;
  return null;
}

/** The command, run in `cwd`, in this shell's own syntax (the terminal opens in the workspace, not the step's folder). */
export function inFolder(shellId: string, cwd: string | null | undefined, command: string): string {
  if (!cwd) return command;
  if (shellId === "powershell") return `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${command}`;
  if (shellId === "cmd") return `cd /d "${cwd}" && ${command}`;
  return `cd '${cwd.replace(/'/g, "'\\''")}' && ${command}`;
}

/** The OS as the guide should hear it, from the browser. */
export function osName(ua: string): string {
  return /Windows/i.test(ua) ? "Windows" : /Mac OS|Macintosh/i.test(ua) ? "macOS" : "Linux";
}
