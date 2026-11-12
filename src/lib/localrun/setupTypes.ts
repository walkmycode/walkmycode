// "Set up this project": what the server tells the page about each service
// (./setup.ts plans it on disk). Plain types only, so the page can import them.

export type SetupState = "ready" | "needs-setup" | "needs-tool";

export interface SetupCheck {
  /** true: fine; false: missing; null: worth knowing (a .env to fill in). */
  ok: boolean | null;
  text: string;
}

/** How a step's output is read for progress (src/ide/localrun/setup/progress.ts). */
export type ProgressKind = "npm" | "pnpm" | "yarn" | "bun" | "pip" | "venv" | "pub" | "composer" | "bundle" | "cargo" | "go" | "dotnet" | "artisan" | "winget" | "brew" | "download" | "copy";

export interface SetupStep {
  id: string;
  /** What it does, in words ("Install the packages"). */
  label: string;
  /** The command as the user would type it. */
  shown: string;
  progress: ProgressKind;
  /** How many packages it should end up with, when the files say (requirements.txt lines, package.json dependencies). */
  expect?: number;
}

export interface SetupService {
  /** The folder, relative to the workspace root ("." for the root itself), with the root's name first when there are several. */
  id: string;
  name: string;
  /** "Vite · npm", "FastAPI · Python". */
  stack: string;
  state: SetupState;
  checks: SetupCheck[];
  steps: SetupStep[];
  /** When the tool itself is missing: the command that installs it, and where to read about it. */
  install?: { command: string; url: string; tool: string; auto?: boolean; key?: string };
}
