// Where on-device speech to text stands, as the server tells the page (GET
// /api/voice/parakeet) and as Settings → Voice says it in words. Types and
// pure functions only: the page and the server both import it.
import type { EngineStatus } from "./engine";
import type { InstallProgress, ModelSource } from "./model";

export interface ParakeetStatus {
  /** missing: not on this computer. installing: on its way. installed: ready to load. */
  state: "missing" | "installing" | "installed";
  /** Whose copy is in use. */
  source: ModelSource | null;
  /** WalkMyCode's own copy exists (and so can be removed). */
  removable: boolean;
  install: InstallProgress;
  engine: EngineStatus;
  /** The recognizer's package is part of this build. */
  available: boolean;
  /** Why this server can't offer it at all, or null. */
  refusal: string | null;
  /** The model's size on disk. */
  bytes: number;
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** The panel's one line of state, in words. */
export function parakeetLine(s: ParakeetStatus): string {
  if (s.refusal) return s.refusal;
  if (s.state === "installing") {
    const { phase, received, total } = s.install;
    if (phase === "verifying") return "Checking the download…";
    if (phase === "unpacking") return "Unpacking the four model files…";
    const pct = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
    return `Downloading… ${mb(received)} of ${mb(total)} (${pct}%)`;
  }
  if (s.state === "installed") {
    if (s.source === "ireliabee") return "Already on this computer: WalkMyCode uses the copy iReliabee downloaded, and never changes or removes it.";
    return `On this computer (${mb(s.bytes)}, in .walkmycode/models in your home folder).`;
  }
  return `Not on this computer yet: a one-off download of ${mb(s.install.total)} from GitHub (${mb(s.bytes)} once unpacked).`;
}

/** The download's progress, 0–100, or null when nothing is being set up. */
export function parakeetPercent(s: ParakeetStatus): number | null {
  if (s.state !== "installing") return null;
  if (s.install.phase !== "downloading") return 100;
  return s.install.total ? Math.min(100, (s.install.received / s.install.total) * 100) : 0;
}

/** Whether the choice can hear now. */
export function parakeetUsable(s: ParakeetStatus | null): boolean {
  return !!s && s.state === "installed" && !s.refusal;
}
