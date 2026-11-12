// What the page and the server say to each other about running code and
// terminals on this computer. Plain types and constants, shared by the server
// (./hub.ts) and the page (src/ide/localrun/client.ts).

import type { SetupService, SetupStep } from "./setupTypes";
export type { ProgressKind, SetupCheck, SetupService, SetupState, SetupStep } from "./setupTypes";

/** The local-run socket of WalkMyCode for Claude's page server (cookie + Origin, like the bridge). */
export const LOCALRUN_SOCKET_PATH = "/api/localrun/socket";
/** The settings route of both servers. */
export const LOCALRUN_ROUTE = "/api/localrun";

export interface ToolchainView {
  lang: string;
  label: string;
  cmd: string | null;
  version: string | null;
  path: string | null;
  install: string;
  note?: string;
}

export interface ShellView {
  id: string;
  label: string;
}

/** GET /api/localrun */
export interface LocalRunStatus {
  /** This build and mode can run code on this computer at all (never hosted, never Lite). */
  available: boolean;
  /** Why not, when it cannot. */
  reason?: string;
  allowed: boolean;
  allowed_at?: string;
  timeout_s: number;
  /** Only once allowed (finding them runs each program's --version). */
  toolchains: ToolchainView[];
  shells: ShellView[];
  /** "pty": a real terminal; "line": the line-mode stand-in (with why). */
  terminal: { mode: "pty" | "line"; why?: string } | null;
  /** Where the page connects, once allowed: an absolute ws:// URL (the full app) or a path on this server (WalkMyCode for Claude). */
  socket: { url: string; token: string | null } | null;
}

import type { GitBranch, GitCommit, GitStatus } from "./git";

export type ClientMsg =
  /** `test`: run the file's own tests instead of its main (Rust: rustc --test). */
  | { type: "run"; id: string; lang: string; code: string; path?: string | null; timeout_s?: number; test?: boolean }
  | { type: "stop"; id: string }
  | { type: "term-open"; id: string; shell?: string; cols: number; rows: number }
  | { type: "term-in"; id: string; data: string }
  | { type: "term-resize"; id: string; cols: number; rows: number }
  | { type: "term-close"; id: string }
  /** "Set up this project": what each service needs (./setup.ts). `workspace` names it where the server has no folder for it (the full app). */
  | { type: "setup-scan"; id: string; workspace?: string }
  /** Run one planned step, named by its service and step ids; its output comes as run-start / run-out / run-exit under this id. */
  | { type: "setup-run"; id: string; service: string; step: string; workspace?: string; create?: NewProjectAsk }
  /** "New project": the next round for this starter, name and parent folder (./starters.ts). */
  | { type: "new-plan"; id: string; create: NewProjectAsk }
  /** Open the project this server just made (WalkMyCode for Claude maps it; the full app indexes it). */
  | { type: "new-open"; id: string; root: string; name: string }
  /** The full app: where this workspace is on this computer, so its folders can be checked and set up. */
  | { type: "setup-root"; id: string; workspace: string; path: string }
  /** Source Control (./git.ts): one op on the workspace's repo (see GitAsk for which fields each takes). */
  | ({ type: "git"; id: string } & GitAsk);

export type ServerMsg =
  | { type: "hello"; terminal: "pty" | "line" }
  | { type: "run-start"; id: string; shown: string; cwd: string; version: string | null; program: string; temp: boolean }
  | { type: "run-out"; id: string; stream: "out" | "err"; text: string }
  | { type: "run-exit"; id: string; code: number | null; signal: string | null; timedOut: boolean; stopped: boolean; ms: number; cut: boolean }
  | { type: "run-fail"; id: string; message: string }
  | { type: "term-opened"; id: string; shell: string; label: string; mode: "pty" | "line"; why?: string }
  | { type: "term-data"; id: string; data: string }
  | { type: "term-exit"; id: string; code: number | null }
  | { type: "error"; id?: string; message: string }
  /** The plan; `located` false when the server doesn't know where the workspace is on disk (ask with setup-root). */
  | { type: "setup-plan"; id: string; services: SetupService[]; located: boolean }
  | { type: "setup-root-saved"; id: string; ok: boolean; message?: string }
  | { type: "new-plan"; id: string; steps: SetupStep[]; root: string; made: boolean; starters: StarterView[]; parent: string; error?: string }
  | { type: "new-opened"; id: string; ok: boolean; workspace?: string; message?: string }
  /** A git op's answer: the repo's status after it (null when the workspace isn't in a repo, `located` false when its folder isn't known), and what git said. */
  | { type: "git-result"; id: string; op: GitOp; ok: boolean; located: boolean; status: GitStatus | null; output?: string; branches?: GitBranch[]; log?: GitCommit[] };

export type GitOp = "status" | "diff" | "draft" | "commit" | "discard" | "push" | "pull" | "branches" | "switch" | "log" | "resolve" | "finish";

export interface GitAsk {
  op: GitOp;
  workspace?: string;
  /** diff, resolve. */
  path?: string;
  /** commit, discard, draft. */
  paths?: string[];
  /** commit. */
  message?: string;
  /** switch: the branch, made first when `create`. */
  name?: string;
  create?: boolean;
  /** resolve: keep my version, theirs, or the file as I edited it. */
  how?: "ours" | "theirs" | "done";
  /** pull: merge when both sides have new commits. */
  merge?: boolean;
  /** finish: abort instead. */
  abort?: boolean;
}

export interface NewProjectAsk {
  starter: string;
  name: string;
  /** Where it goes; the server's default ("~/WalkMyCode Projects") when left out. */
  parent?: string;
  /** starter "custom": a framework's own commands, read by the user, run in order in the new folder (./frameworks.ts). */
  custom?: { framework: string; commands: string[] };
}

export interface StarterView {
  id: string;
  label: string;
  blurb: string;
  needs: string;
}

/** The hosted mode never runs code or opens a shell; the user's own server does, once allowed. */
export const HOSTED_REFUSAL = "Running code and terminals on a computer are not part of hosted WalkMyCode: they are for WalkMyCode on your own computer.";
