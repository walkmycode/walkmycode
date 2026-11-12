// WalkMyCode Lite's first paint: scripts/pack-lite.mjs puts a loading screen (the
// lantern's glow and "Opening WalkMyCode…") at the very top of the artifact's page,
// styled inline, so it shows before any stylesheet or script has arrived. Once the
// page has mounted, it fades out. Nothing happens where there is none (the app, tests).
export const BOOT_ID = "wmc-boot";

/** Fade the loading screen out and remove it. Safe to call more than once. */
export function dismissBoot(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  const el = doc?.getElementById(BOOT_ID);
  if (!el || el.classList.contains("gone")) return;
  el.classList.add("gone");
  setTimeout(() => el.remove(), 300);
}
