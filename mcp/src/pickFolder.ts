// "Choose folder…" on the page's start screen (POST /api/folder/pick): a browser never hands a page a
// folder's full path, but this server runs on the user's own computer, so it opens the system's own
// folder dialog and answers with the path picked. Windows: the Forms folder browser (PowerShell, STA);
// macOS: Finder's "choose folder" (osascript); Linux: zenity, else kdialog. Nothing is read here: the
// path goes back to the page, and opening it is a separate step (POST /api/folder/open).
import { spawn } from "node:child_process";

/** The dialog couldn't be shown on this system (no desktop, no zenity or kdialog...). */
export class NoFolderDialog extends Error {}

const PROMPT = "Choose the project folder for WalkMyCode";

/** Each system's dialog: the program, its arguments, and how to read its answer. */
export function dialogCommand(platform: NodeJS.Platform): { cmd: string; args: string[] }[] {
  if (platform === "win32") {
    // An owner form kept on top, so the dialog opens in front of the browser rather than behind it.
    const script = [
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$d.Description = '${PROMPT}'`,
      "$d.ShowNewFolderButton = $false",
      "$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
      "if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    ].join("; ");
    return [{ cmd: "powershell.exe", args: ["-NoProfile", "-STA", "-NonInteractive", "-Command", script] }];
  }
  if (platform === "darwin") return [{ cmd: "osascript", args: ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`] }];
  return [
    { cmd: "zenity", args: ["--file-selection", "--directory", `--title=${PROMPT}`] },
    { cmd: "kdialog", args: ["--getexistingdirectory", ".", "--title", PROMPT] },
  ];
}

/** Show the dialog and wait for the person: the folder's absolute path, or null when they cancel. */
export async function pickFolder(platform: NodeJS.Platform = process.platform, run = runDialog): Promise<string | null> {
  for (const c of dialogCommand(platform)) {
    const r = await run(c.cmd, c.args);
    if (r === "missing") continue;
    // osascript ends a folder with "/": dropped, except for a drive or the root itself.
    let path = r.trim();
    if (path.length > 1 && !/^[A-Za-z]:[\\/]$/.test(path)) path = path.replace(/[\\/]+$/, "");
    return path || null;
  }
  throw new NoFolderDialog(
    platform === "linux" ? "No folder dialog on this system: install zenity (or kdialog), or type the folder's path." : "The folder dialog couldn't open here: type the folder's path.",
  );
}

/** Run one dialog program: what it printed ("" when cancelled), or "missing" when it isn't installed. */
function runDialog(cmd: string, args: string[]): Promise<string | "missing"> {
  return new Promise((done) => {
    let out = "";
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: false });
    } catch {
      return done("missing");
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.once("error", () => done("missing"));
    child.once("close", () => done(out));
  });
}
